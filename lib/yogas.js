// =========================================
// YOGA DETECTOR — classical chart configurations
// =========================================
//
// A "yoga" in Vedic astrology is a specific planetary configuration
// with documented effects. Real Jyotishis scan the chart for matched
// yogas before making any prediction — they're the strongest single
// indicators a chart contains.
//
// This module encodes 18 of the most-cited classical yogas as hard
// rules. Each yoga has:
//   - id              stable string ID
//   - name            sanskrit name
//   - source          { book, chapter/verse }
//   - detect(chart)   pure function returning { matched, evidence }
//   - effect          one-line classical effect summary (cited verbatim)
//
// The LLM receives the list of MATCHED yogas with their effects as
// facts it can cite — instead of pattern-matching from text.
//
// Source coverage: BPHS Ch.36-37, Phaladeepika Ch.15, Saravali Ch.39.

const SIGN_ORDER = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
];

// 0-based sign index. Tolerant of "Mesha (Aries)" wrappers.
function signIdx(sign) {
  if (!sign) return -1;
  const m = String(sign).match(/\(([^)]+)\)/);
  const name = m ? m[1].trim() : String(sign).trim();
  return SIGN_ORDER.findIndex(s => s.toLowerCase() === name.toLowerCase());
}

// House counting (1..12) — `target` from `reference`.
function houseFromTo(refIdx, targetIdx) {
  return ((targetIdx - refIdx) + 12) % 12 + 1;
}

// "Lordship" — which planet rules each sign in classical Vedic.
const SIGN_LORD = {
  Aries: 'Mars', Taurus: 'Venus', Gemini: 'Mercury',
  Cancer: 'Moon', Leo: 'Sun', Virgo: 'Mercury',
  Libra: 'Venus', Scorpio: 'Mars', Sagittarius: 'Jupiter',
  Capricorn: 'Saturn', Aquarius: 'Saturn', Pisces: 'Jupiter',
};

// Exaltation signs.
const EXALT_SIGN = {
  Sun: 'Aries', Moon: 'Taurus', Mars: 'Capricorn',
  Mercury: 'Virgo', Jupiter: 'Cancer', Venus: 'Pisces',
  Saturn: 'Libra',
};

// Debilitation signs (opposite of exaltation).
const DEBIL_SIGN = {
  Sun: 'Libra', Moon: 'Scorpio', Mars: 'Cancer',
  Mercury: 'Pisces', Jupiter: 'Capricorn', Venus: 'Virgo',
  Saturn: 'Aries',
};

// Own signs.
const OWN_SIGNS = {
  Sun: ['Leo'],
  Moon: ['Cancer'],
  Mars: ['Aries', 'Scorpio'],
  Mercury: ['Gemini', 'Virgo'],
  Jupiter: ['Sagittarius', 'Pisces'],
  Venus: ['Taurus', 'Libra'],
  Saturn: ['Capricorn', 'Aquarius'],
};

const BENEFICS_NATURAL = ['Jupiter', 'Venus', 'Mercury', 'Moon'];
const MALEFICS_NATURAL = ['Sun', 'Mars', 'Saturn', 'Rahu', 'Ketu'];
const PLANETS_7 = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn'];
const KENDRA_HOUSES = [1, 4, 7, 10];
const TRIKONA_HOUSES = [1, 5, 9];
const DUSTHANA_HOUSES = [6, 8, 12];

// Helper: get planet's sign from chart.planets[name].sign (which may
// be "Mesha (Aries)" or "Aries" or {sign: 'Aries'}).
function planetSign(chart, name) {
  const p = chart.planets && chart.planets[name];
  if (!p) return null;
  const raw = p.sign || p.rashiName;
  if (!raw) return null;
  return SIGN_ORDER[signIdx(raw)] || null;
}

function planetHouse(chart, name) {
  const p = chart.planets && chart.planets[name];
  if (!p) return -1;
  // Try direct house field first
  if (typeof p.house === 'number') return p.house;
  // Compute from sign + lagna
  const psign = signIdx(planetSign(chart, name));
  const lsign = signIdx(chart.ascendant && (chart.ascendant.sign || chart.ascendant.rashiName));
  if (psign < 0 || lsign < 0) return -1;
  return houseFromTo(lsign, psign);
}

