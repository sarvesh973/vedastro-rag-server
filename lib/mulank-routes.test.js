// Self-test for the mulank ROUTE helpers (date/tz + language hardening).
// Run: `node lib/mulank-routes.test.js`
// The engine has its own suite in mulank.test.js; this covers the layer
// above it, which is where the timezone and cache-key bugs lived.
const R = require('./mulank-routes');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`✗ ${label}\n    expected ${e}\n    got      ${a}`); }
}
function throws(fn, label) {
  try { fn(); fail++; console.error(`✗ ${label} — expected a throw`); }
  catch { pass++; }
}

// ── language whitelist ──
// Anything outside the map must collapse to 'en', or it mints a fresh
// cache key and therefore a fresh (billable) LLM generation.
eq(R.normaliseLang('en'), 'en', 'en');
eq(R.normaliseLang('english'), 'en', 'english canonicalises to en');
eq(R.normaliseLang('English'), 'en', 'case-insensitive');
eq(R.normaliseLang(' hinglish '), 'hinglish', 'trims');
eq(R.normaliseLang('hindi'), 'hi', 'hindi canonicalises to hi');
eq(R.normaliseLang('en1'), 'en', 'cache-buster collapses to en');
eq(R.normaliseLang('../../etc'), 'en', 'junk collapses to en');
eq(R.normaliseLang(undefined), 'en', 'missing defaults to en');
eq(R.normaliseLang(''), 'en', 'empty defaults to en');

// ── IST "today" regardless of container TZ ──
// The real bug: Render runs UTC, so for the first 5h30m of every IST day
// a bare `new Date()` is still on the previous date.
{
  const expected = new Date()
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  eq(R.ymd(R.istToday()), expected, 'istToday matches IST civil date');
  eq(R.ymd(R.targetDate()), expected, 'targetDate() with no input = IST today');
}

// ── explicit dates still parse ──
eq(R.ymd(R.targetDate('2026-08-27')), '2026-08-27', 'explicit ISO date');

// ── date window bounds cache-key fan-out ──
throws(() => R.targetDate('1900-01-01'), 'far-past date rejected');
throws(() => R.targetDate('2200-01-01'), 'far-future date rejected');
{
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);
  eq(R.ymd(R.targetDate(R.ymd(soon))), R.ymd(soon), 'date 30d out accepted');
}

if (fail) { console.error(`\n${fail} FAILED, ${pass} passed`); process.exit(1); }
console.log(`\n✓ ALL PASS — ${pass} passed, 0 failed`);
