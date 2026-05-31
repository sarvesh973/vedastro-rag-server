// =========================================
// TRANSITS — slow-planet event triggers
// =========================================
//
// Major life events in Vedic astrology are timed by SLOW PLANET
// transits (Saturn, Jupiter, Rahu, Ketu) over sensitive natal points.
//
// This module computes:
//   - Current positions of slow planets (live, today's date)
//   - Sade Sati (Saturn cycle around natal Moon — 7.5 year period)
//   - Dhaiya (Saturn in 4th/8th from Moon — ~2.5 year periods)
//   - Jupiter house-transit from natal Moon (favourable/unfavourable)
//   - Double-transit alerts (Saturn AND Jupiter both aspecting a key house)
//   - Cross-reference with Ashtakavarga bindus for transit-delivery
//     prediction ("Saturn enters your 7th with 5 bindus there =
//     significant relationship impact" vs "with 2 bindus = muted")
//
// Without this, the LLM has to GUESS when events will happen. With
// this, it gets concrete computed alerts to ground predictions in.
//
// Sources: BPHS Ch.45 (Gochara); Phaladeepika Ch.26-27; classical
// Vedic transit tables.

const { getKundli, Observer } = require('@prisri/jyotish');

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

// Aspects: Saturn aspects 3rd, 7th, 10th houses from itself.
//          Jupiter aspects 5th, 7th, 9th from itself.
//          Mars aspects 4th, 7th, 8th from itself.
// (We only use Saturn + Jupiter for transit predictions — Mars is too
// fast to matter for life-event timing.)
const SATURN_ASPECTS = [3, 7, 10];
const JUPITER_ASPECTS = [5, 7, 9];

// House-from-house: 1-based.
function houseFromTo(fromIdx, toIdx) {
  return ((toIdx - fromIdx) + 12) % 12 + 1;
}

// Get current (today, anywhere on earth — slow planets don't care about
// observer location for our purposes) positions of slow planets.
// Returns: { Saturn: 'Pisces', Jupiter: 'Gemini', Rahu: 'Aquarius', Ketu: 'Leo' }
function getCurrentSlowPlanets() {
  // Observer at Delhi — doesn't matter for slow planet signs since
  // they move so slowly. Lat/lon only affects fast things like Lagna.
  const now = getKundli(new Date(), new Observer(28.6139, 77.209, 0));
  const out = {};
  for (const p of ['Saturn', 'Jupiter', 'Rahu', 'Ketu']) {
    const data = now.planets[p];
    if (data) {
      out[p] = {
        sign: SIGN_ORDER[signIdx(data.rashiName)],
        degree: Math.floor(data.longitude % 30),
        nakshatra: data.nakshatra,
      };
    }
  }
  return out;
}

// ─── SADE SATI ───
// Saturn transit through 12th / 1st / 2nd house from natal Moon.
// Each phase ~2.5 years (Saturn's per-sign dwell time).
function detectSadeSati(natalMoonSign, currentSaturnSign) {
  const moonIdx = signIdx(natalMoonSign);
  const satIdx = signIdx(currentSaturnSign);
  if (moonIdx < 0 || satIdx < 0) return null;

  const rel = houseFromTo(moonIdx, satIdx);  // Saturn's house FROM moon (1..12)

  if (rel === 12) return {
    active: true,
    phase: 'starting',
    description: 'Sade Sati starting phase — Saturn in 12th from natal Moon. ~2.5 years of preparation, financial reorganisation, possible relocation. The hardest phase emotionally is yet to come.',
  };
  if (rel === 1) return {
    active: true,
    phase: 'peak',
    description: 'Sade Sati PEAK phase — Saturn in same sign as natal Moon. ~2.5 years of maximum pressure. Health, career, mental state all tested. Discipline rewarded; ego dissolved.',
  };
  if (rel === 2) return {
    active: true,
    phase: 'ending',
    description: 'Sade Sati ending phase — Saturn in 2nd from natal Moon. ~2.5 years of financial consolidation. The hardest is behind; rewards from previous discipline now materialise.',
  };
  return { active: false };
}

// ─── DHAIYA / KANTAKA SHANI ───
// Saturn in 4th or 8th from natal Moon (~2.5 year periods between
// Sade Sati cycles).
function detectDhaiya(natalMoonSign, currentSaturnSign) {
  const moonIdx = signIdx(natalMoonSign);
  const satIdx = signIdx(currentSaturnSign);
  if (moonIdx < 0 || satIdx < 0) return null;
  const rel = houseFromTo(moonIdx, satIdx);

  if (rel === 4) return {
    active: true,
    phase: 'ardha-ashtami',
    description: 'Ardha Ashtami Shani (Saturn in 4th from Moon) — ~2.5 years of pressure on home, mother, emotional foundations. Property/domestic affairs need attention.',
  };
  if (rel === 8) return {
    active: true,
    phase: 'ashtami',
    description: 'Ashtami Shani (Saturn in 8th from Moon) — ~2.5 years of unexpected changes, hidden challenges, possible health concerns. Spiritual transformation phase.',
  };
  return { active: false };
}

