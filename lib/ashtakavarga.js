// =========================================
// ASHTAKAVARGA — bindu (point) calculator
// =========================================
//
// The single most-used predictive tool in classical Vedic astrology.
// Each of the 7 planets is awarded a bindu (point) or rekha (no point)
// in each of the 12 houses, depending on where it sits relative to the
// 7 other planets + the Ascendant.
//
// The tables below are the standard Parashari tables straight out of
// BPHS Ch.66 (Chapter on Ashtakavarga). They are NOT arbitrary —
// they encode classical observational rules going back ~1500 years
// about which planetary spacings deliver favourable vs unfavourable
// effects.
//
// USAGE in prediction:
//   - Sarvashtaka score per house = sum of bindus from all 7 planets
//       <25 = weak house (transits fizzle here)
//       25-30 = average
//       31+ = strong (transits deliver, results manifest)
//   - Bhinnashtaka per planet per house = that one planet's bindus
//       When transit of planet P enters house H, the result intensity
//       is proportional to P's bindus in H (in P's own Bhinnashtaka).
//
// Reference: BPHS Ch.66; Phaladeepika Ch.27.

// For each "subject" planet (the one being scored), an object keyed by
// "reference" (Sun, Moon, Mars, Mercury, Jupiter, Venus, Saturn, or
// Lagna). The value is an array of 1-based house positions FROM the
// reference where the subject planet earns a bindu.
//
// Reading: "Sun from Moon: [3,6,10,11]" means — when Sun is 3rd, 6th,
// 10th or 11th house counted FROM Moon, Sun gets a bindu (in the
// house Sun actually occupies).
const TABLES = {
  Sun: {
    Sun:      [1, 2, 4, 7, 8, 9, 10, 11],
    Moon:     [3, 6, 10, 11],
    Mars:     [1, 2, 4, 7, 8, 9, 10, 11],
    Mercury:  [3, 5, 6, 9, 10, 11, 12],
    Jupiter:  [5, 6, 9, 11],
    Venus:    [6, 7, 12],
    Saturn:   [1, 2, 4, 7, 8, 9, 10, 11],
    Lagna:    [3, 4, 6, 10, 11, 12],
  },
  Moon: {
    Sun:      [3, 6, 7, 8, 10, 11],
    Moon:     [1, 3, 6, 7, 10, 11],
    Mars:     [2, 3, 5, 6, 9, 10, 11],
    Mercury:  [1, 3, 4, 5, 7, 8, 10, 11],
    Jupiter:  [1, 4, 7, 8, 10, 11, 12],
    Venus:    [3, 4, 5, 7, 9, 10, 11],
    Saturn:   [3, 5, 6, 11],
    Lagna:    [3, 6, 10, 11],
  },
  Mars: {
    Sun:      [3, 5, 6, 10, 11],
    Moon:     [3, 6, 11],
    Mars:     [1, 2, 4, 7, 8, 10, 11],
    Mercury:  [3, 5, 6, 11],
    Jupiter:  [6, 10, 11, 12],
    Venus:    [6, 8, 11, 12],
    Saturn:   [1, 4, 7, 8, 9, 10, 11],
    Lagna:    [1, 3, 6, 10, 11],
  },
  Mercury: {
    Sun:      [5, 6, 9, 11, 12],
    Moon:     [2, 4, 6, 8, 10, 11],
    Mars:     [1, 2, 4, 7, 8, 9, 10, 11],
    Mercury:  [1, 3, 5, 6, 9, 10, 11, 12],
    Jupiter:  [6, 8, 11, 12],
    Venus:    [1, 2, 3, 4, 5, 8, 9, 11],
    Saturn:   [1, 2, 4, 7, 8, 9, 10, 11],
    Lagna:    [1, 2, 4, 6, 8, 10, 11],
  },
  Jupiter: {
    Sun:      [1, 2, 3, 4, 7, 8, 9, 10, 11],
    Moon:     [2, 5, 7, 9, 11],
    Mars:     [1, 2, 4, 7, 8, 10, 11],
    Mercury:  [1, 2, 4, 5, 6, 9, 10, 11],
    Jupiter:  [1, 2, 3, 4, 7, 8, 10, 11],
    Venus:    [2, 5, 6, 9, 10, 11],
    Saturn:   [3, 5, 6, 12],
    Lagna:    [1, 2, 4, 5, 6, 7, 9, 10, 11],
  },
  Venus: {
    Sun:      [8, 11, 12],
    Moon:     [1, 2, 3, 4, 5, 8, 9, 11, 12],
    Mars:     [3, 5, 6, 9, 11, 12],
    Mercury:  [3, 5, 6, 9, 11],
    Jupiter:  [5, 8, 9, 10, 11],
    Venus:    [1, 2, 3, 4, 5, 8, 9, 10, 11],
    Saturn:   [3, 4, 5, 8, 9, 10, 11],
    Lagna:    [1, 2, 3, 4, 5, 8, 9, 11],
  },
  Saturn: {
    Sun:      [1, 2, 4, 7, 8, 10, 11],
    Moon:     [3, 6, 11],
    Mars:     [3, 5, 6, 10, 11, 12],
    Mercury:  [6, 8, 9, 10, 11, 12],
    Jupiter:  [5, 6, 11, 12],
    Venus:    [6, 11, 12],
    Saturn:   [3, 5, 6, 11],
    Lagna:    [1, 3, 4, 6, 10, 11],
  },
};

