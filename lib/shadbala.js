// =========================================
// SHADBALA — 6-fold planet strength
// =========================================
//
// "How much CAPACITY does this planet have to deliver results in
// its dasha?" Without shadbala, the LLM has no way to know whether
// a "Saturn dasha" prediction is for a STRONG Saturn (will deliver
// big rewards through discipline) or a WEAK Saturn (will fizzle and
// produce minor effects).
//
// Six components (BPHS Ch.27):
//   1. Sthana Bala  — positional (exalted/own/friendly/enemy/debilitated)
//   2. Dig Bala     — directional (each planet has a strong direction)
//   3. Kala Bala    — temporal (day vs night, season, etc.)
//   4. Cheshta Bala — motional (retrograde/swift/slow — non-luminaries)
//   5. Naisargika Bala — natural inherent strength rank
//   6. Drik Bala    — aspectual (sum of benefic minus malefic aspects)
//
// Full BPHS shadbala uses Virupas (units, 60 = 1 Rupa) with planet-
// specific minimum thresholds:
//   Sun ≥ 5 Rupas, Moon ≥ 6, Mars ≥ 5, Mercury ≥ 7, Jupiter ≥ 6.5,
//   Venus ≥ 5.5, Saturn ≥ 5. Below threshold = "weak", deserves
//   remedy. Above = "strong", delivers results in dasha.
//
// This module is a SIMPLIFIED implementation — it captures the
// dominant components (Sthana, Dig, Naisargika) which together
// account for ~70% of total Shadbala in real charts. Full Kala +
// Cheshta + Drik can be added later without breaking the API.

const SIGN_ORDER = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
];

const EXALT_DEG = {  // sign + degree of deep exaltation
  Sun: { sign: 'Aries', degree: 10 },
  Moon: { sign: 'Taurus', degree: 3 },
  Mars: { sign: 'Capricorn', degree: 28 },
  Mercury: { sign: 'Virgo', degree: 15 },
  Jupiter: { sign: 'Cancer', degree: 5 },
  Venus: { sign: 'Pisces', degree: 27 },
  Saturn: { sign: 'Libra', degree: 20 },
};

const OWN_SIGNS = {
  Sun: ['Leo'],
  Moon: ['Cancer'],
  Mars: ['Aries', 'Scorpio'],
  Mercury: ['Gemini', 'Virgo'],
  Jupiter: ['Sagittarius', 'Pisces'],
  Venus: ['Taurus', 'Libra'],
  Saturn: ['Capricorn', 'Aquarius'],
};

// Permanent friendships (Naisargika Maitri) — classical BPHS Ch.3.
const FRIENDS = {
  Sun:     ['Moon', 'Mars', 'Jupiter'],
  Moon:    ['Sun', 'Mercury'],
  Mars:    ['Sun', 'Moon', 'Jupiter'],
  Mercury: ['Sun', 'Venus'],
  Jupiter: ['Sun', 'Moon', 'Mars'],
  Venus:   ['Mercury', 'Saturn'],
  Saturn:  ['Mercury', 'Venus'],
};
const ENEMIES = {
  Sun:     ['Venus', 'Saturn'],
  Moon:    [],  // Moon has no enemies
  Mars:    ['Mercury'],
  Mercury: ['Moon'],
  Jupiter: ['Mercury', 'Venus'],
  Venus:   ['Sun', 'Moon'],
  Saturn:  ['Sun', 'Moon', 'Mars'],
};
// Neutrals are everyone else.

// Directional strength — each planet has a "home" house (kendra) where
// it's fully strong; opposite house is fully weak. 60 Virupas at home,
// 0 at opposite, linear interpolation in between.
const DIG_HOUSE = {
  Sun: 10, Moon: 4, Mars: 10, Mercury: 1,
  Jupiter: 1, Venus: 4, Saturn: 7,
};

// Naisargika Bala — natural inherent strength. Fixed ranks per BPHS.
const NAISARGIKA = {
  Sun:     60.0,
  Moon:    51.43,
  Venus:   42.86,
  Jupiter: 34.29,
  Mercury: 25.71,
  Mars:    17.14,
  Saturn:  8.57,
};

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

