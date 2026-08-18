// =========================================
// MULANK — Ank Jyotish (Indian numerology) engine
// =========================================
//
// DETERMINISTIC layer for the Mulank feature. Everything here is pure
// arithmetic + fixed lookup tables — NO LLM, NO randomness. The same
// (date of birth, target date) ALWAYS yields the same numbers and the
// same favourable/neutral/caution rating. The LLM only ever receives
// this computed context and turns it into prose; it never calculates
// and never overrides the rating.
//
// ── Core numbers ─────────────────────────────────────────────
//   • Mulank (मूलांक)   = Psychic / root number. Reduce the DAY OF
//                         BIRTH (1–31) to a single digit 1–9.
//                         e.g. 14 -> 1+4 = 5 ; 23 -> 2+3 = 5 ; 9 -> 9.
//   • Bhagyank (भाग्यांक) = Destiny number. Reduce the FULL date of
//                         birth (dd + mm + yyyy) to 1–9.
//   • Din-ank (दिनांक)   = Day number of any target date, reduced the
//                         same way. This is what we compare the
//                         person's Mulank against to rate a day.
//
// ── Number ↔ planet ─────────────────────────────────────────
//   1 Sun · 2 Moon · 3 Jupiter · 4 Rahu · 5 Mercury · 6 Venus ·
//   7 Ketu · 8 Saturn · 9 Mars   (Vedic mapping — Rahu/Ketu, not
//   the Western Uranus/Neptune, to match the app's Vedic brand.)
//
// ── Honesty / scope (read before extending) ─────────────────
//   Numerology is a traditional belief system, not an empirically
//   validated predictor. What this engine is genuinely reliable at:
//     (1) the calculation  — exact, verifiable.
//     (2) day QUALITY       — favourable / neutral / caution, per the
//                             friendship table below.
//   What it must NEVER be asked to produce: specific event
//   predictions ("you'll get money Tuesday"). No rule generates those;
//   they are invention. The rating + life-area THEMES are the ceiling.
//
// ── The friendship table is the "rulebook" and is TUNABLE ────
//   FRIENDSHIP below is the one contested part of Ank Jyotish — authors
//   differ, especially on the shadow numbers 4 (Rahu) and 7 (Ketu).
//   It is deliberately a plain data table so it can be adjusted by a
//   numerologist WITHOUT touching logic. The default is derived from
//   Vedic naisargika-maitri (BPHS natural planetary friendships),
//   extended to the nodes by common Ank Jyotish convention (Rahu≈Saturn,
//   Ketu≈adaptable). Sources: Cheiro, *Book of Numbers*; BPHS Ch.3.
// =========================================

// Number -> ruling planet (Vedic).
const PLANET = {
  1: 'Sun', 2: 'Moon', 3: 'Jupiter', 4: 'Rahu', 5: 'Mercury',
  6: 'Venus', 7: 'Ketu', 8: 'Saturn', 9: 'Mars',
};

// FRIENDSHIP — from the MULANK's point of view, which din-ank numbers
// are friendly / hostile. Anything not listed is NEUTRAL. Self is
// always friendly. EDIT HERE to retune the rulebook.
const FRIENDSHIP = {
  1: { friends: [1, 2, 3, 9], enemies: [6, 8] },
  2: { friends: [1, 2, 5, 7], enemies: [4, 8] },
  3: { friends: [1, 2, 3, 5, 9], enemies: [6, 7] },
  4: { friends: [1, 4, 5, 6, 7, 8], enemies: [2, 9] },
  5: { friends: [1, 3, 5, 6, 9], enemies: [] },        // Mercury: adaptable, no true enemy
  6: { friends: [4, 5, 6, 8], enemies: [1, 2] },
  7: { friends: [1, 2, 4, 7], enemies: [] },           // Ketu: detached, no true enemy
  8: { friends: [4, 5, 6, 8], enemies: [1, 2, 9] },
  9: { friends: [1, 2, 3, 5, 9], enemies: [6, 8] },
};

