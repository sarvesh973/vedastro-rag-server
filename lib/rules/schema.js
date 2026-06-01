// =========================================
// RULE SCHEMA — typed shape for AstroRules
// =========================================
//
// Every rule in lib/rules/<domain>.js conforms to this shape. The
// evaluator (lib/rules/evaluator.js) iterates rules, runs their
// predicates against a chart, and returns matched rules — which the
// LLM then PRESENTS in natural language (without inventing new
// predictions).
//
// This is the central architectural shift from "LLM hallucinates
// astrology" to "deterministic engine + LLM as natural-language
// presenter".

/**
 * @typedef {Object} AstroRuleSource
 * @property {string} book      e.g. 'BPHS', 'Phaladeepika', 'Saravali'
 * @property {(number|string)} chapter
 * @property {string=} verse    optional verse number(s)
 */

/**
 * @typedef {Object} AstroRulePrediction
 * @property {('positive'|'negative'|'neutral'|'mixed')} polarity
 * @property {string} text                     short, citable result text
 * @property {('lifetime'|'currentDasha'|'transit'|'7thLordDasha'|string)} timeframe
 */

/**
 * @typedef {Object} AstroRulePredicateResult
 * @property {boolean} matched
 * @property {number=} intensity              0-10 (10 = strongest)
 * @property {string=} evidence               why it matched (cited in prompt)
 * @property {string=} cancelled              non-null if rule fired but was
 *                                           cancelled by a counter-rule
 */

/**
 * @typedef {Object} AstroRule
 * @property {string} id                      stable string ID, snake_case
 * @property {string} domain                  'marriage'|'career'|'wealth'|...
 * @property {AstroRuleSource} source         classical text reference
 * @property {(chart: object) => AstroRulePredicateResult} predicate
 * @property {AstroRulePrediction} prediction
 * @property {string=} note                   optional clarifying note for the LLM
 */

// Helper used by rule predicates to access chart facts uniformly.
// Tolerates the various shapes @prisri/jyotish vs our wrappers emit.

const SIGN_ORDER = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
];

function signIdx(sign) {
  if (!sign) return -1;
  const m = String(sign).match(/\(([^)]+)\)/);
  const name = m ? m[1].trim() : String(sign).trim();
  return SIGN_ORDER.findIndex(s => s.toLowerCase() === name.toLowerCase());
}

function planetSign(chart, name) {
  const p = chart.planets && chart.planets[name];
  if (!p) return null;
  return SIGN_ORDER[signIdx(p.sign || p.rashiName)];
}

function planetHouse(chart, name) {
  const p = chart.planets && chart.planets[name];
  if (!p) return -1;
  if (typeof p.house === 'number') return p.house;
  const psign = signIdx(planetSign(chart, name));
  const lsign = signIdx(chart.ascendant && (chart.ascendant.sign || chart.ascendant.rashiName));
  if (psign < 0 || lsign < 0) return -1;
  return ((psign - lsign + 12) % 12) + 1;
}

const SIGN_LORD = {
  Aries: 'Mars', Taurus: 'Venus', Gemini: 'Mercury',
  Cancer: 'Moon', Leo: 'Sun', Virgo: 'Mercury',
  Libra: 'Venus', Scorpio: 'Mars', Sagittarius: 'Jupiter',
  Capricorn: 'Saturn', Aquarius: 'Saturn', Pisces: 'Jupiter',
};

const OWN_SIGNS = {
  Sun: ['Leo'], Moon: ['Cancer'], Mars: ['Aries', 'Scorpio'],
  Mercury: ['Gemini', 'Virgo'], Jupiter: ['Sagittarius', 'Pisces'],
  Venus: ['Taurus', 'Libra'], Saturn: ['Capricorn', 'Aquarius'],
};
const EXALT_SIGN = {
  Sun: 'Aries', Moon: 'Taurus', Mars: 'Capricorn',
  Mercury: 'Virgo', Jupiter: 'Cancer', Venus: 'Pisces', Saturn: 'Libra',
};
const DEBIL_SIGN = {
  Sun: 'Libra', Moon: 'Scorpio', Mars: 'Cancer',
  Mercury: 'Pisces', Jupiter: 'Capricorn', Venus: 'Virgo', Saturn: 'Aries',
};

// Lord of the nth house counted from Lagna.
function lordOfHouse(chart, n) {
  const lsign = signIdx(chart.ascendant && (chart.ascendant.sign || chart.ascendant.rashiName));
  if (lsign < 0) return null;
  const houseSign = SIGN_ORDER[(lsign + n - 1) % 12];
  return SIGN_LORD[houseSign];
}

