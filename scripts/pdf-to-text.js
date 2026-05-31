#!/usr/bin/env node
// Convert a Vedic-astrology PDF to .txt + auto-built chapter map.
//
//   node scripts/pdf-to-text.js \
//     --in  data/books/saravali.pdf \
//     --out data/books/saravali.txt \
//     --map data/books/saravali-chapter-map.json

const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

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
for (const r of ['in', 'out', 'map']) {
  if (!args[r]) { console.error(`Missing --${r}`); process.exit(1); }
}

(async () => {
  const buf = fs.readFileSync(args.in);
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const { text } = await parser.getText();

  // Write the raw text
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, text, 'utf8');
  console.log(`✓ Wrote ${text.length} chars to ${args.out}`);

  // Build chapter map by line number
  const lines = text.split('\n');
  const chapters = [];
  let prev = null;
  // Pattern: "Chapter N" (optional trailing punct) on its own line
  const chapterRe = /^\s*chapter\s+(\d+)\s*\.?\s*$/i;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(chapterRe);
    if (!m) continue;
    const num = parseInt(m[1], 10);
    // Skip TOC entries — text body chapters are always followed by content
    // within the next 5 lines (not another "Chapter N" header).
    let isBody = false;
    for (let j = 1; j <= 5 && i + j < lines.length; j++) {
      if (lines[i + j].trim().length > 30 && !/^chapter\s+\d+/i.test(lines[i + j])) {
        isBody = true; break;
      }
    }
    if (!isBody) continue;
    // Try to grab the chapter name from next non-empty line
    let name = '';
    for (let j = 1; j <= 6 && i + j < lines.length; j++) {
      const candidate = lines[i + j].trim();
      if (candidate.length > 5 && candidate.length < 80 && !/^\d/.test(candidate)) {
        name = candidate;
        break;
      }
    }
    if (prev) prev.end_line = i; // line BEFORE this chapter header
    const entry = {
      chapter: num,
      chapter_name: name || `Chapter ${num}`,
      start_line: i + 1, // 1-based
      end_line: lines.length,
    };
    chapters.push(entry);
    prev = entry;
  }

  // Dedupe — sometimes TOC + body both detected; keep the one with larger
  // (end_line - start_line) per chapter number.
  const byNum = {};
  for (const c of chapters) {
    if (!byNum[c.chapter] || (c.end_line - c.start_line) > (byNum[c.chapter].end_line - byNum[c.chapter].start_line)) {
      byNum[c.chapter] = c;
    }
  }
  const finalMap = Object.values(byNum).sort((a, b) => a.chapter - b.chapter);

  fs.writeFileSync(args.map, JSON.stringify(finalMap, null, 2));
  console.log(`✓ Wrote chapter map: ${finalMap.length} chapters → ${args.map}`);
  console.log('\nFirst 5 chapters:');
  finalMap.slice(0, 5).forEach(c => console.log(`  Ch.${c.chapter} "${c.chapter_name}" (lines ${c.start_line}-${c.end_line}, ~${c.end_line - c.start_line} lines)`));
})().catch(e => { console.error(e); process.exit(1); });
