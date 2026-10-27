// Self-test for the free-tier chat paywall teaser.
// Run: `node lib/paywall-teaser.test.js`
//
// The teaser is shown to a user who has just been refused, so it has two
// hard requirements and both are easy to break silently:
//
//   1. It must be TRUE and specific to their chart. A vague line reads as
//      a horoscope-app platitude and actively undermines the claim that
//      the paid reading is grounded in anything.
//   2. It must NOT interpret. Stating placements is a free fact; saying
//      what they mean is the reading being given away, and guessing at it
//      is exactly where a wrong answer would come from.
//
// The fixture is a real chart — Aries lagna, Moon in the 7th in Libra,
// Saturn and Mercury in the 3rd in Gemini — so the expected strings are
// checkable by hand against a chart rather than against themselves.

const { buildTeaser, ordinal, joinNames } = require('./paywall-teaser');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  if (actual === expected) { pass++; }
  else { fail++; console.error(`✗ ${label}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`); }
}
function ok(cond, label) {
  if (cond) pass++; else { fail++; console.error(`✗ ${label}`); }
}

// Aries ascendant, so whole-sign house lords run Mars, Venus, Mercury,
// Moon, Sun, Mercury, Venus, Mars, Jupiter, Saturn, Saturn, Jupiter.
const ARIES_LORDS = [
  'Mars', 'Venus', 'Mercury', 'Moon', 'Sun', 'Mercury',
  'Venus', 'Mars', 'Jupiter', 'Saturn', 'Saturn', 'Jupiter',
];

const chart = {
  dasha: { houseLords: ARIES_LORDS },
  planets: {
    Sun: { sign: 'Gemini', house: 3, nakshatra: 'Ardra' },
    Moon: { sign: 'Libra', house: 7, nakshatra: 'Swati' },
    Mars: { sign: 'Aquarius', house: 11, nakshatra: 'Shatabhisha' },
    Mercury: { sign: 'Gemini', house: 3, nakshatra: 'Mrigashira' },
    Jupiter: { sign: 'Cancer', house: 4, nakshatra: 'Pushya' },
    Venus: { sign: 'Taurus', house: 2, nakshatra: 'Rohini' },
    Saturn: { sign: 'Gemini', house: 3, nakshatra: 'Mrigashira' },
    Rahu: { sign: 'Taurus', house: 2, nakshatra: 'Rohini' },
    Ketu: { sign: 'Scorpio', house: 8, nakshatra: 'Anuradha' },
  },
};

// ── helpers ──
eq(ordinal(1), '1st', 'ordinal 1');
eq(ordinal(2), '2nd', 'ordinal 2');
eq(ordinal(3), '3rd', 'ordinal 3');
eq(ordinal(4), '4th', 'ordinal 4');
eq(ordinal(7), '7th', 'ordinal 7');
eq(ordinal(11), '11th', 'ordinal 11 is not 11st');
eq(ordinal(12), '12th', 'ordinal 12 is not 12nd');
eq(ordinal(13), '13th', 'ordinal 13 is not 13rd');

eq(joinNames([]), '', 'join none');
eq(joinNames(['Mars']), 'Mars', 'join one');
eq(joinNames(['Mars', 'Saturn']), 'Mars and Saturn', 'join two');
eq(joinNames(['Mars', 'Saturn', 'Venus']), 'Mars, Saturn and Venus', 'join three');

// ── an occupied house ──
{
  const r = buildTeaser({ chart, topics: ['marriage'] });
  ok(r !== null, 'marriage produces a teaser');
  eq(r.house, 7, 'marriage maps to the 7th');
  eq(r.line,
    'Marriage and partnership runs through your 7th house, where Moon sits in Libra, under Venus.',
    'the 7th-house line is exact');
}