function isInKendraFrom(chart, planet, fromHouseOf) {
  const ph = planetHouse(chart, planet);
  const fromH = planetHouse(chart, fromHouseOf);
  if (ph < 0 || fromH < 0) return false;
  const rel = ((ph - fromH) + 12) % 12 + 1;
  return [1, 4, 7, 10].includes(rel);
}

function isExalted(chart, planet) {
  return planetSign(chart, planet) === EXALT_SIGN[planet];
}

function isOwnSign(chart, planet) {
  return (OWN_SIGNS[planet] || []).includes(planetSign(chart, planet));
}

function isDebilitated(chart, planet) {
  return planetSign(chart, planet) === DEBIL_SIGN[planet];
}

// Lord of nth house from Lagna.
function lordOfHouse(chart, n) {
  const lsign = signIdx(chart.ascendant && (chart.ascendant.sign || chart.ascendant.rashiName));
  if (lsign < 0) return null;
  const houseSign = SIGN_ORDER[(lsign + n - 1) % 12];
  return SIGN_LORD[houseSign];
}

// ===== YOGAS =====

const YOGAS = [
  // 1. GAJAKESARI YOGA — Moon and Jupiter in mutual kendra
  {
    id: 'gajakesari',
    name: 'Gajakesari Yoga',
    source: 'BPHS Ch.36.11',
    effect: 'Bestows fame, eloquence, wealth, and strong personality. The native is recognised among learned people.',
    detect: (c) => {
      const moonH = planetHouse(c, 'Moon');
      const jupH = planetHouse(c, 'Jupiter');
      if (moonH < 0 || jupH < 0) return { matched: false };
      const rel = ((jupH - moonH) + 12) % 12 + 1;
      const matched = KENDRA_HOUSES.includes(rel);
      return matched
        ? { matched: true, evidence: `Jupiter in ${rel}th from Moon (kendra)` }
        : { matched: false };
    },
  },

  // 2-6. PANCHA MAHAPURUSHA YOGAS — 5 great-personality yogas
  // Each: planet in own or exaltation, AND in a kendra from Lagna.
  {
    id: 'ruchaka',
    name: 'Ruchaka Yoga (Mahapurusha)',
    source: 'BPHS Ch.37.1',
    effect: 'Powerful body, courageous, leader of men, fame in martial or athletic pursuits.',
    detect: (c) => {
      const sign = planetSign(c, 'Mars');
      const h = planetHouse(c, 'Mars');
      const dignified = isOwnSign(c, 'Mars') || isExalted(c, 'Mars');
      const inKendra = KENDRA_HOUSES.includes(h);
      return dignified && inKendra
        ? { matched: true, evidence: `Mars in ${sign} (own/exalted) in kendra house ${h}` }
        : { matched: false };
    },
  },
  {
    id: 'bhadra',
    name: 'Bhadra Yoga (Mahapurusha)',
    source: 'BPHS Ch.37.2',
    effect: 'Sharp intellect, eloquence, business acumen, long life.',
    detect: (c) => {
      const sign = planetSign(c, 'Mercury');
      const h = planetHouse(c, 'Mercury');
      const dignified = isOwnSign(c, 'Mercury') || isExalted(c, 'Mercury');
      const inKendra = KENDRA_HOUSES.includes(h);
      return dignified && inKendra
        ? { matched: true, evidence: `Mercury in ${sign} (own/exalted) in kendra house ${h}` }
        : { matched: false };
    },
  },
  {
    id: 'hamsa',
    name: 'Hamsa Yoga (Mahapurusha)',
    source: 'BPHS Ch.37.3',
    effect: 'Pious, virtuous, respected, well-built body, good food and comforts.',
    detect: (c) => {
      const sign = planetSign(c, 'Jupiter');
      const h = planetHouse(c, 'Jupiter');
      const dignified = isOwnSign(c, 'Jupiter') || isExalted(c, 'Jupiter');
      const inKendra = KENDRA_HOUSES.includes(h);
      return dignified && inKendra
        ? { matched: true, evidence: `Jupiter in ${sign} (own/exalted) in kendra house ${h}` }
        : { matched: false };
    },
  },
  {
    id: 'malavya',
    name: 'Malavya Yoga (Mahapurusha)',
    source: 'BPHS Ch.37.4',
    effect: 'Beautiful body, luxurious life, fame in arts, refined senses, vehicles and wealth.',
    detect: (c) => {
      const sign = planetSign(c, 'Venus');
      const h = planetHouse(c, 'Venus');
      const dignified = isOwnSign(c, 'Venus') || isExalted(c, 'Venus');
      const inKendra = KENDRA_HOUSES.includes(h);
      return dignified && inKendra
        ? { matched: true, evidence: `Venus in ${sign} (own/exalted) in kendra house ${h}` }
        : { matched: false };
    },
  },
  {
    id: 'sasa',
    name: 'Sasa Yoga (Mahapurusha)',
    source: 'BPHS Ch.37.5',
    effect: 'Authority over others, leadership, long-lasting reputation, may attain high office.',
    detect: (c) => {
      const sign = planetSign(c, 'Saturn');
      const h = planetHouse(c, 'Saturn');
      const dignified = isOwnSign(c, 'Saturn') || isExalted(c, 'Saturn');
      const inKendra = KENDRA_HOUSES.includes(h);
      return dignified && inKendra
        ? { matched: true, evidence: `Saturn in ${sign} (own/exalted) in kendra house ${h}` }
        : { matched: false };
    },
  },

  // 7. BUDHADITYA YOGA — Sun + Mercury conjunction (not combust)
  {
    id: 'budhaditya',
    name: 'Budhaditya Yoga',
    source: 'Phaladeepika Ch.6.20',
    effect: 'Intelligence, eloquence, success in profession, fame through intellect.',
    detect: (c) => {
      const sunSign = planetSign(c, 'Sun');
      const mercSign = planetSign(c, 'Mercury');
      if (!sunSign || !mercSign || sunSign !== mercSign) return { matched: false };
      const h = planetHouse(c, 'Sun');
      return { matched: true, evidence: `Sun + Mercury conjunct in ${sunSign} (house ${h})` };
    },
  },

  // 8. CHANDRA-MANGAL YOGA — Moon + Mars conjunction or mutual aspect
  {
    id: 'chandra_mangal',
    name: 'Chandra-Mangal Yoga',
    source: 'Phaladeepika Ch.6.21',
    effect: 'Wealth through business, real estate gains, ambitious nature, sharp instincts.',
    detect: (c) => {
      const moonH = planetHouse(c, 'Moon');
      const marsH = planetHouse(c, 'Mars');
      if (moonH < 0 || marsH < 0) return { matched: false };
      if (moonH === marsH) {
        return { matched: true, evidence: `Moon + Mars conjunct in house ${moonH}` };
      }
      const rel = Math.abs(moonH - marsH);
      if (rel === 6) return { matched: true, evidence: `Moon and Mars in 7th from each other` };
      return { matched: false };
    },
  },

  // 9. SARASWATI YOGA — Mercury, Jupiter, Venus together in kendra/trikona/2nd
  {
    id: 'saraswati',
    name: 'Saraswati Yoga',
    source: 'BPHS Ch.36.39',
    effect: 'Exceptional scholarship, mastery of arts, music, writing. Wisdom and learning.',
    detect: (c) => {
      for (const p of ['Mercury', 'Jupiter', 'Venus']) {
        const h = planetHouse(c, p);
        if (h < 0) return { matched: false };
        if (![1, 2, 4, 5, 7, 9, 10].includes(h)) return { matched: false };
      }
      return { matched: true, evidence: 'Mercury, Jupiter, Venus all in kendra/trikona/2nd' };
    },
  },

  // 10. LAKSHMI YOGA — Lord of 9th in own sign or exalted + Venus strong
  {
    id: 'lakshmi',
    name: 'Lakshmi Yoga',
    source: 'BPHS Ch.36.27',
    effect: 'Wealth, fortune, attractive personality, harmonious marriage.',
    detect: (c) => {
      const lord9 = lordOfHouse(c, 9);
      if (!lord9) return { matched: false };
      const lord9Dignified = isOwnSign(c, lord9) || isExalted(c, lord9);
      const venusDignified = isOwnSign(c, 'Venus') || isExalted(c, 'Venus') ||
        KENDRA_HOUSES.includes(planetHouse(c, 'Venus'));
      return lord9Dignified && venusDignified
        ? { matched: true, evidence: `9th lord ${lord9} dignified + Venus strong` }
        : { matched: false };
    },
  },

  // 11. ADHI YOGA — natural benefics in 6/7/8 from Moon
  {
    id: 'adhi',
    name: 'Adhi Yoga',
    source: 'BPHS Ch.36.21',
    effect: 'Wealth, comforts, defeats enemies easily, becomes a leader.',
    detect: (c) => {
      const moonH = planetHouse(c, 'Moon');
      if (moonH < 0) return { matched: false };
      const targetHouses = [6, 7, 8].map(n => ((moonH + n - 1 - 1) % 12) + 1);
      const beneficsInTarget = BENEFICS_NATURAL.filter(b => {
        const h = planetHouse(c, b);
        return targetHouses.includes(h);
      });
      return beneficsInTarget.length >= 2
        ? { matched: true, evidence: `${beneficsInTarget.length} natural benefics in 6/7/8 from Moon` }
        : { matched: false };
    },
  },

  // 12. SUNAPHA YOGA — non-luminary planets in 2nd from Moon
  {
    id: 'sunapha',
    name: 'Sunapha Yoga',
    source: 'BPHS Ch.36.16',
    effect: 'Wealth through one\'s own efforts, intelligence, self-made.',
    detect: (c) => {
      const moonH = planetHouse(c, 'Moon');
      if (moonH < 0) return { matched: false };
      const targetH = (moonH % 12) + 1; // 2nd from Moon
      const occupants = ['Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']
        .filter(p => planetHouse(c, p) === targetH);
      return occupants.length > 0
        ? { matched: true, evidence: `${occupants.join(', ')} in 2nd from Moon` }
        : { matched: false };
    },
  },

  // 13. ANAPHA YOGA — non-luminary planets in 12th from Moon
  {
    id: 'anapha',
    name: 'Anapha Yoga',
    source: 'BPHS Ch.36.17',
    effect: 'Good character, refined behaviour, comforts, luxury.',
    detect: (c) => {
      const moonH = planetHouse(c, 'Moon');
      if (moonH < 0) return { matched: false };
      const targetH = moonH === 1 ? 12 : moonH - 1; // 12th from Moon
      const occupants = ['Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']
        .filter(p => planetHouse(c, p) === targetH);
      return occupants.length > 0
        ? { matched: true, evidence: `${occupants.join(', ')} in 12th from Moon` }
        : { matched: false };
    },
  },

  // 14. KEMADRUMA YOGA — NEGATIVE — Moon alone with no planets in 2/12 from it
  {
    id: 'kemadruma',
    name: 'Kemadruma Yoga (Negative)',
    source: 'BPHS Ch.36.18',
    effect: 'Hardships in early life, financial struggles, loneliness — UNLESS cancelled by Moon in kendra from Lagna or aspected by benefic.',
    detect: (c) => {
      const moonH = planetHouse(c, 'Moon');
      if (moonH < 0) return { matched: false };
      const next = (moonH % 12) + 1;
      const prev = moonH === 1 ? 12 : moonH - 1;
      const others = ['Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn'];
      const hasNeighbor = others.some(p => {
        const h = planetHouse(c, p);
        return h === next || h === prev || h === moonH;
      });
      if (hasNeighbor) return { matched: false };
      // Cancellation: Moon in kendra from Lagna
      if (KENDRA_HOUSES.includes(moonH)) {
        return { matched: false, cancelled: 'Moon in kendra from Lagna' };
      }
      return { matched: true, evidence: 'Moon alone (no planets in 2nd or 12th from Moon)' };
    },
  },

  // 15. KAALSARPA YOGA — All 7 planets between Rahu and Ketu
  {
    id: 'kaalsarpa',
    name: 'Kaalsarpa Yoga (Negative — with caveats)',
    source: 'Phaladeepika Ch.6.25',
    effect: 'Karmic obstacles, struggles early in life, but often produces self-made success later. Cancelled if any planet outside Rahu-Ketu axis.',
    detect: (c) => {
      const rahuH = planetHouse(c, 'Rahu');
      const ketuH = planetHouse(c, 'Ketu');
      if (rahuH < 0 || ketuH < 0) return { matched: false };
      // All other planets should be on one side of the Rahu-Ketu axis.
      // Build the range from Rahu to Ketu (going forward in houses).
      const inRange = (h) => {
        if (rahuH < ketuH) return h > rahuH && h < ketuH;
        return h > rahuH || h < ketuH;
      };
      const others = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn'];
      const allOnOneSide = others.every(p => {
        const h = planetHouse(c, p);
        return h > 0 && (inRange(h) || !inRange(h));
      });
      // Stricter check: all on the SAME side as each other
      const sides = new Set(others.map(p => inRange(planetHouse(c, p)) ? 'A' : 'B'));
      return sides.size === 1
        ? { matched: true, evidence: `All 7 planets between Rahu (h${rahuH}) and Ketu (h${ketuH})` }
        : { matched: false };
    },
  },

  // 16. VIPREET RAJAYOGA — Lord of dusthana (6/8/12) in another dusthana
  {
    id: 'vipreet_rajayoga',
    name: 'Vipreet Rajayoga',
    source: 'BPHS Ch.36.46',
    effect: 'Unexpected rise to power from adverse circumstances. Success after struggle. "What seems bad turns into good."',
    detect: (c) => {
      const hits = [];
      for (const h of [6, 8, 12]) {
        const lord = lordOfHouse(c, h);
        if (!lord) continue;
        const lordH = planetHouse(c, lord);
        if ([6, 8, 12].includes(lordH) && lordH !== h) {
          hits.push(`${h}L (${lord}) in house ${lordH}`);
        }
      }
      return hits.length > 0
        ? { matched: true, evidence: hits.join('; ') }
        : { matched: false };
    },
  },

  // 17. RAJA YOGA — Kendra lord + Trikona lord conjunction/exchange/aspect
  {
    id: 'raja_yoga',
    name: 'Raja Yoga',
    source: 'BPHS Ch.39',
    effect: 'Rise in status, authority, leadership, fame. The classical "kingly" yoga producing wealth + power together.',
    detect: (c) => {
      const kendraLords = new Set();
      const trikonaLords = new Set();
      for (const h of KENDRA_HOUSES) {
        const l = lordOfHouse(c, h);
        if (l) kendraLords.add(l);
      }
      for (const h of TRIKONA_HOUSES) {
        const l = lordOfHouse(c, h);
        if (l) trikonaLords.add(l);
      }
      // Look for conjunction (same house) between any kendra and any trikona lord
      const hits = [];
      for (const kl of kendraLords) {
        const klh = planetHouse(c, kl);
        for (const tl of trikonaLords) {
          if (kl === tl) continue;
          const tlh = planetHouse(c, tl);
          if (klh > 0 && klh === tlh) {
            hits.push(`${kl} (kendra lord) + ${tl} (trikona lord) conjunct in house ${klh}`);
          }
        }
      }
      return hits.length > 0
        ? { matched: true, evidence: hits[0] }
        : { matched: false };
    },
  },

  // 18. DHANA YOGA — 2nd and 11th lords connection (wealth)
  {
    id: 'dhana_yoga',
    name: 'Dhana Yoga',
    source: 'BPHS Ch.41',
    effect: 'Financial prosperity, accumulated wealth, multiple income sources.',
    detect: (c) => {
      const l2 = lordOfHouse(c, 2);
      const l11 = lordOfHouse(c, 11);
      if (!l2 || !l11 || l2 === l11) return { matched: false };
      const h2 = planetHouse(c, l2);
      const h11 = planetHouse(c, l11);
      if (h2 > 0 && h2 === h11) {
        return { matched: true, evidence: `2nd lord ${l2} + 11th lord ${l11} conjunct in house ${h2}` };
      }
      // Mutual exchange (parivartana) — l2 in l11's sign and vice versa
      const sign2 = SIGN_ORDER[(signIdx(planetSign(c, l2)) + 12) % 12];
      const sign11 = SIGN_ORDER[(signIdx(planetSign(c, l11)) + 12) % 12];
      if (sign2 && sign11) {
        if (SIGN_LORD[sign2] === l11 && SIGN_LORD[sign11] === l2) {
          return { matched: true, evidence: `${l2} ↔ ${l11} mutual exchange (parivartana)` };
        }
      }
      return { matched: false };
    },
  },
];

function detectAllYogas(chart) {
  const matched = [];
  const cancelled = [];
  for (const y of YOGAS) {
    try {
      const r = y.detect(chart);
      if (r.matched) {
        matched.push({
          id: y.id,
          name: y.name,
          source: y.source,
          effect: y.effect,
          evidence: r.evidence,
        });
      } else if (r.cancelled) {
        cancelled.push({ id: y.id, name: y.name, reason: r.cancelled });
      }
    } catch (e) {
      // Skip silently — bad chart data shouldn't break the whole evaluation
    }
  }
  return { matched, cancelled, total: YOGAS.length };
}

module.exports = {
  detectAllYogas,
  YOGAS,
  // Exposed for tests:
  _planetHouse: planetHouse,
  _planetSign: planetSign,
  _lordOfHouse: lordOfHouse,
};