// ─── JUPITER TRANSIT ───
// Classical favourability of Jupiter's house position FROM natal Moon.
// (Phaladeepika Ch.26.)
function detectJupiterTransit(natalMoonSign, currentJupiterSign) {
  const moonIdx = signIdx(natalMoonSign);
  const jupIdx = signIdx(currentJupiterSign);
  if (moonIdx < 0 || jupIdx < 0) return null;
  const rel = houseFromTo(moonIdx, jupIdx);

  // Per Phaladeepika: 2, 5, 7, 9, 11 are favourable houses for Jupiter.
  // 1, 3, 4, 8, 10, 12 are inauspicious (per Vedha — except cancellation).
  const favourable = [2, 5, 7, 9, 11];
  return {
    houseFromMoon: rel,
    favourable: favourable.includes(rel),
    description: favourable.includes(rel)
      ? `Jupiter currently transits ${rel}th from your natal Moon — generally favourable for growth, expansion, opportunities.`
      : `Jupiter currently transits ${rel}th from your natal Moon — period of internal review rather than external expansion.`,
  };
}

// ─── DOUBLE TRANSIT ALERT ───
// When BOTH Saturn and Jupiter aspect or occupy the same natal house,
// classical tradition says a MAJOR event manifests in that house's
// life area. This is the strongest single transit-trigger in Vedic
// predictive astrology.
function detectDoubleTransit(natalLagnaSign, currentSatSign, currentJupSign) {
  const lagIdx = signIdx(natalLagnaSign);
  const satIdx = signIdx(currentSatSign);
  const jupIdx = signIdx(currentJupSign);
  if (lagIdx < 0 || satIdx < 0 || jupIdx < 0) return [];

  // For each house from natal Lagna, check if BOTH planets aspect or
  // occupy it.
  const hits = [];
  for (let h = 1; h <= 12; h++) {
    const houseSignIdx = (lagIdx + h - 1) % 12;
    const satAspectsH = isAspected(satIdx, houseSignIdx, SATURN_ASPECTS);
    const jupAspectsH = isAspected(jupIdx, houseSignIdx, JUPITER_ASPECTS);
    if (satAspectsH && jupAspectsH) {
      hits.push({
        house: h,
        description: `Saturn AND Jupiter both currently aspect/occupy your ${ordinal(h)} house — classical "double transit" trigger. Major event likely in this house's life area ${houseLifeArea(h)} during the overlap window.`,
      });
    }
  }
  return hits;
}

function ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const HOUSE_AREAS = {
  1: 'self, body, vitality',
  2: 'wealth, family, speech',
  3: 'siblings, courage, communication',
  4: 'home, mother, property, education',
  5: 'children, creativity, romance, education',
  6: 'health, enemies, debts, daily work',
  7: 'marriage, partnerships, business',
  8: 'longevity, transformation, inheritance, hidden matters',
  9: 'fortune, father, dharma, long travel, higher learning',
  10: 'career, public status, authority',
  11: 'gains, friends, elder siblings, fulfillment of desires',
  12: 'losses, expenses, foreign lands, moksha, spirituality',
};
function houseLifeArea(h) { return `(${HOUSE_AREAS[h] || 'general'})`; }

function isAspected(planetSignIdx, targetSignIdx, aspectsFromPlanet) {
  // House from planet to target (1 = same sign).
  const rel = ((targetSignIdx - planetSignIdx) + 12) % 12 + 1;
  // Aspect 1 = conjunction (occupies the sign).
  if (rel === 1) return true;
  return aspectsFromPlanet.includes(rel);
}

// ─── MAIN ENTRY ───
function computeTransits(natalChart) {
  if (!natalChart || !natalChart.planets || !natalChart.ascendant) return null;

  const natalMoonSign = SIGN_ORDER[signIdx(
    natalChart.planets.Moon && (natalChart.planets.Moon.sign || natalChart.planets.Moon.rashiName))];
  const natalLagnaSign = SIGN_ORDER[signIdx(
    natalChart.ascendant.sign || natalChart.ascendant.rashiName)];

  const current = getCurrentSlowPlanets();
  if (!natalMoonSign || !natalLagnaSign || !current.Saturn || !current.Jupiter) {
    return null;
  }

  return {
    asOf: new Date().toISOString().slice(0, 10),
    currentPositions: current,
    sadeSati: detectSadeSati(natalMoonSign, current.Saturn.sign),
    dhaiya: detectDhaiya(natalMoonSign, current.Saturn.sign),
    jupiter: detectJupiterTransit(natalMoonSign, current.Jupiter.sign),
    doubleTransits: detectDoubleTransit(
      natalLagnaSign, current.Saturn.sign, current.Jupiter.sign),
  };
}

module.exports = {
  computeTransits,
  getCurrentSlowPlanets,
  detectSadeSati,
  detectDhaiya,
  detectJupiterTransit,
  detectDoubleTransit,
};
