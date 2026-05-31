#!/usr/bin/env node
// =========================================
// RULE EXTRACTION SCRIPT (Phase 2 W11)
// =========================================
//
// Given a plain-text book chapter, asks Gemini Flash to extract every
// classical astrology rule it can find and emit them in the AstroRule
// JSON shape that our evaluator consumes. Output is reviewed by hand
// and folded into lib/rules/<domain>.js — model output is a starting
// point, not the final code.
//
// USAGE:
//   GEMINI_API_KEY=xxx node scripts/extract-rules.js \
//     --book "BPHS" \
//     --chapter 81 \
//     --domain children \
//     --in  data/chapters/bphs-ch81.txt \
//     --out data/extracted/bphs-ch81-rules.json
//
// COST: free tier of gemini-2.5-flash gives 1M tokens/day —
// comfortably enough for ~3 book chapters per day.
//
// NEXT STEP: open the .json output, sanity-check each rule, then
// hand-convert the strongest 10-20 into Dart-style predicates in
// lib/rules/<domain>.js.

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
if (!KEY) {
  console.error('Missing GEMINI_API_KEY env var.');
  process.exit(1);
}
for (const r of ['book', 'chapter', 'domain', 'in', 'out']) {
  if (!args[r]) {
    console.error(`Missing --${r}`);
    process.exit(1);
  }
}

const chapterText = fs.readFileSync(args.in, 'utf8');
if (chapterText.length > 80000) {
  console.warn(`Chapter is ${chapterText.length} chars — may hit token limit. Consider splitting.`);
}

const PROMPT = `You are extracting astrology rules from a classical Vedic text.

INPUT: A chapter of ${args.book} (Ch.${args.chapter}) about the domain "${args.domain}".

TASK: Identify every distinct rule the text states. A rule has the form:
  "WHEN [chart condition] THEN [predicted effect]"

For each rule, output a JSON object with:
{
  "id": "snake_case_short_id",
  "source": { "book": "${args.book}", "chapter": ${args.chapter}, "verse": "VERSE_NUMBER_OR_RANGE" },
  "condition_text": "natural language description of the chart condition",
  "effect_text": "the predicted result, in the source's own words (translated to English)",
  "polarity": "positive" | "negative" | "neutral" | "mixed",
  "estimated_intensity": 1-10,
  "domain": "${args.domain}"
}

OUTPUT FORMAT: A JSON array of these objects. ONLY the JSON array. No prose.

RULES TO FOLLOW:
- Skip generic statements (e.g. "the 7th house is for marriage" alone is too vague — needs a CONDITION + EFFECT)
- Skip remedies (those go to lib/rules/remedies.js separately)
- One rule per distinct chart-condition. If a verse lists 4 conditions with the same effect, make 4 rules.
- If you cannot find a verse number, set "verse" to "unknown"
- Keep condition_text precise enough that a programmer could write code from it

TEXT:
${chapterText}`;

console.log(`Extracting rules from ${args.book} Ch.${args.chapter} (${chapterText.length} chars)...`);

const body = JSON.stringify({
  contents: [{ parts: [{ text: PROMPT }] }],
  generationConfig: {
    responseMimeType: 'application/json',
    temperature: 0.2,
    maxOutputTokens: 8192,
  },
});

const req = https.request({
  hostname: 'generativelanguage.googleapis.com',
  path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${KEY}`,
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
}, (res) => {
  let data = '';
  res.on('data', (c) => data += c);
  res.on('end', () => {
    if (res.statusCode !== 200) {
      console.error(`HTTP ${res.statusCode}:`, data.slice(0, 500));
      process.exit(1);
    }
    try {
      const parsed = JSON.parse(data);
      const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const cleaned = text.replace(/```json?/gi, '').replace(/```/g, '').trim();
      const rules = JSON.parse(cleaned);
      if (!Array.isArray(rules)) throw new Error('Expected array');
      const outPath = args.out;
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(rules, null, 2));
      console.log(`✓ Extracted ${rules.length} rules → ${outPath}`);
      console.log(`  Next: review by hand, then hand-port to lib/rules/${args.domain}.js`);
    } catch (e) {
      console.error('Parse failed:', e.message);
      console.error('Raw response:', data.slice(0, 1000));
      process.exit(1);
    }
  });
});
req.on('error', (e) => { console.error(e.message); process.exit(1); });
req.write(body);
req.end();