// Traditional per-number profile — FACTS (planet, temperament, lucky
// day/colour/gem, life-area leanings). These are traditional
// associations (not one author's prose), written in our own words so
// they are safe to ship and to hand to the LLM as grounding.
const PROFILE = {
  1: {
    planet: 'Sun', title: 'The Leader',
    traits: ['independent', 'ambitious', 'authoritative', 'pioneering'],
    strengths: ['leadership', 'willpower', 'originality'],
    watch: ['ego', 'stubbornness', 'domineering'],
    luckyDay: 'Sunday', luckyColours: ['gold', 'orange', 'yellow'],
    luckyNumbers: [1, 2, 4], gem: 'Ruby',
    favoursAreas: ['career', 'authority', 'new beginnings'],
  },
  2: {
    planet: 'Moon', title: 'The Diplomat',
    traits: ['sensitive', 'intuitive', 'cooperative', 'imaginative'],
    strengths: ['empathy', 'adaptability', 'partnership'],
    watch: ['mood swings', 'indecision', 'over-sensitivity'],
    luckyDay: 'Monday', luckyColours: ['white', 'cream', 'silver'],
    luckyNumbers: [1, 2, 7], gem: 'Pearl',
    favoursAreas: ['relationships', 'home', 'emotions'],
  },
  3: {
    planet: 'Jupiter', title: 'The Optimist',
    traits: ['expressive', 'wise', 'disciplined', 'generous'],
    strengths: ['teaching', 'creativity', 'growth'],
    watch: ['over-confidence', 'preachiness', 'scattered energy'],
    luckyDay: 'Thursday', luckyColours: ['yellow', 'saffron', 'purple'],
    luckyNumbers: [3, 6, 9], gem: 'Yellow Sapphire',
    favoursAreas: ['learning', 'finance', 'guidance'],
  },
  4: {
    planet: 'Rahu', title: 'The Rebel',
    traits: ['unconventional', 'practical', 'hard-working', 'systematic'],
    strengths: ['endurance', 'problem-solving', 'reform'],
    watch: ['restlessness', 'sudden change', 'isolation'],
    luckyDay: 'Saturday', luckyColours: ['grey', 'blue', 'khaki'],
    luckyNumbers: [1, 7, 8], gem: 'Hessonite (Gomed)',
    favoursAreas: ['technology', 'research', 'unconventional work'],
  },
  5: {
    planet: 'Mercury', title: 'The Communicator',
    traits: ['quick', 'versatile', 'curious', 'sociable'],
    strengths: ['communication', 'trade', 'adaptability'],
    watch: ['restlessness', 'over-thinking', 'nervous energy'],
    luckyDay: 'Wednesday', luckyColours: ['green', 'turquoise'],
    luckyNumbers: [5, 6, 9], gem: 'Emerald',
    favoursAreas: ['communication', 'business', 'travel'],
  },
  6: {
    planet: 'Venus', title: 'The Nurturer',
    traits: ['charming', 'artistic', 'loving', 'responsible'],
    strengths: ['harmony', 'aesthetics', 'care'],
    watch: ['indulgence', 'people-pleasing', 'possessiveness'],
    luckyDay: 'Friday', luckyColours: ['white', 'pink', 'pastel blue'],
    luckyNumbers: [5, 6, 8], gem: 'Diamond / White Sapphire',
    favoursAreas: ['relationships', 'art', 'comfort'],
  },
  7: {
    planet: 'Ketu', title: 'The Seeker',
    traits: ['analytical', 'spiritual', 'introspective', 'independent'],
    strengths: ['research', 'intuition', 'depth'],
    watch: ['detachment', 'over-analysis', 'withdrawal'],
    luckyDay: 'Monday', luckyColours: ['smoky grey', 'sea-green'],
    luckyNumbers: [1, 2, 7], gem: "Cat's Eye",
    favoursAreas: ['spirituality', 'research', 'solitary work'],
  },
  8: {
    planet: 'Saturn', title: 'The Achiever',
    traits: ['disciplined', 'ambitious', 'patient', 'responsible'],
    strengths: ['perseverance', 'organisation', 'long-term building'],
    watch: ['rigidity', 'delays', 'pessimism'],
    luckyDay: 'Saturday', luckyColours: ['dark blue', 'black', 'purple'],
    luckyNumbers: [4, 5, 6], gem: 'Blue Sapphire',
    favoursAreas: ['career', 'discipline', 'long-term goals'],
  },
  9: {
    planet: 'Mars', title: 'The Warrior',
    traits: ['energetic', 'courageous', 'determined', 'protective'],
    strengths: ['drive', 'leadership', 'action'],
    watch: ['impatience', 'anger', 'impulsiveness'],
    luckyDay: 'Tuesday', luckyColours: ['red', 'crimson', 'coral'],
    luckyNumbers: [3, 6, 9], gem: 'Red Coral',
    favoursAreas: ['action', 'sports', 'competition'],
  },
};

