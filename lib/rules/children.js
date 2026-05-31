// =========================================
// CHILDREN RULES — 20 classical rules
// =========================================
//
// Encoded from:
//   - BPHS Ch.81 (Putra Bhava — 5th house, children)
//   - Phaladeepika Ch.20 (5th house effects)
//   - Saravali Ch.8 (Conception — newly indexed in our RAG)
//   - Jaimini Sutras Ch.1 (Putrakaraka — significator)
//
// Jupiter is the universal Putra Karaka (children significator).
// Saptamsa (D7) is the divisional chart specifically for progeny.
//
// IMPORTANT — these rules describe INDICATIONS, never certainties.
// Reproductive predictions are sensitive: the LLM is instructed to
// frame these as "indications in the chart" not "you will/won't
// have children." Saturn-affliction patterns surface as "may need
// patience or medical support" not "will be childless."

const {
  planetSign, planetHouse, lordOfHouse, planetsInHouse,
  isOwnSign, isExalted, isDebilitated, aspectsHouse,
  SIGN_LORD, SIGN_ORDER, signIdx, MALEFICS,
  dashaActive, dashaIntensity,
} = require('./schema');

module.exports = [
  // ============== POSITIVE / FAVOURABLE ==============

  {
    id: 'fifth_lord_strong',
    domain: 'children',
    source: { book: 'BPHS', chapter: 81, verse: '12' },
    prediction: {
      polarity: 'positive',
      text: 'Strong indications for children. The 5th house is well-supported, suggesting natural fertility and healthy progeny.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      const l = lordOfHouse(c, 5); if (!l) return { matched: false };
      const dignified = isOwnSign(c, l) || isExalted(c, l);
      const inKendraOrTrikona = [1, 4, 5, 7, 9, 10].includes(planetHouse(c, l));
      if (!dignified && !inKendraOrTrikona) return { matched: false };
      return {
        matched: true,
        intensity: dignified && inKendraOrTrikona ? 9 : (dignified ? 8 : 7),
        evidence: `5th lord ${l} ${dignified ? 'dignified (' + planetSign(c, l) + ')' : 'in kendra/trikona'}`,
      };
    },
  },

  {
    id: 'jupiter_in_fifth',
    domain: 'children',
    source: { book: 'Phaladeepika', chapter: 20, verse: '5' },
    note: 'Jupiter is the universal Putra Karaka (children significator). In its own house = exceptional.',
    prediction: {
      polarity: 'positive',
      text: 'Jupiter in 5th — children-karaka in children-house. Strongly auspicious for progeny; children tend to be wise, virtuous, supportive in old age.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      if (planetHouse(c, 'Jupiter') !== 5) return { matched: false };
      const debil = isDebilitated(c, 'Jupiter');
      return {
        matched: true,
        intensity: debil ? 6 : 9,
        evidence: `Jupiter in 5th${debil ? ' (debilitated — strength reduced)' : ''}`,
      };
    },
  },

  {
    id: 'jupiter_aspects_fifth',
    domain: 'children',
    source: { book: 'BPHS', chapter: 81, verse: '14' },
    prediction: {
      polarity: 'positive',
      text: 'Jupiter\'s aspect on 5th — protective influence on children matters. Reduces obstacles even when other 5th-house indicators are weak.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      if (planetHouse(c, 'Jupiter') === 5) return { matched: false }; // already covered
      if (!aspectsHouse(c, 'Jupiter', 5)) return { matched: false };
      return { matched: true, intensity: 7, evidence: 'Jupiter aspects 5th house' };
    },
  },

  {
    id: 'fifth_lord_in_kendra',
    domain: 'children',
    source: { book: 'BPHS', chapter: 81, verse: '18' },
    prediction: {
      polarity: 'positive',
      text: '5th-lord in kendra strengthens the children house. Childbirth and parenting tend to manifest with manageable obstacles.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      const l = lordOfHouse(c, 5); if (!l) return { matched: false };
      if (![1, 4, 7, 10].includes(planetHouse(c, l))) return { matched: false };
      return { matched: true, intensity: 7, evidence: `5th lord ${l} in kendra (house ${planetHouse(c, l)})` };
    },
  },

  {
    id: 'venus_or_moon_in_fifth',
    domain: 'children',
    source: { book: 'Saravali', chapter: 8, verse: '4' },
    prediction: {
      polarity: 'positive',
      text: 'Venus or Moon in 5th — favourable for conception, emotional bond with children, generally a nurturing parental phase.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      const v = planetHouse(c, 'Venus') === 5;
      const m = planetHouse(c, 'Moon') === 5;
      if (!v && !m) return { matched: false };
      const who = v && m ? 'Venus and Moon' : v ? 'Venus' : 'Moon';
      return { matched: true, intensity: v && m ? 8 : 6, evidence: `${who} in 5th` };
    },
  },

  // ============== TIMING ==============

  {
    id: 'currently_in_fifth_lord_dasha',
    domain: 'children',
    source: { book: 'BPHS', chapter: 81, verse: '28' },
    prediction: {
      polarity: 'positive',
      text: 'Dasha of 5th lord active — classical primary trigger for child-related events (conception, birth, milestones).',
      timeframe: 'currentDasha',
    },
    predicate: (c) => {
      const l = lordOfHouse(c, 5); if (!l) return { matched: false };
      const layer = dashaActive(c, l);
      if (!layer) return { matched: false };
      return {
        matched: true,
        intensity: dashaIntensity(layer) + 1, // 5L is primary children trigger
        evidence: `5th lord ${l} active at ${layer} level`,
      };
    },
  },

  {
    id: 'currently_in_jupiter_dasha',
    domain: 'children',
    source: { book: 'BPHS', chapter: 51, verse: '11' },
    prediction: {
      polarity: 'positive',
      text: 'Jupiter active in dasha — putra-karaka period. Naturally favourable for conception and family expansion.',
      timeframe: 'currentDasha',
    },
    predicate: (c) => {
      const layer = dashaActive(c, 'Jupiter');
      if (!layer) return { matched: false };
      return {
        matched: true,
        intensity: dashaIntensity(layer) - 1,
        evidence: `Jupiter active at ${layer} level`,
      };
    },
  },

  // ============== KARAKAS / DIVISIONAL ==============

  {
    id: 'putrakaraka_strong',
    domain: 'children',
    source: { book: 'Jaimini Sutras', chapter: 1, verse: '34' },
    note: 'Putrakaraka (PuK) = Jaimini\'s specific significator for children.',
    prediction: {
      polarity: 'positive',
      text: 'Putrakaraka well-placed — soul-level alignment with parenthood. Children carry forward family dharma; relationship tends to be karmically meaningful.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      if (!c.karakas || !c.karakas.Putrakaraka) return { matched: false };
      const puk = c.karakas.Putrakaraka.planet;
      if (!isOwnSign(c, puk) && !isExalted(c, puk)) return { matched: false };
      return { matched: true, intensity: 7, evidence: `Putrakaraka ${puk} dignified in ${planetSign(c, puk)}` };
    },
  },

  // ============== STRUCTURAL CONCERNS ==============

  {
    id: 'fifth_lord_in_dusthana',
    domain: 'children',
    source: { book: 'Phaladeepika', chapter: 20, verse: '11' },
    prediction: {
      polarity: 'negative',
      text: 'Delays or complications with children. Conception may take longer than expected, or first attempts may face setbacks. Patience and medical support may help.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      const l = lordOfHouse(c, 5); if (!l) return { matched: false };
      const h = planetHouse(c, l);
      if (![6, 8, 12].includes(h)) return { matched: false };
      return { matched: true, intensity: 6, evidence: `5th lord ${l} in dusthana (house ${h})` };
    },
  },

  {
    id: 'fifth_lord_debilitated',
    domain: 'children',
    source: { book: 'Phaladeepika', chapter: 20, verse: '13' },
    prediction: {
      polarity: 'negative',
      text: '5th lord debilitated weakens conception indicators. Doesn\'t prevent children but may indicate health-related parenting concerns or delayed start.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      const l = lordOfHouse(c, 5); if (!l) return { matched: false };
      if (!isDebilitated(c, l)) return { matched: false };
      return { matched: true, intensity: 6, evidence: `5th lord ${l} debilitated in ${planetSign(c, l)}` };
    },
  },

  {
    id: 'saturn_in_fifth',
    domain: 'children',
    source: { book: 'BPHS', chapter: 81, verse: '22' },
    prediction: {
      polarity: 'mixed',
      text: 'Saturn in 5th may delay children or reduce family size. When children do arrive, they may be born later in life and the parent-child bond is serious, responsible, and durable.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      if (planetHouse(c, 'Saturn') !== 5) return { matched: false };
      if (aspectsHouse(c, 'Jupiter', 5)) {
        return { matched: true, intensity: 4, evidence: 'Saturn in 5th — but Jupiter aspect mitigates' };
      }
      return { matched: true, intensity: 6, evidence: 'Saturn in 5th' };
    },
  },

  {
    id: 'mars_in_fifth',
    domain: 'children',
    source: { book: 'Saravali', chapter: 8, verse: '12' },
    prediction: {
      polarity: 'mixed',
      text: 'Mars in 5th can produce courageous, athletic children but may indicate risk of miscarriage or pregnancy complications. Medical guidance during pregnancy advised.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      if (planetHouse(c, 'Mars') !== 5) return { matched: false };
      const dignified = isOwnSign(c, 'Mars') || isExalted(c, 'Mars');
      return {
        matched: true,
        intensity: dignified ? 4 : 6,
        evidence: `Mars in 5th${dignified ? ' (dignified — courageous children)' : ''}`,
      };
    },
  },

  {
    id: 'rahu_in_fifth',
    domain: 'children',
    source: { book: 'BPHS', chapter: 81, verse: '24' },
    prediction: {
      polarity: 'mixed',
      text: 'Rahu in 5th — children matter takes unconventional path. Possibilities: adoption, IVF/medical assistance, child from previous relationship, or significant gap before first child.',
      timeframe: 'lifetime',
    },
    predicate: (c) => planetHouse(c, 'Rahu') === 5
      ? { matched: true, intensity: 6, evidence: 'Rahu in 5th' }
      : { matched: false },
  },

  {
    id: 'ketu_in_fifth',
    domain: 'children',
    source: { book: 'BPHS', chapter: 81, verse: '25' },
    prediction: {
      polarity: 'mixed',
      text: 'Ketu in 5th — spiritual or detached approach to children. May indicate fewer children but deeper philosophical bond, or interest in becoming a teacher/mentor figure.',
      timeframe: 'lifetime',
    },
    predicate: (c) => planetHouse(c, 'Ketu') === 5
      ? { matched: true, intensity: 5, evidence: 'Ketu in 5th' }
      : { matched: false },
  },

  {
    id: 'sun_in_fifth',
    domain: 'children',
    source: { book: 'Saravali', chapter: 8, verse: '10' },
    prediction: {
      polarity: 'mixed',
      text: 'Sun in 5th — children inherit strong personalities and ambition. May indicate fewer male children, or first child is male. Father-child dynamic may have authority tensions.',
      timeframe: 'lifetime',
    },
    predicate: (c) => planetHouse(c, 'Sun') === 5
      ? { matched: true, intensity: 5, evidence: 'Sun in 5th' }
      : { matched: false },
  },

  {
    id: 'multiple_malefics_in_fifth',
    domain: 'children',
    source: { book: 'BPHS', chapter: 81, verse: '30' },
    prediction: {
      polarity: 'negative',
      text: 'Multiple malefics in 5th increases obstacles around children matter. Reproductive health attention and medical guidance recommended.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      const malefics = planetsInHouse(c, 5).filter(p => MALEFICS.includes(p));
      if (malefics.length < 2) return { matched: false };
      // Jupiter aspect mitigates
      if (aspectsHouse(c, 'Jupiter', 5)) {
        return { matched: true, cancelled: 'Jupiter aspects 5th — affliction softened' };
      }
      return {
        matched: true,
        intensity: 6,
        evidence: `${malefics.length} malefics in 5th: ${malefics.join(', ')}`,
      };
    },
  },

  // ============== JUPITER (PUTRA KARAKA) AFFLICTIONS ==============

  {
    id: 'jupiter_combust',
    domain: 'children',
    source: { book: 'Phaladeepika', chapter: 20, verse: '18' },
    prediction: {
      polarity: 'negative',
      text: 'Jupiter (putra karaka) combust by Sun — children significator is weakened. May indicate health concerns in children, or fewer children than wished.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      const j = c.planets && c.planets.Jupiter;
      const s = c.planets && c.planets.Sun;
      if (!j || !s) return { matched: false };
      // Combust: within 11° of Sun (classical orb)
      const jLon = j.longitude;
      const sLon = s.longitude;
      if (typeof jLon !== 'number' || typeof sLon !== 'number') return { matched: false };
      const diff = Math.min(Math.abs(jLon - sLon), 360 - Math.abs(jLon - sLon));
      if (diff > 11) return { matched: false };
      return { matched: true, intensity: 6, evidence: `Jupiter combust (${diff.toFixed(1)}° from Sun)` };
    },
  },

  {
    id: 'jupiter_debilitated',
    domain: 'children',
    source: { book: 'BPHS', chapter: 81, verse: '33' },
    prediction: {
      polarity: 'negative',
      text: 'Jupiter debilitated — universal children-karaka weakened in dignity. Patience and Jupiter-strengthening remedies (Thursday fast, charity to children, Jupiter mantra) traditionally advised.',
      timeframe: 'lifetime',
    },
    predicate: (c) => isDebilitated(c, 'Jupiter')
      ? { matched: true, intensity: 5, evidence: `Jupiter debilitated in ${planetSign(c, 'Jupiter')}` }
      : { matched: false },
  },

  // ============== SPECIAL TIMING ==============

  {
    id: 'before_saturn_return',
    domain: 'children',
    source: { book: 'BPHS', chapter: 81, verse: '36' },
    note: 'Classical caveat: child-house matters often manifest after the first Saturn return (~28-30) for chart structures with strong Saturn presence.',
    prediction: {
      polarity: 'neutral',
      text: 'Charts with strong Saturn presence in 5th or 5th-lord often see children-related events crystallize AFTER the first Saturn return (~age 28-30). Early-life delays are not denial.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      const sat5 = planetHouse(c, 'Saturn') === 5;
      const l5 = lordOfHouse(c, 5);
      const satIsL5 = l5 === 'Saturn';
      if (!sat5 && !satIsL5) return { matched: false };
      return {
        matched: true,
        intensity: 4,
        evidence: sat5 ? 'Saturn in 5th' : `Saturn is 5th-lord (${planetSign(c, 'Saturn')})`,
      };
    },
  },

  // ============== TRANSIT TRIGGERS ==============

  {
    id: 'jupiter_transit_fifth_from_moon',
    domain: 'children',
    source: { book: 'Phaladeepika', chapter: 26, verse: '11' },
    prediction: { polarity: 'positive', text: 'Jupiter currently transits 5th from natal Moon — classical conception/childbirth-trigger window.', timeframe: 'transit' },
    predicate: (c) => {
      if (!c.transits || !c.transits.jupiter) return { matched: false };
      if (c.transits.jupiter.houseFromMoon !== 5) return { matched: false };
      return { matched: true, intensity: 8, evidence: 'Jupiter transiting 5th from Moon (event-date)' };
    },
  },
  {
    id: 'double_transit_fifth',
    domain: 'children',
    source: { book: 'BPHS', chapter: 45, verse: '24' },
    prediction: { polarity: 'positive', text: 'Double transit (Saturn + Jupiter) on the 5th house — classical strongest conception-event trigger.', timeframe: 'transit' },
    predicate: (c) => {
      if (!c.transits || !c.transits.doubleTransits) return { matched: false };
      const dt5 = c.transits.doubleTransits.find(d => d.house === 5);
      if (!dt5) return { matched: false };
      return { matched: true, intensity: 10, evidence: 'Saturn + Jupiter double transit on 5th' };
    },
  },

  // ============== 9TH HOUSE (SECONDARY FOR CHILDREN) ==============

  {
    id: 'ninth_lord_supports_fifth',
    domain: 'children',
    source: { book: 'Saravali', chapter: 8, verse: '18' },
    prediction: {
      polarity: 'positive',
      text: '9th lord (grace/dharma) supporting 5th house — children come through divine grace and contribute to family\'s spiritual lineage. Often spiritually-inclined children.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      const l9 = lordOfHouse(c, 9); if (!l9) return { matched: false };
      const h = planetHouse(c, l9);
      if (h !== 5 && !aspectsHouse(c, l9, 5)) return { matched: false };
      return {
        matched: true,
        intensity: 6,
        evidence: h === 5 ? `9th lord ${l9} in 5th` : `9th lord ${l9} aspects 5th`,
      };
    },
  },
];
