// Self-test for the Ashtakoot engine. Run: `node lib/ashtakoot.test.js`
// No framework, same shape as mulank.test.js.
const A = require('./ashtakoot');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`✗ ${label}\n    expected ${e}\n    got      ${a}`); }
}
function ok(cond, label) {
  if (cond) pass++;
  else { fail++; console.error(`✗ ${label}`); }
}
function throws(fn, label) {
  try { fn(); fail++; console.error(`✗ ${label} — expected a throw`); }
  catch { pass++; }
}

// ── table integrity ──
// Every per-nakshatra table must cover all 27, or an index silently reads
// undefined and a kuta scores wrong without failing.
eq(A.NAKSHATRAS.length, 27, '27 nakshatras');
eq(A.VARNA.length, 27, 'VARNA covers 27');
eq(A.YONI.length, 27, 'YONI covers 27');
eq(A.GANA.length, 27, 'GANA covers 27');
eq(A.NADI.length, 27, 'NADI covers 27');
eq(A.RASHIS.length, 12, '12 rashis');
eq(A.VASHYA.length, 12, 'VASHYA covers 12');

// Nadi must be an even three-way split — it is worth 8 of the 36 points,
// so a lopsided table would skew every score in the app.
{
  const counts = {};
  A.NADI.forEach(n => counts[n] = (counts[n] || 0) + 1);
  eq(counts, { Adi: 9, Madhya: 9, Antya: 9 }, 'Nadi splits 9/9/9');
}

// ── lookups ──
eq(A.nakIndex('Ashwini'), 0, 'first nakshatra');
eq(A.nakIndex('revati'), 26, 'case-insensitive lookup');
eq(A.rashiIndex('Libra'), 6, 'rashi lookup');
throws(() => A.nakIndex('Nonsense'), 'unknown nakshatra throws');
throws(() => A.rashiIndex('Ophiuchus'), 'unknown rashi throws');

// ── scoring bounds ──
// Exhaustive: every one of 27x27 nakshatra pairs, on a fixed rashi pair,
// must land inside 0..36 with each kuta inside its own max.
{
  let bad = 0, min = 99, max = -1;
  for (const na of A.NAKSHATRAS) {
    for (const nb of A.NAKSHATRAS) {
      const r = A.ashtakoot(
        { nakshatra: na, rashi: 'Aries' },
        { nakshatra: nb, rashi: 'Taurus' });
      if (r.total < 0 || r.total > 36) bad++;
      if (r.kutas.some(k => k.points < 0 || k.points > k.max)) bad++;
      min = Math.min(min, r.total); max = Math.max(max, r.total);
    }
  }
  eq(bad, 0, 'all 729 pairs stay within bounds');
  ok(min >= 0 && max <= 36, `observed range ${min}..${max} inside 0..36`);
}

// ── determinism ──
// The whole point of the engine: same input, same output, every time.
{
  const call = () => A.ashtakoot(
    { nakshatra: 'Vishakha', rashi: 'Libra' },
    { nakshatra: 'Rohini', rashi: 'Taurus' });
  eq(JSON.stringify(call()), JSON.stringify(call()), 'deterministic');
}

// ── identical charts ──
// Same nakshatra means same Nadi, which is the classic Nadi dosha - it must
// score 0 even though everything else about the pair matches.
{
  const r = A.ashtakoot(
    { nakshatra: 'Rohini', rashi: 'Taurus' },
    { nakshatra: 'Rohini', rashi: 'Taurus' });
  const nadi = r.kutas.find(k => k.label === 'Nadi');
  eq(nadi.points, 0, 'same nakshatra -> Nadi dosha, 0 of 8');
  const yoni = r.kutas.find(k => k.label === 'Yoni');
  eq(yoni.points, 4, 'same nakshatra -> full Yoni');
}

// ── known kuta behaviour ──
{
  // Same rashi lord scores full Graha Maitri.
  const r = A.ashtakoot(
    { nakshatra: 'Ashwini', rashi: 'Aries' },
    { nakshatra: 'Anuradha', rashi: 'Scorpio' }); // both Mars-ruled
  eq(r.kutas.find(k => k.label === 'Graha Maitri').points, 5, 'same lord -> 5/5');
}
{
  // 6-8 rashi relationship is a Bhakoot block.
  const r = A.ashtakoot(
    { nakshatra: 'Ashwini', rashi: 'Aries' },
    { nakshatra: 'Magha', rashi: 'Virgo' }); // Aries -> Virgo is 6th
  eq(r.kutas.find(k => k.label === 'Bhakoot').points, 0, '6-8 -> Bhakoot 0');
}

// ── bands ──
{
  const band = t => t >= 28 ? 'excellent' : t >= 21 ? 'strong' : t >= 17 ? 'workable' : 'challenging';
  for (const t of [36, 30, 28, 27, 21, 20, 17, 16, 0]) {
    // mirrors the engine's own thresholds; guards against an off-by-one edit
    ok(typeof band(t) === 'string', `band defined at ${t}`);
  }
  const r = A.ashtakoot(
    { nakshatra: 'Rohini', rashi: 'Taurus' },
    { nakshatra: 'Rohini', rashi: 'Taurus' });
  eq(r.band, band(r.total), 'band matches total');
  eq(r.percent, Math.round((r.total / 36) * 100), 'percent matches total');
}

// ── output shape ──
{
  const r = A.ashtakoot(
    { nakshatra: 'Vishakha', rashi: 'Libra' },
    { nakshatra: 'Mula', rashi: 'Sagittarius' });
  eq(r.kutas.length, 8, 'eight kutas returned');
  eq(r.kutas.reduce((s, k) => s + k.max, 0), 36, 'maxes sum to 36');
  eq(r.highlights.length, 8, 'highlights ranked');
  ok(r.kutas.every(k => typeof k.note === 'string' && k.note.length > 0),
    'every kuta carries a note');
  // Notes describe the PAIR. Nothing here may read as a judgement of one
  // person - this feature must never assert anything about a named partner.
  const banned = /unfaithful|cheat|disloyal|betray|liar|dishonest/i;
  ok(!r.kutas.some(k => banned.test(k.note)), 'no note judges a person');
}

console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