// ── digit reduction ─────────────────────────────────────────
// Reduce any positive integer to a single digit 1–9 by repeated
// digit-sum. (Mulank/din-ank never keep "master numbers" — those
// belong to a different numerology layer we are not building here.)
function reduceToDigit(n) {
  n = Math.abs(Math.trunc(n));
  while (n > 9) {
    let s = 0;
    while (n > 0) { s += n % 10; n = Math.floor(n / 10); }
    n = s;
  }
  return n === 0 ? 9 : n; // guard: only hit for n===0; treat as 9
}

// ── date parsing ────────────────────────────────────────────
// Accepts a Date, a 'YYYY-MM-DD' / 'YYYY/MM/DD' string, or a
// 'DD-MM-YYYY' string. Returns {year, month, day} in LOCAL civil
// terms (no timezone math — a birth DATE is a civil date).
function parseCivilDate(input) {
  if (input instanceof Date) {
    return { year: input.getFullYear(), month: input.getMonth() + 1, day: input.getDate() };
  }
  if (typeof input === 'number') {
    // bare day-of-month (1–31) — only valid for mulank()
    return { year: null, month: null, day: input };
  }
  const s = String(input).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/); // YYYY-MM-DD
  if (m) return { year: +m[1], month: +m[2], day: +m[3] };
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);     // DD-MM-YYYY
  if (m) return { year: +m[3], month: +m[2], day: +m[1] };
  throw new Error(`mulank: unrecognised date "${input}" (use YYYY-MM-DD)`);
}

// ── core numbers ────────────────────────────────────────────

// Mulank / psychic number — from day of birth only.
function mulank(dob) {
  const { day } = parseCivilDate(dob);
  if (!(day >= 1 && day <= 31)) throw new Error(`mulank: bad day ${day}`);
  return reduceToDigit(day);
}

// Bhagyank / destiny number — from the full date of birth.
function bhagyank(dob) {
  const { year, month, day } = parseCivilDate(dob);
  if (year == null) throw new Error('bhagyank: needs a full date (YYYY-MM-DD)');
  return reduceToDigit(day + month + year);
}

// Din-ank / day number of a target date.
function dinAnk(date) {
  const { year, month, day } = parseCivilDate(date);
  if (year == null) return reduceToDigit(day);
  return reduceToDigit(day + month + year);
}

// Relation of a din-ank D as seen by a mulank M.
function relation(mulankNum, dinAnkNum) {
  const f = FRIENDSHIP[mulankNum];
  if (!f) throw new Error(`relation: bad mulank ${mulankNum}`);
  if (f.friends.includes(dinAnkNum)) return 'friend';
  if (f.enemies.includes(dinAnkNum)) return 'enemy';
  return 'neutral';
}

const RATING_OF = { friend: 'favourable', neutral: 'neutral', enemy: 'caution' };
const SCORE_OF = { friend: 1, neutral: 0, enemy: -1 };

