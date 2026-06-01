// =========================================
// WEALTH RULES — 25 classical rules
// =========================================
//
// Encoded from:
//   - BPHS Ch.41 (Dhana Yoga — wealth combinations)
//   - BPHS Ch.42 (Daridra Yoga — poverty combinations)
//   - Phaladeepika Ch.13 (2nd & 11th house effects)
//   - Saravali Ch.33 (Artha — material prosperity)

const {
  planetSign, planetHouse, lordOfHouse, planetsInHouse,
  isOwnSign, isExalted, isDebilitated, isRetrograde, isCombust, aspectsHouse,
  SIGN_LORD, SIGN_ORDER, signIdx, MALEFICS,
  dashaActive, dashaIntensity,
} = require('./schema');

module.exports = [
  // ============== STRUCTURAL POSITIVES ==============

  {
    id: 'second_lord_in_kendra',
    domain: 'wealth',
    source: { book: 'BPHS', chapter: 41, verse: '5' },
    prediction: { polarity: 'positive', text: 'Solid wealth foundation. Money flows in through stable means; family wealth supports the native.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 2); if (!l) return { matched: false };
      const h = planetHouse(c, l);
      if (![1, 4, 7, 10].includes(h)) return { matched: false };
      return { matched: true, intensity: 7, evidence: `2nd lord ${l} in kendra (house ${h})` };
    },
  },

  {
    id: 'second_lord_exalted',
    domain: 'wealth',
    source: { book: 'Phaladeepika', chapter: 13, verse: '3' },
    prediction: { polarity: 'positive', text: 'Exceptional wealth potential. Inheritance, family money, or large savings.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 2); if (!l) return { matched: false };
      if (!isExalted(c, l) && !isOwnSign(c, l)) return { matched: false };
      return { matched: true, intensity: 8, evidence: `2nd lord ${l} ${isExalted(c, l) ? 'exalted' : 'in own sign'} (${planetSign(c, l)})` };
    },
  },

  {
    id: 'eleventh_lord_in_kendra',
    domain: 'wealth',
    source: { book: 'BPHS', chapter: 41, verse: '7' },
    prediction: { polarity: 'positive', text: 'Strong income streams. Gains flow naturally through career or business.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 11); if (!l) return { matched: false };
      const h = planetHouse(c, l);
      if (![1, 4, 7, 10].includes(h)) return { matched: false };
      return { matched: true, intensity: 7, evidence: `11th lord ${l} in kendra (house ${h})` };
    },
  },

  {
    id: 'second_lord_eleventh_lord_conjunct',
    domain: 'wealth',
    source: { book: 'BPHS', chapter: 41, verse: '12' },
    prediction: { polarity: 'positive', text: 'Classical Dhana Yoga. Wealth accumulation strongly indicated. Income converts to lasting savings.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l2 = lordOfHouse(c, 2), l11 = lordOfHouse(c, 11);
      if (!l2 || !l11 || l2 === l11) return { matched: false };
      const h2 = planetHouse(c, l2), h11 = planetHouse(c, l11);
      if (h2 > 0 && h2 === h11) return { matched: true, intensity: 9, evidence: `2nd lord ${l2} + 11th lord ${l11} conjunct in house ${h2}` };
      return { matched: false };
    },
  },

  {
    id: 'jupiter_in_second',
    domain: 'wealth',
    source: { book: 'Phaladeepika', chapter: 13, verse: '8' },
    prediction: { polarity: 'positive', text: 'Wealth grows steadily. Money is treated with wisdom; family supports financial stability.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Jupiter') === 2
      ? { matched: true, intensity: 7, evidence: 'Jupiter in 2nd (wealth karaka in wealth house)' }
      : { matched: false },
  },

  {
    id: 'venus_in_second',
    domain: 'wealth',
    source: { book: 'Phaladeepika', chapter: 13, verse: '9' },
    prediction: { polarity: 'positive', text: 'Wealth through refinement and luxury. Comforts come easily. Speech itself can generate income (singing, acting, lectures).', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Venus') === 2
      ? { matched: true, intensity: 7, evidence: 'Venus in 2nd' }
      : { matched: false },
  },

  {
    id: 'mercury_in_second',
    domain: 'wealth',
    source: { book: 'Phaladeepika', chapter: 13, verse: '10' },
    prediction: { polarity: 'positive', text: 'Wealth through commerce, trading, or skilled communication. Business mind sharp; deals close well.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Mercury') === 2
      ? { matched: true, intensity: 6, evidence: 'Mercury in 2nd' }
      : { matched: false },
  },

  {
    id: 'multiple_benefics_in_eleventh',
    domain: 'wealth',
    source: { book: 'BPHS', chapter: 41, verse: '15' },
    prediction: { polarity: 'positive', text: 'Multiple income sources. Each benefic represents a distinct stream of gain.', timeframe: 'lifetime' },
    predicate: (c) => {
      const benefics = planetsInHouse(c, 11).filter(p => ['Jupiter', 'Venus', 'Mercury', 'Moon'].includes(p));
      if (benefics.length < 2) return { matched: false };
      return { matched: true, intensity: 7, evidence: `${benefics.length} benefics in 11th: ${benefics.join(', ')}` };
    },
  },

  {
    id: 'fifth_lord_in_eleventh',
    domain: 'wealth',
    source: { book: 'BPHS', chapter: 41, verse: '18' },
    prediction: { polarity: 'positive', text: 'Wealth through speculation, investments, education, children, or creative work. Past-life merit translates to material gain.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 5); if (!l) return { matched: false };
      if (planetHouse(c, l) !== 11) return { matched: false };
      return { matched: true, intensity: 7, evidence: `5th lord ${l} in 11th` };
    },
  },

  {
    id: 'ninth_lord_in_second_or_eleventh',
    domain: 'wealth',
    source: { book: 'BPHS', chapter: 41, verse: '20' },
    prediction: { polarity: 'positive', text: 'Wealth comes through fortune, blessings, father\'s line, or righteous activity. Often unexpected gains.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 9); if (!l) return { matched: false };
      const h = planetHouse(c, l);
      if (h !== 2 && h !== 11) return { matched: false };
      return { matched: true, intensity: 7, evidence: `9th lord ${l} in house ${h}` };
    },
  },

  {
    id: 'jupiter_aspects_second_or_eleventh',
    domain: 'wealth',
    source: { book: 'Phaladeepika', chapter: 13, verse: '14' },
    prediction: { polarity: 'positive', text: 'Wealth is protected by ethical principles. Money grows through honest means; rarely lost through bad judgment.', timeframe: 'lifetime' },
    predicate: (c) => {
      const a2 = aspectsHouse(c, 'Jupiter', 2);
      const a11 = aspectsHouse(c, 'Jupiter', 11);
      if (!a2 && !a11) return { matched: false };
      const where = a2 && a11 ? '2nd and 11th' : a2 ? '2nd' : '11th';
      return { matched: true, intensity: 6, evidence: `Jupiter aspects ${where}` };
    },
  },

  // ============== SPECIALIZED WEALTH PATTERNS ==============

  {
    id: 'mars_in_eleventh',
    domain: 'wealth',
    source: { book: 'Saravali', chapter: 33, verse: '12' },
    prediction: { polarity: 'positive', text: 'Wealth through real estate, property, engineering, or competitive ventures. Aggressive financial growth possible.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Mars') === 11
      ? { matched: true, intensity: 6, evidence: 'Mars in 11th' }
      : { matched: false },
  },

  {
    id: 'saturn_in_eleventh',
    domain: 'wealth',
    source: { book: 'Saravali', chapter: 33, verse: '13' },
    prediction: { polarity: 'positive', text: 'Wealth through hard work and long-term investments. Late but very durable financial stability.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Saturn') === 11
      ? { matched: true, intensity: 7, evidence: 'Saturn in 11th (Saturn is exalted in gain-house functionality)' }
      : { matched: false },
  },

  {
    id: 'rahu_in_eleventh',
    domain: 'wealth',
    source: { book: 'BPHS', chapter: 41, verse: '24' },
    prediction: { polarity: 'positive', text: 'Wealth through unconventional means, foreign sources, technology, or innovative business. Sudden large gains possible.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Rahu') === 11
      ? { matched: true, intensity: 7, evidence: 'Rahu in 11th (Rahu thrives in gain-house)' }
      : { matched: false },
  },

  {
    id: 'twelfth_lord_in_eleventh',
    domain: 'wealth',
    source: { book: 'BPHS', chapter: 41, verse: '26' },
    prediction: { polarity: 'positive', text: 'Income from foreign sources, exports, online platforms, or distant clients. Vipreet-Rajayoga producing wealth from "loss" house.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 12); if (!l) return { matched: false };
      if (planetHouse(c, l) !== 11) return { matched: false };
      return { matched: true, intensity: 7, evidence: `12th lord ${l} in 11th (foreign/online income)` };
    },
  },

  {
    id: 'sun_in_second',
    domain: 'wealth',
    source: { book: 'Phaladeepika', chapter: 13, verse: '11' },
    prediction: { polarity: 'mixed', text: 'Wealth through authority, government, or fame. May come and go in waves rather than steady accumulation.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Sun') === 2
      ? { matched: true, intensity: 5, evidence: 'Sun in 2nd' }
      : { matched: false },
  },

  // ============== STRUCTURAL NEGATIVES ==============

  {
    id: 'second_lord_in_dusthana',
    domain: 'wealth',
    source: { book: 'Phaladeepika', chapter: 13, verse: '17' },
    prediction: { polarity: 'negative', text: 'Financial volatility. Money slips through fingers; unexpected expenses recur. Caution with debt and speculation.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 2); if (!l) return { matched: false };
      const h = planetHouse(c, l);
      if (![6, 8, 12].includes(h)) return { matched: false };
      return { matched: true, intensity: 6, evidence: `2nd lord ${l} in dusthana (house ${h})` };
    },
  },

  {
    id: 'second_lord_debilitated',
    domain: 'wealth',
    source: { book: 'Phaladeepika', chapter: 13, verse: '18' },
    prediction: { polarity: 'negative', text: 'Wealth below potential. Earning capacity exists but accumulation is difficult. Family financial support may be limited.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 2); if (!l) return { matched: false };
      if (!isDebilitated(c, l)) return { matched: false };
      return { matched: true, intensity: 6, evidence: `2nd lord ${l} debilitated in ${planetSign(c, l)}` };
    },
  },

  {
    id: 'eleventh_lord_in_sixth',
    domain: 'wealth',
    source: { book: 'BPHS', chapter: 42, verse: '6' },
    prediction: { polarity: 'negative', text: 'Income often drained by debts, loans, or service obligations. Gains exist but rarely translate to savings.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 11); if (!l) return { matched: false };
      if (planetHouse(c, l) !== 6) return { matched: false };
      return { matched: true, intensity: 5, evidence: `11th lord ${l} in 6th (income → debts)` };
    },
  },

  {
    id: 'malefics_in_second_no_jupiter',
    domain: 'wealth',
    source: { book: 'Saravali', chapter: 33, verse: '22' },
    prediction: { polarity: 'negative', text: 'Risk of financial loss through speech, conflict, or impulsive decisions. Family disputes over money possible.', timeframe: 'lifetime' },
    predicate: (c) => {
      const malefics = planetsInHouse(c, 2).filter(p => MALEFICS.includes(p));
      if (malefics.length === 0) return { matched: false };
      // Cancellation: if Jupiter aspects 2nd
      if (aspectsHouse(c, 'Jupiter', 2)) {
        return { matched: true, cancelled: 'Jupiter aspects 2nd — afflictions mitigated' };
      }
      return { matched: true, intensity: 5, evidence: `Malefics in 2nd (${malefics.join(', ')}) without Jupiter aspect` };
    },
  },

  // ============== TIMING ==============

  {
    id: 'currently_in_dhana_lord_dasha',
    domain: 'wealth',
    source: { book: 'BPHS', chapter: 41, verse: '38' },
    prediction: { polarity: 'positive', text: 'Active dasha of a wealth-house lord — primary classical wealth-timing window. Investments, raises, or unexpected gains likely.', timeframe: 'currentDasha' },
    predicate: (c) => {
      const l2 = lordOfHouse(c, 2), l11 = lordOfHouse(c, 11);
      const layer2 = l2 && dashaActive(c, l2);
      const layer11 = l11 && dashaActive(c, l11);
      if (!layer2 && !layer11) return { matched: false };
      const active = [];
      if (layer2) active.push(`${l2}(${layer2})`);
      if (layer11) active.push(`${l11}(${layer11})`);
      const bestLayer = layer2 || layer11;
      return {
        matched: true,
        intensity: (layer2 && layer11) ? dashaIntensity(bestLayer) + 1 : dashaIntensity(bestLayer),
        evidence: `Wealth-house lord(s) active: ${active.join(', ')}`,
      };
    },
  },

  {
    id: 'jupiter_dasha_growing_money',
    domain: 'wealth',
    source: { book: 'BPHS', chapter: 51, verse: '11' },
    prediction: { polarity: 'positive', text: 'Jupiter active in dasha — wealth-karaka period. Expansion of resources, returning investments, education-related income.', timeframe: 'currentDasha' },
    predicate: (c) => {
      const layer = dashaActive(c, 'Jupiter');
      if (!layer) return { matched: false };
      return { matched: true, intensity: dashaIntensity(layer) - 1, evidence: `Jupiter active at ${layer} level` };
    },
  },

  // ============== SPECIAL YOGAS ==============

  {
    id: 'lakshmi_yoga_referenced',
    domain: 'wealth',
    source: { book: 'BPHS', chapter: 36, verse: '27' },
    prediction: { polarity: 'positive', text: 'Lakshmi Yoga indicated by chart structure — material abundance, attractive lifestyle, fortunate marriage and family circumstance.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l9 = lordOfHouse(c, 9); if (!l9) return { matched: false };
      const dignified9 = isOwnSign(c, l9) || isExalted(c, l9);
      const venusStrong = isOwnSign(c, 'Venus') || isExalted(c, 'Venus') || [1, 4, 7, 10].includes(planetHouse(c, 'Venus'));
      if (!dignified9 || !venusStrong) return { matched: false };
      return { matched: true, intensity: 8, evidence: '9th lord dignified + Venus strong (Lakshmi Yoga conditions)' };
    },
  },

  {
    id: 'sun_eleventh_authority_income',
    domain: 'wealth',
    source: { book: 'Saravali', chapter: 33, verse: '11' },
    prediction: { polarity: 'positive', text: 'Income through authority figures, government, or hierarchical structures. Recognition often precedes financial reward.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Sun') === 11
      ? { matched: true, intensity: 6, evidence: 'Sun in 11th' }
      : { matched: false },
  },

  {
    id: 'moon_eleventh_mass_appeal_gains',
    domain: 'wealth',
    source: { book: 'Saravali', chapter: 33, verse: '10' },
    prediction: { polarity: 'positive', text: 'Income through public appeal, hospitality, healthcare, or services to the broader community.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Moon') === 11
      ? { matched: true, intensity: 6, evidence: 'Moon in 11th' }
      : { matched: false },
  },

  // ============== EXPANDED NEGATIVES (polarity-balance audit) ==============
  // Wealth had 20 positive vs 4 negative rules. Adding 5 classical
  // negative configurations so charts with real financial fragility
  // can surface that honestly instead of producing optimistic answers.

  {
    id: 'second_lord_in_dusthana',
    domain: 'wealth',
    source: { book: 'Phaladeepika', chapter: 7, verse: '11' },
    note: '2nd lord (Dhanesha) in 6/8/12 dissipates wealth — through debts (6), sudden setbacks (8), or expenses (12).',
    prediction: { polarity: 'negative', text: 'Wealth tends to dissipate as fast as it arrives. Money goes to debts, unexpected emergencies, or unavoidable expenses. Savings struggle to compound. Financial discipline must be deliberate, not natural.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 2); if (!l) return { matched: false };
      const h = planetHouse(c, l);
      if (![6, 8, 12].includes(h)) return { matched: false };
      const intensity = h === 8 ? 8 : 7;
      return { matched: true, intensity, evidence: `2nd lord ${l} in dusthana (house ${h})` };
    },
  },

  {
    id: 'eleventh_lord_in_dusthana',
    domain: 'wealth',
    source: { book: 'BPHS', chapter: 50, verse: '9' },
    note: '11th lord (Labhesha — gains) afflicted in 6/8/12 blocks income flow. Income expected from a source is delayed, contested, or evaporates.',
    prediction: { polarity: 'negative', text: 'Gains and income face friction. Expected pay-outs delay, deals fall through at the last step, or income arrives smaller than promised. The earning side of the chart needs active management, not passive trust.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 11); if (!l) return { matched: false };
      const h = planetHouse(c, l);
      if (![6, 8, 12].includes(h)) return { matched: false };
      return { matched: true, intensity: 7, evidence: `11th lord ${l} in dusthana (house ${h})` };
    },
  },

  {
    id: 'sixth_lord_in_second',
    domain: 'wealth',
    source: { book: 'Phaladeepika', chapter: 7, verse: '14' },
    note: '6th lord (enemies, debts, disputes) sitting in the 2nd house (wealth, family resources) brings 6th-house themes into the money zone.',
    prediction: { polarity: 'negative', text: 'Money attracts disputes — loans, legal battles over assets, contested inheritances, or chronic debt cycles. Family financial conflicts are likely. Lending money to relatives rarely ends well.', timeframe: 'lifetime' },
    predicate: (c) => {
      const sixL = lordOfHouse(c, 6); if (!sixL) return { matched: false };
      const secL = lordOfHouse(c, 2);
      if (planetHouse(c, sixL) !== 2) return { matched: false };
      if (sixL === secL) return { matched: false }; // dual rulership exception
      return { matched: true, intensity: 6, evidence: `6th lord ${sixL} in 2nd house` };
    },
  },

  {
    id: 'second_lord_combust',
    domain: 'wealth',
    source: { book: 'Saravali', chapter: 33, verse: '18' },
    note: 'A combust 2nd lord loses its independent power. Personal wealth gets eclipsed by family or institutional control.',
    prediction: { polarity: 'negative', text: 'Personal wealth is hard to separate from family/institutional control. Money sits in accounts you don\'t fully control, or income depends on a single dominant figure (father, employer, family elder). Financial independence requires conscious effort.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 2); if (!l) return { matched: false };
      if (!isCombust(c, l)) return { matched: false };
      return { matched: true, intensity: 6, evidence: `2nd lord ${l} combust` };
    },
  },

  {
    id: 'multiple_malefics_in_second',
    domain: 'wealth',
    source: { book: 'BPHS', chapter: 50, verse: '15' },
    note: 'Two or more malefics in the 2nd house without benefic relief erode family wealth and speech-related earning capacity.',
    prediction: { polarity: 'negative', text: 'Multiple malefic forces in the wealth house. Inheritance is contested or absent, savings face periodic erosion, and speech-driven earning (sales, negotiation) requires extra effort. Aggressive financial behaviour is a real risk.', timeframe: 'lifetime' },
    predicate: (c) => {
      const inSecond = planetsInHouse(c, 2).filter(p => MALEFICS.includes(p));
      if (inSecond.length < 2) return { matched: false };
      // Jupiter aspecting 2nd cancels much of this
      if (aspectsHouse(c, 'Jupiter', 2)) return { matched: false };
      return { matched: true, intensity: 7, evidence: `Multiple malefics in 2nd: ${inSecond.join(', ')}` };
    },
  },
];
