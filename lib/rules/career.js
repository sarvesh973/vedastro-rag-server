// =========================================
// CAREER RULES — 30 classical rules
// =========================================
//
// Encoded from:
//   - BPHS Ch.49 (Karma Bhava — 10th house)
//   - Phaladeepika Ch.6 (Effects of the 10th house)
//   - Saravali Ch.28 (Profession)
//   - Jaimini Sutras Ch.1 (Amatyakaraka — career advisor)

const {
  planetSign, planetHouse, lordOfHouse, planetsInHouse,
  isOwnSign, isExalted, isDebilitated, aspectsHouse,
  SIGN_LORD, SIGN_ORDER, signIdx,
} = require('./schema');

module.exports = [
  // ============== STRUCTURAL POSITIVES ==============

  {
    id: 'tenth_lord_in_kendra',
    domain: 'career',
    source: { book: 'BPHS', chapter: 49, verse: '12' },
    prediction: { polarity: 'positive', text: 'Strong professional standing. Career manifests visibly and brings recognition.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 10); if (!l) return { matched: false };
      const h = planetHouse(c, l);
      if (![1, 4, 7, 10].includes(h)) return { matched: false };
      return { matched: true, intensity: 8, evidence: `10th lord ${l} in kendra (house ${h})` };
    },
  },

  {
    id: 'tenth_lord_own_or_exalted',
    domain: 'career',
    source: { book: 'Phaladeepika', chapter: 6, verse: '14' },
    prediction: { polarity: 'positive', text: 'High-status profession. Senior role, respected position, possible authority.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 10); if (!l) return { matched: false };
      if (!isOwnSign(c, l) && !isExalted(c, l)) return { matched: false };
      return { matched: true, intensity: 9, evidence: `10th lord ${l} ${isExalted(c, l) ? 'exalted' : 'in own sign'} (${planetSign(c, l)})` };
    },
  },

  {
    id: 'tenth_house_aspected_by_jupiter',
    domain: 'career',
    source: { book: 'BPHS', chapter: 49, verse: '18' },
    prediction: { polarity: 'positive', text: 'Ethical, dharmic profession. Career grows through honesty and good counsel.', timeframe: 'lifetime' },
    predicate: (c) => {
      if (!aspectsHouse(c, 'Jupiter', 10)) return { matched: false };
      return { matched: true, intensity: 7, evidence: 'Jupiter aspects/occupies 10th house' };
    },
  },

  {
    id: 'tenth_house_aspected_by_saturn',
    domain: 'career',
    source: { book: 'Phaladeepika', chapter: 6, verse: '20' },
    prediction: { polarity: 'mixed', text: 'Disciplined career with long-lasting results. Slow build but very durable. Engineering, administration, service.', timeframe: 'lifetime' },
    predicate: (c) => {
      if (!aspectsHouse(c, 'Saturn', 10)) return { matched: false };
      return { matched: true, intensity: 6, evidence: 'Saturn aspects/occupies 10th house' };
    },
  },

  {
    id: 'lagna_lord_in_tenth',
    domain: 'career',
    source: { book: 'BPHS', chapter: 49, verse: '15' },
    prediction: { polarity: 'positive', text: 'Self-driven career path. Strong entrepreneurial energy. The native is the architect of their profession.', timeframe: 'lifetime' },
    predicate: (c) => {
      const lagL = lordOfHouse(c, 1); if (!lagL) return { matched: false };
      if (planetHouse(c, lagL) !== 10) return { matched: false };
      return { matched: true, intensity: 8, evidence: `Lagna lord ${lagL} in 10th house` };
    },
  },

  // ============== PLANETARY PLACEMENTS IN 10TH ==============

  {
    id: 'sun_in_tenth',
    domain: 'career',
    source: { book: 'Saravali', chapter: 28, verse: '6' },
    prediction: { polarity: 'positive', text: 'Leadership career. Government, executive, public-facing authority. Strong ambition to rise.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Sun') === 10
      ? { matched: true, intensity: 8, evidence: 'Sun in 10th — natural Dig Bala (directional strength)' }
      : { matched: false },
  },

  {
    id: 'mercury_in_tenth',
    domain: 'career',
    source: { book: 'Saravali', chapter: 28, verse: '8' },
    prediction: { polarity: 'positive', text: 'Career in communication, business, trade, writing, media, or analytics. Verbal/intellectual profession.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Mercury') === 10
      ? { matched: true, intensity: 7, evidence: 'Mercury in 10th' }
      : { matched: false },
  },

  {
    id: 'jupiter_in_tenth',
    domain: 'career',
    source: { book: 'Saravali', chapter: 28, verse: '9' },
    prediction: { polarity: 'positive', text: 'Teaching, advisory, legal, religious, or counseling career. Wisdom-based profession with public respect.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Jupiter') === 10
      ? { matched: true, intensity: 8, evidence: 'Jupiter in 10th' }
      : { matched: false },
  },

  {
    id: 'venus_in_tenth',
    domain: 'career',
    source: { book: 'Saravali', chapter: 28, verse: '10' },
    prediction: { polarity: 'positive', text: 'Arts, entertainment, luxury industries, design, beauty, hospitality. Career involves aesthetics and refinement.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Venus') === 10
      ? { matched: true, intensity: 7, evidence: 'Venus in 10th' }
      : { matched: false },
  },

  {
    id: 'mars_in_tenth',
    domain: 'career',
    source: { book: 'Saravali', chapter: 28, verse: '7' },
    prediction: { polarity: 'positive', text: 'Engineering, technical fields, military, sports, surgery, or any career requiring physical/mental courage and direct action.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Mars') === 10
      ? { matched: true, intensity: 7, evidence: 'Mars in 10th — natural Dig Bala' }
      : { matched: false },
  },

  {
    id: 'saturn_in_tenth',
    domain: 'career',
    source: { book: 'Saravali', chapter: 28, verse: '11' },
    prediction: { polarity: 'mixed', text: 'Late but lasting career. Service industry, administration, mining, labour-related fields. Discipline rewarded over decades.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Saturn') === 10
      ? { matched: true, intensity: 7, evidence: 'Saturn in 10th' }
      : { matched: false },
  },

  {
    id: 'moon_in_tenth',
    domain: 'career',
    source: { book: 'Saravali', chapter: 28, verse: '5' },
    prediction: { polarity: 'positive', text: 'Public-facing, care-giving, or fluid career. Hospitality, healthcare, mass appeal. Public visibility is natural.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Moon') === 10
      ? { matched: true, intensity: 6, evidence: 'Moon in 10th' }
      : { matched: false },
  },

  {
    id: 'rahu_in_tenth',
    domain: 'career',
    source: { book: 'BPHS', chapter: 49, verse: '27' },
    prediction: { polarity: 'mixed', text: 'Unconventional or foreign-related career. Innovation, tech, foreign companies, unusual paths. Rapid rise possible but instability.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Rahu') === 10
      ? { matched: true, intensity: 7, evidence: 'Rahu in 10th' }
      : { matched: false },
  },

  {
    id: 'ketu_in_tenth',
    domain: 'career',
    source: { book: 'BPHS', chapter: 49, verse: '28' },
    prediction: { polarity: 'mixed', text: 'Philosophical, spiritual, research-oriented career. Detachment from worldly recognition; may prefer behind-the-scenes work.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Ketu') === 10
      ? { matched: true, intensity: 6, evidence: 'Ketu in 10th' }
      : { matched: false },
  },

  // ============== STRUCTURAL NEGATIVES ==============

  {
    id: 'tenth_lord_in_dusthana',
    domain: 'career',
    source: { book: 'Phaladeepika', chapter: 6, verse: '16' },
    prediction: { polarity: 'negative', text: 'Career obstacles, periods of unemployment, or unconventional path. May serve others rather than lead, or work in healthcare/litigation/foreign lands.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 10); if (!l) return { matched: false };
      const h = planetHouse(c, l);
      if (![6, 8, 12].includes(h)) return { matched: false };
      return { matched: true, intensity: 6, evidence: `10th lord ${l} in dusthana (house ${h})` };
    },
  },

  {
    id: 'tenth_lord_debilitated',
    domain: 'career',
    source: { book: 'Phaladeepika', chapter: 6, verse: '17' },
    prediction: { polarity: 'negative', text: 'Career below the native\'s potential. Sense of unfulfillment, demotions possible. Significant effort needed for recognition.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 10); if (!l) return { matched: false };
      if (!isDebilitated(c, l)) return { matched: false };
      return { matched: true, intensity: 6, evidence: `10th lord ${l} debilitated in ${planetSign(c, l)}` };
    },
  },

  {
    id: 'tenth_house_in_dusthana',
    domain: 'career',
    source: { book: 'BPHS', chapter: 49, verse: '32' },
    prediction: { polarity: 'negative', text: 'Career struggles, especially in mid-life. Profession may involve serving difficult clients or working in conflict zones.', timeframe: 'lifetime' },
    predicate: (c) => {
      const malefics = planetsInHouse(c, 10).filter(p => ['Sun', 'Mars', 'Saturn', 'Rahu', 'Ketu'].includes(p));
      if (malefics.length < 2) return { matched: false };
      return { matched: true, intensity: 5, evidence: `Multiple malefics in 10th: ${malefics.join(', ')}` };
    },
  },

  // ============== TIMING / DASHA ==============

  {
    id: 'currently_in_tenth_lord_dasha',
    domain: 'career',
    source: { book: 'BPHS', chapter: 49, verse: '35' },
    prediction: { polarity: 'positive', text: 'Active 10th-lord dasha — primary classical trigger for career events. Promotion, job change, or new opportunity highly likely.', timeframe: 'currentDasha' },
    predicate: (c) => {
      const l = lordOfHouse(c, 10); if (!l) return { matched: false };
      const md = c.dasha && c.dasha.mahadasha;
      const ad = c.dasha && c.dasha.antardasha;
      if (md !== l && ad !== l) return { matched: false };
      return { matched: true, intensity: md === l && ad === l ? 10 : 8, evidence: `10th lord ${l} in dasha ${md}/${ad}` };
    },
  },

  {
    id: 'sun_dasha_strong_sun',
    domain: 'career',
    source: { book: 'BPHS', chapter: 51, verse: '6' },
    prediction: { polarity: 'positive', text: 'Sun dasha with Sun well-placed — executive-level opportunities, government roles, public authority manifest.', timeframe: 'currentDasha' },
    predicate: (c) => {
      const md = c.dasha && c.dasha.mahadasha;
      if (md !== 'Sun') return { matched: false };
      const h = planetHouse(c, 'Sun');
      if (!isOwnSign(c, 'Sun') && !isExalted(c, 'Sun') && ![1, 5, 9, 10, 11].includes(h)) return { matched: false };
      return { matched: true, intensity: 8, evidence: `Sun mahadasha active, Sun in ${planetSign(c, 'Sun')} (house ${h})` };
    },
  },

  {
    id: 'jupiter_dasha_education_career',
    domain: 'career',
    source: { book: 'BPHS', chapter: 51, verse: '11' },
    prediction: { polarity: 'positive', text: 'Jupiter dasha — opportunities in teaching, legal, advisory, religious, or wisdom-related work. Returning to education also favoured.', timeframe: 'currentDasha' },
    predicate: (c) => {
      const md = c.dasha && c.dasha.mahadasha;
      if (md !== 'Jupiter') return { matched: false };
      return { matched: true, intensity: 7, evidence: 'Jupiter mahadasha active' };
    },
  },

  {
    id: 'saturn_dasha_late_bloom',
    domain: 'career',
    source: { book: 'BPHS', chapter: 51, verse: '14' },
    prediction: { polarity: 'mixed', text: 'Saturn dasha — slow, disciplined career growth. Major rewards come from sustained effort. Often the "make or break" career decade.', timeframe: 'currentDasha' },
    predicate: (c) => {
      const md = c.dasha && c.dasha.mahadasha;
      if (md !== 'Saturn') return { matched: false };
      return { matched: true, intensity: 6, evidence: 'Saturn mahadasha active' };
    },
  },

  // ============== KARAKAS / JAIMINI ==============

  {
    id: 'amatyakaraka_strong',
    domain: 'career',
    source: { book: 'Jaimini Sutras', chapter: 1, verse: '38' },
    note: 'Amatyakaraka (AmK) = career advisor planet per Jaimini.',
    prediction: { polarity: 'positive', text: 'Career profession aligns with soul-purpose. Often emerges through a mentor figure or after a significant guide enters life.', timeframe: 'lifetime' },
    predicate: (c) => {
      if (!c.karakas || !c.karakas.Amatyakaraka) return { matched: false };
      const amk = c.karakas.Amatyakaraka.planet;
      if (!isOwnSign(c, amk) && !isExalted(c, amk)) return { matched: false };
      return { matched: true, intensity: 7, evidence: `Amatyakaraka ${amk} dignified (${planetSign(c, amk)})` };
    },
  },

  // ============== SPECIAL YOGAS REFERENCED ==============

  {
    id: 'budhaditya_in_tenth',
    domain: 'career',
    source: { book: 'Phaladeepika', chapter: 6, verse: '23' },
    prediction: { polarity: 'positive', text: 'Sun + Mercury together in 10th — fame through intellect, scholarly recognition, or public communication career.', timeframe: 'lifetime' },
    predicate: (c) => {
      if (planetHouse(c, 'Sun') !== 10 || planetHouse(c, 'Mercury') !== 10) return { matched: false };
      return { matched: true, intensity: 8, evidence: 'Sun and Mercury both in 10th (Budhaditya in 10th)' };
    },
  },

  {
    id: 'pancha_mahapurusha_in_tenth',
    domain: 'career',
    source: { book: 'BPHS', chapter: 37 },
    prediction: { polarity: 'positive', text: 'A Mahapurusha planet stationed in 10th — exceptional career trajectory. Recognition can extend well beyond personal circle.', timeframe: 'lifetime' },
    predicate: (c) => {
      const hits = [];
      for (const p of ['Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']) {
        if (planetHouse(c, p) === 10 && (isOwnSign(c, p) || isExalted(c, p))) {
          hits.push(p);
        }
      }
      if (hits.length === 0) return { matched: false };
      return { matched: true, intensity: 9, evidence: `${hits.join(', ')} dignified in 10th (Mahapurusha in 10th)` };
    },
  },

  // ============== INCOME / GAIN CONNECTIONS ==============

  {
    id: 'tenth_lord_in_eleventh',
    domain: 'career',
    source: { book: 'BPHS', chapter: 49, verse: '23' },
    prediction: { polarity: 'positive', text: 'Career directly produces strong income. Profession is the primary wealth source. Promotions translate to financial gain.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 10); if (!l) return { matched: false };
      if (planetHouse(c, l) !== 11) return { matched: false };
      return { matched: true, intensity: 8, evidence: `10th lord ${l} in 11th (career → income)` };
    },
  },

  {
    id: 'eleventh_lord_in_tenth',
    domain: 'career',
    source: { book: 'BPHS', chapter: 49, verse: '24' },
    prediction: { polarity: 'positive', text: 'Money/network drives career opportunities. Professional advancement comes through who you know.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 11); if (!l) return { matched: false };
      if (planetHouse(c, l) !== 10) return { matched: false };
      return { matched: true, intensity: 7, evidence: `11th lord ${l} in 10th (income source connects to career)` };
    },
  },

  // ============== DIVISIONAL (D10 DASAMSA) ==============

  {
    id: 'd10_ascendant_lord_strong',
    domain: 'career',
    source: { book: 'BPHS', chapter: 49, verse: '40' },
    note: 'D10 (Dasamsa) is the divisional chart specifically for profession.',
    prediction: { polarity: 'positive', text: 'D10 chart shows strong professional foundation. Career direction is naturally aligned and supported.', timeframe: 'lifetime' },
    predicate: (c) => {
      const d10 = c.d10Dasamsa; if (!d10 || !d10.Ascendant) return { matched: false };
      const ascSign = String(d10.Ascendant).replace(/\(.*\)/, '').trim();
      const ascLord = SIGN_LORD[ascSign];
      if (!ascLord) return { matched: false };
      const lordD10Sign = d10[ascLord];
      if (!lordD10Sign) return { matched: false };
      const ls = String(lordD10Sign).replace(/\(.*\)/, '').trim();
      // Strong if in own sign or exalted in D10
      const ownSigns = require('./schema').OWN_SIGNS[ascLord] || [];
      const exaltSign = require('./schema').EXALT_SIGN[ascLord];
      if (ownSigns.includes(ls) || ls === exaltSign) {
        return { matched: true, intensity: 7, evidence: `D10 lord ${ascLord} dignified in D10 (${ls})` };
      }
      return { matched: false };
    },
  },

  // ============== ELEMENTAL TEMPERAMENT ==============

  {
    id: 'tenth_house_fire_sign',
    domain: 'career',
    source: { book: 'Saravali', chapter: 28, verse: '20' },
    prediction: { polarity: 'positive', text: 'Independent, leadership-driven career style. Best in roles where the native sets the direction.', timeframe: 'lifetime' },
    predicate: (c) => {
      const lagIdx = signIdx(c.ascendant && (c.ascendant.sign || c.ascendant.rashiName));
      if (lagIdx < 0) return { matched: false };
      const tenthSign = SIGN_ORDER[(lagIdx + 9) % 12];
      if (!['Aries', 'Leo', 'Sagittarius'].includes(tenthSign)) return { matched: false };
      return { matched: true, intensity: 4, evidence: `10th house in fire sign (${tenthSign})` };
    },
  },

  {
    id: 'tenth_house_earth_sign',
    domain: 'career',
    source: { book: 'Saravali', chapter: 28, verse: '21' },
    prediction: { polarity: 'positive', text: 'Practical, finance/structure-oriented career. Strong in operations, real estate, finance, agriculture, building trades.', timeframe: 'lifetime' },
    predicate: (c) => {
      const lagIdx = signIdx(c.ascendant && (c.ascendant.sign || c.ascendant.rashiName));
      if (lagIdx < 0) return { matched: false };
      const tenthSign = SIGN_ORDER[(lagIdx + 9) % 12];
      if (!['Taurus', 'Virgo', 'Capricorn'].includes(tenthSign)) return { matched: false };
      return { matched: true, intensity: 4, evidence: `10th house in earth sign (${tenthSign})` };
    },
  },

  {
    id: 'tenth_house_air_sign',
    domain: 'career',
    source: { book: 'Saravali', chapter: 28, verse: '22' },
    prediction: { polarity: 'positive', text: 'Communication-led career. Writing, teaching, media, law, networking, knowledge work. Verbal skills are professional assets.', timeframe: 'lifetime' },
    predicate: (c) => {
      const lagIdx = signIdx(c.ascendant && (c.ascendant.sign || c.ascendant.rashiName));
      if (lagIdx < 0) return { matched: false };
      const tenthSign = SIGN_ORDER[(lagIdx + 9) % 12];
      if (!['Gemini', 'Libra', 'Aquarius'].includes(tenthSign)) return { matched: false };
      return { matched: true, intensity: 4, evidence: `10th house in air sign (${tenthSign})` };
    },
  },

  {
    id: 'tenth_house_water_sign',
    domain: 'career',
    source: { book: 'Saravali', chapter: 28, verse: '23' },
    prediction: { polarity: 'positive', text: 'Care-giving, emotional, or fluid career. Healthcare, counseling, hospitality, water-related industries, art forms with emotional depth.', timeframe: 'lifetime' },
    predicate: (c) => {
      const lagIdx = signIdx(c.ascendant && (c.ascendant.sign || c.ascendant.rashiName));
      if (lagIdx < 0) return { matched: false };
      const tenthSign = SIGN_ORDER[(lagIdx + 9) % 12];
      if (!['Cancer', 'Scorpio', 'Pisces'].includes(tenthSign)) return { matched: false };
      return { matched: true, intensity: 4, evidence: `10th house in water sign (${tenthSign})` };
    },
  },
];