// ── ratings ─────────────────────────────────────────────────

// Rate a single day for a KNOWN mulank number. This is the core — both
// the DOB-based API and the by-mulank pre-generation (cron) go through it.
function rateDay(m, date) {
  if (!(m >= 1 && m <= 9)) throw new Error(`rateDay: bad mulank ${m}`);
  const d = dinAnk(date);
  const rel = relation(m, d);
  const { year, month, day } = parseCivilDate(date);
  return {
    date: year != null ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null,
    mulank: m,
    mulankPlanet: PLANET[m],
    dinAnk: d,
    dinAnkPlanet: PLANET[d],
    relation: rel,
    rating: RATING_OF[rel],
    score: SCORE_OF[rel],
    favoursAreas: PROFILE[m].favoursAreas,
  };
}

// Rate a single day for a person (resolves mulank from DOB, then rateDay).
function dayRating(dob, date) {
  return rateDay(mulank(dob), date);
}

// Aggregate an inclusive span [start, end] for a KNOWN mulank number.
function rateSpan(m, startDate, endDate) {
  const s = parseCivilDate(startDate);
  const e = parseCivilDate(endDate);
  const start = new Date(s.year, s.month - 1, s.day);
  const end = new Date(e.year, e.month - 1, e.day);
  const days = [];
  let sum = 0, fav = 0, neu = 0, cau = 0;
  for (let t = new Date(start); t <= end; t.setDate(t.getDate() + 1)) {
    const r = rateDay(m, new Date(t));
    days.push(r);
    sum += r.score;
    if (r.rating === 'favourable') fav++;
    else if (r.rating === 'caution') cau++;
    else neu++;
  }
  // Overall verdict from the mean score.
  const mean = days.length ? sum / days.length : 0;
  let overall = 'neutral';
  if (mean >= 0.34) overall = 'favourable';
  else if (mean <= -0.34) overall = 'caution';
  const best = days.filter(d => d.rating === 'favourable').map(d => d.date);
  const caution = days.filter(d => d.rating === 'caution').map(d => d.date);
  return {
    from: days[0] && days[0].date,
    to: days[days.length - 1] && days[days.length - 1].date,
    mulank: m,
    counts: { favourable: fav, neutral: neu, caution: cau },
    score: sum,
    meanScore: Math.round(mean * 100) / 100,
    overall,
    bestDays: best,
    cautionDays: caution,
    days,
  };
}

// Span aggregate for a person (resolves mulank from DOB).
function spanRating(dob, startDate, endDate) {
  return rateSpan(mulank(dob), startDate, endDate);
}

// Week (7 inclusive days from startDate) — by-mulank and by-DOB.
function weekForMulank(m, startDate) {
  const s = parseCivilDate(startDate);
  const start = new Date(s.year, s.month - 1, s.day);
  const end = new Date(start); end.setDate(end.getDate() + 6);
  return rateSpan(m, start, end);
}
function weekRating(dob, startDate) {
  return weekForMulank(mulank(dob), startDate);
}

// Whole calendar month — by-mulank and by-DOB.
function monthForMulank(m, year, month) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0); // day 0 of next month = last day
  return rateSpan(m, start, end);
}
function monthRating(dob, year, month) {
  return monthForMulank(mulank(dob), year, month);
}

// Static personality profile for a mulank (the "who you are" content).
function profileFor(dob) {
  const m = typeof dob === 'number' && dob >= 1 && dob <= 9 ? dob : mulank(dob);
  return { mulank: m, ...PROFILE[m] };
}

module.exports = {
  PLANET, FRIENDSHIP, PROFILE,
  reduceToDigit, parseCivilDate,
  mulank, bhagyank, dinAnk, relation,
  dayRating, weekRating, monthRating, spanRating, profileFor,
  // by-mulank core (used by the pre-generation cron):
  rateDay, rateSpan, weekForMulank, monthForMulank,
};
