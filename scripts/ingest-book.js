#!/usr/bin/env node
// =========================================
// BOOK INGESTION SCRIPT (Phase 2 W12)
// =========================================
//
// Splits a plain-text book into ~300-word chunks (with 20% overlap),
// embeds each chunk via Google text-embedding-004, and appends to the
// existing knowledge_base.json so the RAG layer can retrieve from it.
//
// USAGE:
//   GEMINI_API_KEY=xxx node scripts/ingest-book.js \
//     --book "Saravali" \
//     --in   data/books/saravali.txt \
//     --metadata-json data/books/saravali-chapter-map.json
//
// metadata-json shape:
//   [
//     { "chapter": 1, "chapter_name": "Greatness of Time", "start_line": 1, "end_line": 240 },
//     { "chapter": 2, ... },
//     ...
//   ]
//
// Output: appends to knowledge_base.json with chunks of shape:
//   {
//     "book": "Saravali",
//     "chapter": 34,
//     "chapter_name": "Marriage and Spouse",
//     "verse_range": "1-12",
//     "text": "...",
//     "embedding": [768 floats]
//   }
//
// COST: text-embedding-004 free tier = 1500 RPM. A 400-chunk book
// ingests in well under a minute.

const fs = require('fs');
const path = require('path');
const https = require('https');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

const args = parseArgs(process.argv);
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('GEMINI_API_KEY missing'); process.exit(1); }
for (const r of ['book', 'in', 'metadata-json']) {
  if (!args[r]) { console.error(`Missing --${r}`); process.exit(1); }
}

const TARGET_WORDS = 300;
const OVERLAP_WORDS = 60; // 20% overlap so context bridges chunk boundaries

function splitChapterIntoChunks(chapterText, meta) {
  const words = chapterText.split(/\s+/).filter(Boolean);
  const chunks = [];
  let start = 0;
  let verseStart = 1;
  while (start < words.length) {
    const end = Math.min(start + TARGET_WORDS, words.length);
    const text = words.slice(start, end).join(' ');
    const verseEnd = verseStart + Math.round((end - start) / 30); // rough estimate
    chunks.push({
      book: args.book,
      chapter: meta.chapter,
      chapter_name: meta.chapter_name,
      verse_range: `${verseStart}-${verseEnd}`,
      text,
    });
    if (end === words.length) break;
    start = end - OVERLAP_WORDS;
    verseStart = verseEnd;
  }
  return chunks;
}

async function embed(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      content: { parts: [{ text }] },
      taskType: 'RETRIEVAL_DOCUMENT',
    });
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/text-embedding-004:embedContent?key=${KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
    }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.embedding.values);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  const bookText = fs.readFileSync(args.in, 'utf8');
  const lines = bookText.split('\n');
  const metadata = JSON.parse(fs.readFileSync(args['metadata-json'], 'utf8'));

  console.log(`Ingesting ${args.book} (${metadata.length} chapters, ${lines.length} lines)...`);

  const allChunks = [];
  for (const meta of metadata) {
    const chapterText = lines.slice(meta.start_line - 1, meta.end_line).join('\n');
    const chunks = splitChapterIntoChunks(chapterText, meta);
    allChunks.push(...chunks);
  }
  console.log(`Split into ${allChunks.length} chunks. Embedding...`);

  // Embed sequentially with a small delay to stay under RPM limit.
  for (let i = 0; i < allChunks.length; i++) {
    try {
      allChunks[i].embedding = await embed(allChunks[i].text);
      if (i % 25 === 0) console.log(`  ${i + 1}/${allChunks.length}`);
    } catch (e) {
      console.error(`Chunk ${i} failed:`, e.message);
      // Retry once
      await new Promise(r => setTimeout(r, 1000));
      try { allChunks[i].embedding = await embed(allChunks[i].text); }
      catch (e2) { console.error('Retry failed too — skipping.'); }
    }
    await new Promise(r => setTimeout(r, 80)); // ~12 req/sec, safe under 1500/min
  }
  console.log(`✓ Embedded ${allChunks.filter(c => c.embedding).length}/${allChunks.length} chunks`);

  // Append to knowledge_base.json
  const kbPath = path.join(__dirname, '..', 'knowledge_base.json');
  let kb = {};
  if (fs.existsSync(kbPath)) {
    const raw = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
    kb = raw; // Could be array or object — preserve shape
  }
  // Convert to indexed object shape if needed (knowledge_base.json
  // uses { "0": {...}, "1": {...} } pattern based on user's repo).
  const startIdx = Object.keys(kb).length;
  allChunks.forEach((c, i) => {
    if (c.embedding) kb[String(startIdx + i)] = c;
  });

  fs.writeFileSync(kbPath, JSON.stringify(kb, null, 0));
  console.log(`✓ Appended to knowledge_base.json. Total chunks now: ${Object.keys(kb).length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
