// Verifies a Gemini key works, without the key ever leaving this machine.
// Put GEMINI_KEY_NEW=... in .env.probe (gitignored), then: node check-gemini.js
require('dotenv').config({ path: '.env.probe' });

const key = process.env.GEMINI_KEY_NEW || process.env.GEMINI_API_KEY;
if (!key) {
  console.error('No key. Add GEMINI_KEY_NEW=... to .env.probe');
  process.exit(1);
}

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Chat needs BOTH of these alive: embedding for retrieval, generation for the
// answer. The 403 outage killed both, so check both rather than assuming.
(async () => {
  const embed = await fetch(`${BASE}/models/gemini-embedding-001:embedContent?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'models/gemini-embedding-001',
      content: { parts: [{ text: 'marriage timing' }] },
    }),
  });
  console.log(`embedding      ${embed.status} ${embed.ok ? 'OK' : await embed.text().then(t => t.slice(0, 160))}`);

  for (const m of ['gemini-2.5-flash', 'gemini-2.5-flash-lite']) {
    const r = await fetch(`${BASE}/models/${m}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with the word OK.' }] }] }),
    });
    console.log(`${m.padEnd(22)} ${r.status} ${r.ok ? 'OK' : await r.text().then(t => t.slice(0, 160))}`);
  }
})();