// ── several occupants, correct verb agreement ──
{
  const r = buildTeaser({ chart, topics: ['education'] });  // 4th house
  ok(r !== null, 'education produces a teaser');
  eq(r.house, 4, 'education maps to the 4th');
  ok(/Jupiter sits/.test(r.line), 'single occupant uses "sits"');
}
{
  // The 3rd holds Sun, Mercury and Saturn. No topic maps to the 3rd, so
  // drive it directly through a topic that does share a crowded house.
  const crowded = {
    dasha: { houseLords: ARIES_LORDS },
    planets: {
      Venus: { sign: 'Libra', house: 7 },
      Jupiter: { sign: 'Libra', house: 7 },
    },
  };
  const r = buildTeaser({ chart: crowded, topics: ['marriage'] });
  ok(/Venus and Jupiter sit in Libra/.test(r.line),
    'two occupants use "sit" and are joined with "and"');
}

// ── an empty house falls back to its lord ──
{
  // The 10th is empty, and its lord for an Aries chart is Saturn — which
  // must therefore sit somewhere ELSE for this case to be the empty one.
  const empty = {
    dasha: { houseLords: ARIES_LORDS },
    planets: { Saturn: { sign: 'Gemini', house: 3 } },
  };
  const r = buildTeaser({ chart: empty, topics: ['career'] });  // 10th
  ok(r !== null, 'an empty topic house still produces a teaser');
  ok(/no planet occupies/.test(r.line), 'says the house is empty');
  ok(/lord is Saturn/.test(r.line), 'names the lord');
  ok(/3rd house/.test(r.line), 'and where that lord actually sits');
}

// ── topic selection: the real subject must beat 'timing' ──
{
  // "when will I get married" classifies as BOTH timing and marriage, and
  // detectQuestionTopics returns them in its own fixed order rather than
  // by relevance. Picking the first topic blindly would answer a marriage
  // question with a line about nothing.
  const r = buildTeaser({ chart, topics: ['marriage', 'timing'] });
  eq(r.house, 7, 'marriage wins when listed first');
  const r2 = buildTeaser({ chart, topics: ['timing', 'marriage'] });
  ok(r2 !== null, 'still produces a teaser when timing is listed first');
  eq(r2.house, 7, 'and timing is skipped in favour of marriage');
}

// ── topics with no house of their own produce nothing ──
{
  for (const t of [['general'], ['timing'], ['remedies'], ['timing', 'general']]) {
    eq(buildTeaser({ chart, topics: t }), null,
      `${JSON.stringify(t)} has no house to ground a line in`);
  }
}

// ── degrades instead of throwing ──
{
  eq(buildTeaser({ chart: null, topics: ['marriage'] }), null, 'no chart');
  eq(buildTeaser({ chart: {}, topics: ['marriage'] }), null, 'chart with no planets');
  eq(buildTeaser({ chart, topics: [] }), null, 'no topics');
  eq(buildTeaser({ chart, topics: null }), null, 'null topics');
  // A chart with neither an occupant nor a resolvable lord for the topic
  // house has nothing specific left to say.
  eq(buildTeaser({
    chart: { dasha: { houseLords: [] }, planets: { Sun: { sign: 'Leo', house: 5 } } },
    topics: ['marriage'],
  }), null, 'no occupant and no lord');
}

// ── it states placements, it does not predict ──
{
  // Interpretation is the product. A teaser that drifted into it would
  // either give the reading away or invent one, and both are worse than
  // saying less.
  const banned = [
    'will', 'shall', 'going to', 'promises', 'guarantees', 'destined',
    'lucky', 'unlucky', 'danger', 'blessed', 'cursed', 'expect',
    'favourable', 'unfavourable', 'should',
  ];
  const topics = ['marriage', 'career', 'finance', 'children', 'health',
    'foreign', 'education', 'spirituality', 'family', 'personality'];
  let clean = true;
  for (const t of topics) {
    const r = buildTeaser({ chart, topics: [t] });
    if (!r) continue;
    const lower = r.line.toLowerCase();
    for (const w of banned) {
      if (new RegExp(`\\b${w}\\b`).test(lower)) {
        clean = false;
        console.error(`✗ teaser for ${t} predicts: contains "${w}" — ${r.line}`);
      }
    }
    if (!/\.$/.test(r.line)) { clean = false; console.error(`✗ ${t} line has no full stop`); }
    if (r.line.length > 160) { clean = false; console.error(`✗ ${t} line is ${r.line.length} chars`); }
  }
  ok(clean, 'no teaser interprets, and all are one short sentence');
}

console.log(`\npaywall-teaser: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