function isOwnSign(chart, p) {
  return (OWN_SIGNS[p] || []).includes(planetSign(chart, p));
}
function isExalted(chart, p) {
  return planetSign(chart, p) === EXALT_SIGN[p];
}
function isDebilitated(chart, p) {
  return planetSign(chart, p) === DEBIL_SIGN[p];
}

// 1-based aspect helpers.
const SATURN_ASPECTS = [3, 7, 10];
const JUPITER_ASPECTS = [5, 7, 9];
const MARS_ASPECTS = [4, 7, 8];
const RAHU_ASPECTS = [5, 7, 9]; // some traditions; commonly accepted

function aspectsHouse(chart, planet, targetHouse) {
  const ph = planetHouse(chart, planet);
  if (ph < 0) return false;
  const rel = ((targetHouse - ph) + 12) % 12 + 1;
  if (rel === 1) return true; // occupies (also "aspects" itself)
  if (planet === 'Saturn') return SATURN_ASPECTS.includes(rel);
  if (planet === 'Jupiter') return JUPITER_ASPECTS.includes(rel);
  if (planet === 'Mars') return MARS_ASPECTS.includes(rel);
  if (planet === 'Rahu' || planet === 'Ketu') return RAHU_ASPECTS.includes(rel);
  // Sun, Moon, Mercury, Venus: standard 7th aspect only
  return rel === 7;
}

function planetsInHouse(chart, h) {
  // Use chart.houses if available
  if (Array.isArray(chart.houses)) {
    const hObj = chart.houses.find(x => x.number === h);
    if (hObj && Array.isArray(hObj.planets)) return hObj.planets;
  }
  // Fallback: iterate planets
  const out = [];
  for (const p of Object.keys(chart.planets || {})) {
    if (planetHouse(chart, p) === h) out.push(p);
  }
  return out;
}

const BENEFICS = ['Jupiter', 'Venus', 'Mercury', 'Moon'];
const MALEFICS = ['Sun', 'Mars', 'Saturn', 'Rahu', 'Ketu'];

// Retrograde check. @prisri/jyotish sets isRetrograde on each planet
// (Sun and Moon never retrograde). Rahu/Ketu are technically always
// retrograde but classical interpretation treats them as exceptions —
// we return their actual data-flag value.
function isRetrograde(chart, p) {
  return !!(chart.planets && chart.planets[p] && chart.planets[p].isRetrograde);
}

// Combust = planet within the Sun's orb (classical bands per Phaladeepika
// Ch.13): Moon 12°, Mars 17°, Mercury 14° (or 12° if retrograde),
// Jupiter 11°, Venus 10° (or 8° if retrograde), Saturn 15°. We use the
// shortest angular distance, modulo 360.
const COMBUST_ORB = { Moon: 12, Mars: 17, Mercury: 14, Jupiter: 11, Venus: 10, Saturn: 15 };

function isCombust(chart, p) {
  if (p === 'Sun' || p === 'Rahu' || p === 'Ketu') return false;
  const orb = COMBUST_ORB[p];
  if (!orb) return false;
  const planet = chart.planets && chart.planets[p];
  const sun = chart.planets && chart.planets.Sun;
  if (!planet || !sun) return false;
  if (typeof planet.longitude !== 'number' || typeof sun.longitude !== 'number') return false;
  let diff = Math.abs(planet.longitude - sun.longitude) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff <= orb;
}

// Dasha layer hit-check. Returns 'maha' | 'antar' | 'pratyantar' | null.
// Classical predictive Vedic anchors event timing at the PRATYANTAR
// (3rd-level sub-period), not just mahadasha+antardasha — many events
// happen during pratyantar of a sensitive planet even if its
// mahadasha is far away. Rules use this so a single API change
// expands their dasha-window coverage without rewriting predicates.
function dashaActive(chart, planet) {
  if (!chart || !chart.dasha) return null;
  if (chart.dasha.mahadasha === planet) return 'maha';
  if (chart.dasha.antardasha === planet) return 'antar';
  if (chart.dasha.pratyantar === planet) return 'pratyantar';
  return null;
}

// Intensity bump per dasha layer — deeper layer = stronger trigger
// (the event is closer in time, more precisely timed).
function dashaIntensity(layer) {
  if (layer === 'maha') return 7;        // active for years
  if (layer === 'antar') return 8;       // active for months
  if (layer === 'pratyantar') return 9;  // active for weeks — strongest event timing
  return 0;
}

module.exports = {
  SIGN_ORDER,
  SIGN_LORD,
  OWN_SIGNS,
  EXALT_SIGN,
  DEBIL_SIGN,
  BENEFICS,
  MALEFICS,
  signIdx,
  planetSign,
  planetHouse,
  lordOfHouse,
  isOwnSign,
  isExalted,
  isDebilitated,
  isRetrograde,
  isCombust,
  aspectsHouse,
  planetsInHouse,
  dashaActive,
  dashaIntensity,
};
