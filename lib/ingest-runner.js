// =========================================
// IN-PROCESS BOOK INGESTION
// =========================================
//
// Background job that chunks a book + embeds chunks + merges into
// knowledge_base.json — all while the main /chat endpoint stays
// responsive. Designed to NOT degrade Render's user-facing latency:
//
//   - One embed request at a time (no parallel fan-out)
//   - ~100ms delay between requests (10 req/sec, safely under
//     text-embedding-004's 1500 req/min free-tier limit)
//   - setImmediate after each chunk so the event loop yields to
//     incoming user requests
//   - Progress saved every 50 chunks so a crash doesn't lose work
//   - In-memory knowledge base reloaded on completion so the new
//     chunks are searchable immediately without a restart

const fs = require('fs');
const path = require('path');
const https = require('https');

const STATE_FILE = path.join(__dirname, '..', 'data', 'ingest-state.json');
const KB_FILE = path.join(__dirname, '..', 'knowledge_base.json');

let _currentJob = null;

function getCurrentJob() { return _currentJob; }

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch (_) { return null; }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function splitChapterIntoChunks(chapterText, meta, target = 300, overlap = 60) {
  const words = chapterText.split(/\s+/).filter(Boolean);
  const chunks = [];
  let start = 0;
  let verseStart = 1;
  while (start < words.length) {
    const end = Math.min(start + target, words.length);
    const text = words.slice(start, end).join(' ');
    const verseEnd = verseStart + Math.round((end - start) / 30);
    chunks.push({
      book: meta.book,
      chapter: meta.chapter,
      chapter_name: meta.chapter_name,
      verse_range: `${verseStart}-${verseEnd}`,
      text,
    });
    if (end === words.length) break;
    start = end - overlap;
    verseStart = verseEnd;
  }
  return chunks;
}

function embed(text, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_DOCUMENT',
    });
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        try { resolve(JSON.parse(data).embedding.values); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('embed-timeout')); });
    req.write(body);
    req.end();
  });
}

function loadBookText(txtPath, mapPath) {
  const text = fs.readFileSync(txtPath, 'utf8');
  const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const lines = text.split('\n');
  return { lines, map };
}

function appendChunksToKB(chunks) {
  // KB shape on disk: object keyed by stringified index ("0", "1", ...)
  // — same shape the chat endpoint loads via require().
  let kb = {};
  if (fs.existsSync(KB_FILE)) {
    kb = JSON.parse(fs.readFileSync(KB_FILE, 'utf8'));
  }
  const startIdx = Object.keys(kb).length;
  chunks.forEach((c, i) => { kb[String(startIdx + i)] = c; });
  fs.writeFileSync(KB_FILE, JSON.stringify(kb));
  return Object.keys(kb).length;
}

// Public: kick off an ingestion. Non-blocking.
async function startIngestion({ book, txtPath, mapPath, apiKey, reloadKB }) {
  if (_currentJob && _currentJob.status === 'running') {
    throw new Error('Another ingestion is already running');
  }
  if (!apiKey) throw new Error('Gemini API key required');
  if (!fs.existsSync(txtPath)) throw new Error('Text file not found: ' + txtPath);
  if (!fs.existsSync(mapPath)) throw new Error('Map file not found: ' + mapPath);

  const { lines, map } = loadBookText(txtPath, mapPath);

  // Build all chunks upfront (cheap, no API call)
  const allChunks = [];
  for (const meta of map) {
    const chapterText = lines.slice(meta.start_line - 1, meta.end_line).join('\n');
    const chunks = splitChapterIntoChunks(chapterText, { ...meta, book });
    allChunks.push(...chunks);
  }

  _currentJob = {
    book,
    status: 'running',
    startedAt: new Date().toISOString(),
    total: allChunks.length,
    embedded: 0,
    failed: 0,
    appended: 0,
    errors: [],
  };
  saveState(_currentJob);
  console.log(`[ingest] Starting: ${book} (${allChunks.length} chunks)`);

  // Drive the job in the background. Caller already got their 202.
  setImmediate(() => runJob(allChunks, apiKey, reloadKB).catch(e => {
    console.error('[ingest] Crashed:', e.message);
    if (_currentJob) {
      _currentJob.status = 'failed';
      _currentJob.error = e.message;
      saveState(_currentJob);
    }
  }));

  return _currentJob;
}

async function runJob(allChunks, apiKey, reloadKB) {
  const embedded = [];
  for (let i = 0; i < allChunks.length; i++) {
    try {
      allChunks[i].embedding = await embed(allChunks[i].text, apiKey);
      embedded.push(allChunks[i]);
      _currentJob.embedded++;
    } catch (e) {
      _currentJob.failed++;
      _currentJob.errors.push(`chunk ${i}: ${e.message}`);
      if (_currentJob.errors.length > 20) _currentJob.errors.shift();
    }

    // Yield + throttle
    if (i % 5 === 4) await new Promise(r => setImmediate(r));
    await new Promise(r => setTimeout(r, 100));

    // Periodic state save + partial KB merge (50 at a time)
    if (embedded.length >= 50) {
      const total = appendChunksToKB(embedded);
      _currentJob.appended = total;
      saveState(_currentJob);
      embedded.length = 0;
    }
  }

  // Final flush
  if (embedded.length > 0) {
    const total = appendChunksToKB(embedded);
    _currentJob.appended = total;
  }

  _currentJob.status = 'completed';
  _currentJob.completedAt = new Date().toISOString();
  saveState(_currentJob);

  // Reload the in-memory KB so new chunks are searchable immediately,
  // without a Render restart. Caller supplies the reload function so we
  // don't need to import index.js (circular dep risk).
  if (typeof reloadKB === 'function') {
    try { reloadKB(); console.log('[ingest] In-memory KB reloaded'); }
    catch (e) { console.warn('[ingest] reloadKB failed:', e.message); }
  }

  console.log(`[ingest] Completed: ${_currentJob.embedded} embedded, ${_currentJob.failed} failed, ${_currentJob.appended} total KB chunks`);
}

module.exports = { startIngestion, getCurrentJob, loadState };