function planetDegInSign(chart, name) {
  const p = chart.planets && chart.planets[name];
  if (!p) return null;
  if (typeof p.degree === 'number' && p.degree < 30) return p.degree;
  if (typeof p.longitude === 'number') return p.longitude % 30;
  return null;
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

// ─── 1. STHANA BALA (positional) ───
// Simplified: Uchcha Bala only — distance from deep debilitation point.
// Range 0-60 Virupas. Exalted = 60, debilitated = 0, linear.
function uchchaBala(chart, planet) {
  const sign = planetSign(chart, planet);
  const deg = planetDegInSign(chart, planet);
  if (!sign || deg == null) return 0;
  const ex = EXALT_DEG[planet];
  if (!ex) return 0;
  // Convert planet position + exaltation point to 0-360 longitudes
  const planetLon = (signIdx(sign) * 30) + deg;
  const exLon = (signIdx(ex.sign) * 30) + ex.degree;
  // Distance from deep debilitation (opposite exaltation, 180° away)
  const debilLon = (exLon + 180) % 360;
  const dist = Math.min(
    Math.abs(planetLon - debilLon),
    360 - Math.abs(planetLon - debilLon)
  );
  // 180° from debilitation = full Uchcha (60 Virupas)
  return (dist / 180) * 60;
}

// ─── 2. DIG BALA (directional) ───
function digBala(chart, planet) {
  const home = DIG_HOUSE[planet];
  const h = planetHouse(chart, planet);
  if (!home || h < 0) return 0;
  // Distance from the home house (1-6 max).
  let dist = Math.abs(h - home);
  if (dist > 6) dist = 12 - dist;
  // Linear: dist 0 → 60 Virupas, dist 6 → 0 Virupas.
  return ((6 - dist) / 6) * 60;
}

// ─── 5. NAISARGIKA BALA (natural rank) ───
function naisargikaBala(planet) {
  return NAISARGIKA[planet] || 0;
}

// ─── Friend/enemy relationship of planet with its sign-lord ───
function relationshipBala(chart, planet) {
  const sign = planetSign(chart, planet);
  if (!sign) return 0;
  if ((OWN_SIGNS[planet] || []).includes(sign)) return 45;  // own
  const lord = require('./yogas').YOGAS && null; // avoid circular
  // Use a local sign-lord map (duplicate small data to avoid coupling).
  const SIGN_LORD = {
    Aries: 'Mars', Taurus: 'Venus', Gemini: 'Mercury',
    Cancer: 'Moon', Leo: 'Sun', Virgo: 'Mercury',
    Libra: 'Venus', Scorpio: 'Mars', Sagittarius: 'Jupiter',
    Capricorn: 'Saturn', Aquarius: 'Saturn', Pisces: 'Jupiter',
  };
  const signLord = SIGN_LORD[sign];
  if (signLord === planet) return 45; // own (caught above usually)
  if ((FRIENDS[planet] || []).includes(signLord)) return 30;  // friend's sign
  if ((ENEMIES[planet] || []).includes(signLord)) return 7.5; // enemy
  return 15; // neutral
}

// Combine the implemented components into total Shadbala (in Rupas).
function computeShadbala(chart) {
  if (!chart || !chart.planets) return null;

  const planets = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn'];
  const out = {};
  const thresholds = {
    Sun: 5.0, Moon: 6.0, Mars: 5.0, Mercury: 7.0,
    Jupiter: 6.5, Venus: 5.5, Saturn: 5.0,
  };

  const scored = [];
  for (const p of planets) {
    const sthana = uchchaBala(chart, p) + relationshipBala(chart, p);
    const dig = digBala(chart, p);
    const naisargika = naisargikaBala(p);
    const totalVirupas = sthana + dig + naisargika;
    scored.push({ planet: p, sthana, dig, naisargika, totalVirupas });
  }

  // Rank by total (descending) — the LLM uses relative ordering since
  // we only have 3 of 6 components; absolute thresholds aren't valid
  // yet but "Jupiter is the strongest planet in this chart" is.
  scored.sort((a, b) => b.totalVirupas - a.totalVirupas);

  const max = scored[0].totalVirupas;
  const min = scored[scored.length - 1].totalVirupas;
  const range = Math.max(max - min, 1);

  scored.forEach((s, rank) => {
    // Normalize to 0-100 relative-strength score
    const normalized = ((s.totalVirupas - min) / range) * 100;
    const label = rank === 0 ? 'strongest'
                : rank === 1 ? 'very strong'
                : rank < 4 ? 'moderate'
                : rank === scored.length - 1 ? 'weakest'
                : 'weak';
    out[s.planet] = {
      sthanaBala: Math.round(s.sthana * 10) / 10,
      digBala: Math.round(s.dig * 10) / 10,
      naisargikaBala: Math.round(s.naisargika * 10) / 10,
      totalVirupas: Math.round(s.totalVirupas * 10) / 10,
      relativeStrength: Math.round(normalized),
      rank: rank + 1,
      label,
    };
  });

  out._note = 'Simplified Shadbala — covers Sthana, Dig, Naisargika components. ' +
    'Full Kala / Cheshta / Drik Bala not yet implemented. ' +
    'Use the rank order for predictive weight; absolute totals are not normative yet.';

  return out;
}

module.exports = { computeShadbala };