const PLANETS = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn'];

// Returns the 1-based house number of `target` counted FROM `reference`.
// e.g. if reference is in sign 5 (Leo) and target is in sign 7 (Libra),
// target is in the 3rd house from reference.
function houseFromTo(referenceSignIdx, targetSignIdx) {
  // 0-based sign indices; result is 1..12
  const diff = ((targetSignIdx - referenceSignIdx) + 12) % 12;
  return diff + 1;
}

// Map a sign name → 0-based index.
const SIGN_ORDER = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
];
function signIdx(sign) {
  if (!sign) return -1;
  // Tolerate "Mesha (Aries)" style — take whatever's in parens or fallback.
  const m = String(sign).match(/\(([^)]+)\)/);
  const name = m ? m[1].trim() : String(sign).trim();
  return SIGN_ORDER.findIndex(
    s => s.toLowerCase() === name.toLowerCase());
}

// Compute the Bhinnashtaka (per-planet) bindu count for each of the 12
// houses, given the sign positions of the 7 planets + the Ascendant.
//
// Returns: { Sun: [b1..b12], Moon: [...], ... }  — 7 planets × 12 houses
//
// Algorithm (classical Parashari):
//   For each SUBJECT planet (the chart we're building):
//     For each REFERENCE (Sun..Saturn + Lagna):
//       Look up the list of earning house-positions for SUBJECT FROM REF.
//       For each earning position E (1..12):
//         The bindu goes in the sign that is E houses from REF's sign.
//         Map that sign to a house number from Lagna, increment.
//
// So each Bhinnashtaka chart receives up to 56 bindus total (max 8 per
// reference × 7 references; Lagna's contribution often pushes it
// higher). Sum of all 7 Bhinnashtaka charts = Sarvashtaka, typically
// 337 for a full chart (range ~300-350 in real data).
function computeBhinnashtaka(positions) {
  // positions = { Sun: 'Leo', Moon: 'Cancer', ..., Lagna: 'Virgo' }
  const idx = {};
  for (const k of [...PLANETS, 'Lagna']) idx[k] = signIdx(positions[k]);

  const out = {};
  const lagnaSign = idx.Lagna;
  if (lagnaSign < 0) return null;

  for (const subject of PLANETS) {
    const houses = new Array(12).fill(0);

    for (const ref of [...PLANETS, 'Lagna']) {
      const refSign = idx[ref];
      if (refSign < 0) continue;
      const earnedPositions = TABLES[subject][ref] || [];

      for (const pos of earnedPositions) {
        // Sign that's `pos` houses from reference (1 = same sign).
        const targetSign = (refSign + pos - 1) % 12;
        // Translate to house number measured from Lagna.
        const houseFromLagna = houseFromTo(lagnaSign, targetSign);
        houses[houseFromLagna - 1] += 1;
      }
    }
    out[subject] = houses;
  }
  return out;
}

// Sarvashtaka = sum of all 7 Bhinnashtaka bindus per house.
function computeSarvashtaka(bhinna) {
  const totals = new Array(12).fill(0);
  for (const p of PLANETS) {
    const arr = bhinna[p] || [];
    for (let h = 0; h < 12; h++) totals[h] += arr[h] || 0;
  }
  return totals;
}

// Convenience: take a @prisri/jyotish chart and return both maps.
function computeAshtakavarga(chart) {
  if (!chart || !chart.planets || !chart.ascendant) return null;

  const positions = { Lagna: chart.ascendant.rashiName };
  for (const p of PLANETS) {
    const data = chart.planets[p];
    if (data && data.rashiName) positions[p] = data.rashiName;
  }

  const bhinna = computeBhinnashtaka(positions);
  const sarva = computeSarvashtaka(bhinna);

  // Strength classification — predictive labels we feed the LLM so it
  // doesn't have to invent them.
  const houseLabels = sarva.map(score => {
    if (score >= 31) return 'strong';
    if (score >= 28) return 'good';
    if (score >= 25) return 'average';
    if (score >= 22) return 'weak';
    return 'very weak';
  });

  return {
    bhinnashtaka: bhinna,                // per-planet × 12 houses
    sarvashtaka: sarva,                  // total × 12 houses
    houseLabels,                         // 'strong'|'weak'|... per house
    sarvashtakaTotal: sarva.reduce((a, b) => a + b, 0),  // ~337 ideal
  };
}

module.exports = {
  computeAshtakavarga,
  computeBhinnashtaka,
  computeSarvashtaka,
  // Exposed for tests:
  _signIdx: signIdx,
  _houseFromTo: houseFromTo,
};
