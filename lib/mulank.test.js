// Plain-node self-test for the mulank engine. Run: `node lib/mulank.test.js`
// No framework — throws on first failure, prints a summary otherwise.
const M = require('./mulank');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`✗ ${label}\n    expected ${e}\n    got      ${a}`); }
}

// ── digit reduction ──
eq(M.reduceToDigit(14), 5, 'reduce 14');
eq(M.reduceToDigit(23), 5, 'reduce 23');
eq(M.reduceToDigit(9), 9, 'reduce 9');
eq(M.reduceToDigit(29), 2, 'reduce 29 -> 11 -> 2');
eq(M.reduceToDigit(31), 4, 'reduce 31');

// ── mulank (day of birth) ──
eq(M.mulank('1990-01-14'), 5, 'mulank 14th');
eq(M.mulank('2000-11-09'), 9, 'mulank 9th');
eq(M.mulank('1988-05-28'), 1, 'mulank 28th -> 10 -> 1');
eq(M.mulank(23), 5, 'mulank bare day 23');

// ── bhagyank (full DOB) ──
// 14-01-1990 -> 1+4+0+1+1+9+9+0 = 25 -> 7
eq(M.bhagyank('1990-01-14'), 7, 'bhagyank 1990-01-14');
// 09-11-2000 -> 0+9+1+1+2+0+0+0 = 13 -> 4
eq(M.bhagyank('2000-11-09'), 4, 'bhagyank 2000-11-09');

// ── din-ank ──
// 18 Aug 2026 -> 1+8+0+8+2+0+2+6 = 27 -> 9
eq(M.dinAnk('2026-08-18'), 9, 'din-ank 2026-08-18');

// ── relation & rating symmetry with table ──
// mulank 1: friends [1,2,3,9], enemies [6,8]
eq(M.relation(1, 9), 'friend', 'rel 1↔9 friend');
eq(M.relation(1, 8), 'enemy', 'rel 1↔8 enemy');
eq(M.relation(1, 5), 'neutral', 'rel 1↔5 neutral');

// dayRating shape + determinism
const r1 = M.dayRating('1990-01-14', '2026-08-18'); // mulank 5, din-ank 9
eq(r1.mulank, 5, 'dayRating mulank');
eq(r1.dinAnk, 9, 'dayRating dinAnk');
eq(r1.relation, 'friend', 'dayRating relation 5↔9 (9 in friends of 5)');
eq(r1.rating, 'favourable', 'dayRating rating');
const r1b = M.dayRating('1990-01-14', '2026-08-18');
eq(r1, r1b, 'dayRating is deterministic');

// ── week aggregation ──
const wk = M.weekRating('1990-01-14', '2026-08-17'); // Mon-start week
eq(wk.days.length, 7, 'week has 7 days');
eq(wk.counts.favourable + wk.counts.neutral + wk.counts.caution, 7, 'week counts sum to 7');
if (!['favourable', 'neutral', 'caution'].includes(wk.overall)) { fail++; console.error('✗ week overall invalid'); } else pass++;

// ── month aggregation ──
const mo = M.monthRating('1990-01-14', 2026, 8);
eq(mo.days.length, 31, 'Aug 2026 has 31 days');
eq(mo.counts.favourable + mo.counts.neutral + mo.counts.caution, 31, 'month counts sum to 31');

// ── profile ──
const p = M.profileFor('1990-01-14'); // mulank 5
eq(p.mulank, 5, 'profile mulank');
eq(p.planet, 'Mercury', 'profile planet');
const p9 = M.profileFor(9);
eq(p9.planet, 'Mars', 'profile by number');

// ── every mulank 1..9 rates every din-ank 1..9 without throwing ──
let combos = 0;
for (let m = 1; m <= 9; m++) for (let d = 1; d <= 9; d++) { M.relation(m, d); combos++; }
eq(combos, 81, 'all 81 mulank×dinank combos valid');

console.log(`\n${fail === 0 ? '✓ ALL PASS' : '✗ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
