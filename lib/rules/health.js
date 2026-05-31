// =========================================
// HEALTH RULES — 25 classical rules
// =========================================
//
// Encoded from:
//   - BPHS Ch.40 (Lagna Bhava — vitality)
//   - BPHS Ch.45 (Ari Bhava — 6th house, disease)
//   - Phaladeepika Ch.16 (Health & longevity)
//   - Saravali Ch.40 (Diseases)
//
// IMPORTANT — these rules describe CONSTITUTIONAL TENDENCIES, never
// diagnoses. The LLM is instructed elsewhere to never predict
// specific illnesses or death. Health rules surface only as
// "constitutional pattern: X tendency; consider lifestyle Y."

const {
  planetSign, planetHouse, lordOfHouse, planetsInHouse,
  isOwnSign, isExalted, isDebilitated, aspectsHouse,
  SIGN_LORD, SIGN_ORDER, signIdx, MALEFICS,
} = require('./schema');

module.exports = [
  // ============== VITALITY (POSITIVE) ==============

  {
    id: 'lagna_lord_strong',
    domain: 'health',
    source: { book: 'BPHS', chapter: 40, verse: '4' },
    prediction: { polarity: 'positive', text: 'Strong constitution and natural vitality. Body recovers well from illness; immunity is robust.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 1); if (!l) return { matched: false };
      const dignified = isOwnSign(c, l) || isExalted(c, l);
      const inKendra = [1, 4, 7, 10].includes(planetHouse(c, l));
      if (!dignified && !inKendra) return { matched: false };
      return { matched: true, intensity: 7, evidence: `Lagna lord ${l} ${dignified ? 'dignified' : 'in kendra'}` };
    },
  },

  {
    id: 'jupiter_in_lagna',
    domain: 'health',
    source: { book: 'BPHS', chapter: 40, verse: '8' },
    prediction: { polarity: 'positive', text: 'Jupiter in 1st house protects body and mind. Strong recovery from illness; benevolent constitution.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Jupiter') === 1
      ? { matched: true, intensity: 8, evidence: 'Jupiter in lagna' }
      : { matched: false },
  },

  {
    id: 'jupiter_aspects_lagna',
    domain: 'health',
    source: { book: 'Phaladeepika', chapter: 16, verse: '6' },
    prediction: { polarity: 'positive', text: 'Jupiter\'s aspect on lagna provides resilience and capacity to recover. Disease rarely takes root deeply.', timeframe: 'lifetime' },
    predicate: (c) => {
      // Jupiter occupies lagna OR aspects (5th/7th/9th from Jupiter back to lagna)
      if (planetHouse(c, 'Jupiter') === 1) return { matched: false }; // covered by above
      if (!aspectsHouse(c, 'Jupiter', 1)) return { matched: false };
      return { matched: true, intensity: 6, evidence: 'Jupiter aspects lagna' };
    },
  },

  {
    id: 'sixth_lord_in_dusthana',
    domain: 'health',
    source: { book: 'BPHS', chapter: 45, verse: '12' },
    note: 'Vipreet Rajayoga of the 6th house — the disease-causing lord weakened.',
    prediction: { polarity: 'positive', text: 'Strong resistance to chronic disease. The "disease lord" itself is weakened — illnesses are caught early or never manifest seriously.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 6); if (!l) return { matched: false };
      const h = planetHouse(c, l);
      if (![6, 8, 12].includes(h) || h === 6) return { matched: false }; // exclude 6 in 6
      return { matched: true, intensity: 7, evidence: `6th lord ${l} in dusthana ${h} (Vipreet Rajayoga for health)` };
    },
  },

  {
    id: 'venus_jupiter_aspect_lagna',
    domain: 'health',
    source: { book: 'Phaladeepika', chapter: 16, verse: '8' },
    prediction: { polarity: 'positive', text: 'Combined benefic influence on body provides strong immune system, attractive constitution, balanced lifestyle.', timeframe: 'lifetime' },
    predicate: (c) => {
      const j = aspectsHouse(c, 'Jupiter', 1);
      const v = aspectsHouse(c, 'Venus', 1);
      if (!j || !v) return { matched: false };
      return { matched: true, intensity: 8, evidence: 'Both Jupiter and Venus aspect lagna' };
    },
  },

  // ============== STRUCTURAL CONCERNS ==============

  {
    id: 'lagna_lord_debilitated',
    domain: 'health',
    source: { book: 'Phaladeepika', chapter: 16, verse: '12' },
    prediction: { polarity: 'negative', text: 'Constitutional sensitivity. Body may feel less robust than peers; recovery from illness takes longer. Lifestyle discipline is crucial.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 1); if (!l) return { matched: false };
      if (!isDebilitated(c, l)) return { matched: false };
      return { matched: true, intensity: 7, evidence: `Lagna lord ${l} debilitated in ${planetSign(c, l)}` };
    },
  },

  {
    id: 'lagna_lord_in_eighth',
    domain: 'health',
    source: { book: 'BPHS', chapter: 40, verse: '17' },
    prediction: { polarity: 'negative', text: 'Vitality drains through transformations or hidden stress. Periodic health crises possible; chronic-tendency patterns warrant attention.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 1); if (!l) return { matched: false };
      if (planetHouse(c, l) !== 8) return { matched: false };
      return { matched: true, intensity: 6, evidence: `Lagna lord ${l} in 8th house` };
    },
  },

  {
    id: 'malefic_in_lagna_no_benefic_aspect',
    domain: 'health',
    source: { book: 'Saravali', chapter: 40, verse: '5' },
    prediction: { polarity: 'negative', text: 'Body affected by the energy of the malefic in lagna. Lifestyle pattern needs deliberate calming influence.', timeframe: 'lifetime' },
    predicate: (c) => {
      const malefics = planetsInHouse(c, 1).filter(p => MALEFICS.includes(p));
      if (malefics.length === 0) return { matched: false };
      if (aspectsHouse(c, 'Jupiter', 1) || aspectsHouse(c, 'Venus', 1)) {
        return { matched: true, cancelled: 'Benefic aspect on lagna mitigates' };
      }
      return { matched: true, intensity: 5, evidence: `Malefic(s) in lagna: ${malefics.join(', ')}` };
    },
  },

  // ============== PLANETARY PLACEMENTS IN 6TH ==============

  {
    id: 'sun_in_sixth',
    domain: 'health',
    source: { book: 'Saravali', chapter: 40, verse: '10' },
    prediction: { polarity: 'mixed', text: 'Strong against open enemies; sensitive heart, eyes, or digestive heat. Manage stress and inflammation; avoid excessive sun exposure.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Sun') === 6
      ? { matched: true, intensity: 5, evidence: 'Sun in 6th' }
      : { matched: false },
  },

  {
    id: 'moon_in_sixth',
    domain: 'health',
    source: { book: 'Saravali', chapter: 40, verse: '11' },
    prediction: { polarity: 'negative', text: 'Emotional/mental health needs attention. Anxiety, mood swings, or stress-induced ailments more likely. Protect sleep and mental space.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Moon') === 6
      ? { matched: true, intensity: 6, evidence: 'Moon in 6th — mind in disease house' }
      : { matched: false },
  },

  {
    id: 'mars_in_sixth',
    domain: 'health',
    source: { book: 'Saravali', chapter: 40, verse: '12' },
    prediction: { polarity: 'positive', text: 'Strong defense against enemies and illness. High physical energy; suited to sports and athletic recovery. (Mars excels in 6th.)', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Mars') === 6
      ? { matched: true, intensity: 7, evidence: 'Mars in 6th (its excellent house functionally)' }
      : { matched: false },
  },

  {
    id: 'rahu_in_sixth',
    domain: 'health',
    source: { book: 'BPHS', chapter: 45, verse: '20' },
    prediction: { polarity: 'positive', text: 'Strong against unconventional or hidden enemies. Immune system handles unusual challenges; foreign cuisine and travel tolerated.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Rahu') === 6
      ? { matched: true, intensity: 6, evidence: 'Rahu in 6th (Rahu thrives in 6th)' }
      : { matched: false },
  },

  {
    id: 'saturn_in_sixth',
    domain: 'health',
    source: { book: 'Saravali', chapter: 40, verse: '14' },
    prediction: { polarity: 'positive', text: 'Slowly built resilience. Body learns through discipline; chronic-condition risk reduces through routine. Late health peaks possible.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Saturn') === 6
      ? { matched: true, intensity: 6, evidence: 'Saturn in 6th (Saturn well-placed for resilience)' }
      : { matched: false },
  },

  // ============== KEY PLANETARY AFFLICTIONS ==============

  {
    id: 'mars_saturn_conjunction',
    domain: 'health',
    source: { book: 'BPHS', chapter: 45, verse: '23' },
    prediction: { polarity: 'negative', text: 'Tendency toward injuries, surgeries, or chronic inflammation when triggered. Build slow-and-steady physical habits; avoid extreme sports without preparation.', timeframe: 'lifetime' },
    predicate: (c) => {
      const ms = planetSign(c, 'Mars'); const ss = planetSign(c, 'Saturn');
      if (!ms || !ss || ms !== ss) return { matched: false };
      return { matched: true, intensity: 6, evidence: `Mars + Saturn conjunct in ${ms}` };
    },
  },

  {
    id: 'mercury_rahu_conjunction',
    domain: 'health',
    source: { book: 'Saravali', chapter: 40, verse: '18' },
    prediction: { polarity: 'negative', text: 'Nervous system sensitivity; anxiety patterns; overthinking. Practice grounding routines (regular sleep, meditation, screen-time limits).', timeframe: 'lifetime' },
    predicate: (c) => {
      const ms = planetSign(c, 'Mercury'); const rs = planetSign(c, 'Rahu');
      if (!ms || !rs || ms !== rs) return { matched: false };
      return { matched: true, intensity: 5, evidence: `Mercury + Rahu conjunct in ${ms}` };
    },
  },

  {
    id: 'moon_saturn_conjunction',
    domain: 'health',
    source: { book: 'Phaladeepika', chapter: 16, verse: '20' },
    prediction: { polarity: 'negative', text: 'Mind-body weight: melancholy tendency; tendency toward isolation. Sun, social contact, and movement are medicine.', timeframe: 'lifetime' },
    predicate: (c) => {
      const ms = planetSign(c, 'Moon'); const ss = planetSign(c, 'Saturn');
      if (!ms || !ss || ms !== ss) return { matched: false };
      return { matched: true, intensity: 6, evidence: `Moon + Saturn conjunct in ${ms}` };
    },
  },

  // ============== ELEMENTAL / SIGN CONSTITUTION ==============

  {
    id: 'lagna_in_fire_sign',
    domain: 'health',
    source: { book: 'Saravali', chapter: 40, verse: '3' },
    prediction: { polarity: 'mixed', text: 'Pitta constitution. Strong digestion, sharp mind; risk of inflammation, heat-related issues, burnout from intensity. Cool foods and pacing help.', timeframe: 'lifetime' },
    predicate: (c) => {
      const lag = SIGN_ORDER[signIdx(c.ascendant && (c.ascendant.sign || c.ascendant.rashiName))];
      if (!['Aries', 'Leo', 'Sagittarius'].includes(lag)) return { matched: false };
      return { matched: true, intensity: 4, evidence: `Lagna in fire sign (${lag}) — pitta dominance` };
    },
  },

  {
    id: 'lagna_in_earth_sign',
    domain: 'health',
    source: { book: 'Saravali', chapter: 40, verse: '4' },
    prediction: { polarity: 'mixed', text: 'Kapha-dominant constitution. Strong stamina; risk of weight gain, lethargy, congestion. Movement and lighter foods are key.', timeframe: 'lifetime' },
    predicate: (c) => {
      const lag = SIGN_ORDER[signIdx(c.ascendant && (c.ascendant.sign || c.ascendant.rashiName))];
      if (!['Taurus', 'Virgo', 'Capricorn'].includes(lag)) return { matched: false };
      return { matched: true, intensity: 4, evidence: `Lagna in earth sign (${lag}) — kapha dominance` };
    },
  },

  {
    id: 'lagna_in_air_sign',
    domain: 'health',
    source: { book: 'Saravali', chapter: 40, verse: '5' },
    prediction: { polarity: 'mixed', text: 'Vata-dominant constitution. Mentally agile; risk of nervous-system disorders, dryness, irregular sleep. Routine and warm food stabilize.', timeframe: 'lifetime' },
    predicate: (c) => {
      const lag = SIGN_ORDER[signIdx(c.ascendant && (c.ascendant.sign || c.ascendant.rashiName))];
      if (!['Gemini', 'Libra', 'Aquarius'].includes(lag)) return { matched: false };
      return { matched: true, intensity: 4, evidence: `Lagna in air sign (${lag}) — vata dominance` };
    },
  },

  {
    id: 'lagna_in_water_sign',
    domain: 'health',
    source: { book: 'Saravali', chapter: 40, verse: '6' },
    prediction: { polarity: 'mixed', text: 'Kapha-pitta blend, emotionally sensitive constitution. Risk of fluid imbalances, glandular issues; emotional state directly affects physical health.', timeframe: 'lifetime' },
    predicate: (c) => {
      const lag = SIGN_ORDER[signIdx(c.ascendant && (c.ascendant.sign || c.ascendant.rashiName))];
      if (!['Cancer', 'Scorpio', 'Pisces'].includes(lag)) return { matched: false };
      return { matched: true, intensity: 4, evidence: `Lagna in water sign (${lag}) — kapha-pitta blend` };
    },
  },

  // ============== TIMING ==============

  {
    id: 'sade_sati_health_caution',
    domain: 'health',
    source: { book: 'Phaladeepika', chapter: 26, verse: '14' },
    prediction: { polarity: 'mixed', text: 'During Sade Sati, the body may signal stress through fatigue, weight changes, or sleep disturbance. This is a period to prioritize lifestyle discipline.', timeframe: 'transit' },
    predicate: (c) => {
      const t = c.transits;
      if (!t || !t.sadeSati || !t.sadeSati.active) return { matched: false };
      return { matched: true, intensity: 6, evidence: `Sade Sati active (${t.sadeSati.phase} phase)` };
    },
  },

  {
    id: 'saturn_dasha_chronic_caution',
    domain: 'health',
    source: { book: 'BPHS', chapter: 51, verse: '14' },
    prediction: { polarity: 'mixed', text: 'Saturn dasha periods reveal long-standing health patterns. Body asks for routine, sleep regularity, and slow strengthening — not quick fixes.', timeframe: 'currentDasha' },
    predicate: (c) => {
      const md = c.dasha && c.dasha.mahadasha;
      if (md !== 'Saturn') return { matched: false };
      const weakSat = isDebilitated(c, 'Saturn') || [6, 8, 12].includes(planetHouse(c, 'Saturn'));
      if (!weakSat) return { matched: false };
      return { matched: true, intensity: 5, evidence: 'Saturn dasha active with Saturn in vulnerable position' };
    },
  },

  // ============== SPECIFIC AFFLICTION COMBINATIONS ==============

  {
    id: 'eighth_lord_with_lagna_lord',
    domain: 'health',
    source: { book: 'BPHS', chapter: 40, verse: '23' },
    prediction: { polarity: 'negative', text: 'Body and transformation house tied — chronic patterns or recurring health themes. Long-term lifestyle commitment is the key, not short-term fixes.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l1 = lordOfHouse(c, 1); const l8 = lordOfHouse(c, 8);
      if (!l1 || !l8 || l1 === l8) return { matched: false };
      const h1 = planetHouse(c, l1); const h8 = planetHouse(c, l8);
      if (h1 !== h8) return { matched: false };
      return { matched: true, intensity: 6, evidence: `Lagna lord ${l1} + 8th lord ${l8} conjunct in house ${h1}` };
    },
  },

  {
    id: 'no_planets_in_six_and_lagna_strong',
    domain: 'health',
    source: { book: 'Phaladeepika', chapter: 16, verse: '24' },
    prediction: { polarity: 'positive', text: 'Empty 6th + strong lagna = excellent constitutional baseline. Disease-house is quiet; body operates from a place of natural ease.', timeframe: 'lifetime' },
    predicate: (c) => {
      const sixth = planetsInHouse(c, 6);
      if (sixth.length > 0) return { matched: false };
      const l = lordOfHouse(c, 1); if (!l) return { matched: false };
      const dignified = isOwnSign(c, l) || isExalted(c, l) || [1, 4, 5, 7, 9, 10].includes(planetHouse(c, l));
      if (!dignified) return { matched: false };
      return { matched: true, intensity: 7, evidence: 'No planets in 6th + lagna lord well-placed' };
    },
  },

  {
    id: 'venus_in_lagna_attractive_health',
    domain: 'health',
    source: { book: 'Saravali', chapter: 40, verse: '8' },
    prediction: { polarity: 'positive', text: 'Strong sense of physical wellbeing; attractive constitution. Pleasant lifestyle, comfort-loving — moderation in sensual pleasures helps maintain balance.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Venus') === 1
      ? { matched: true, intensity: 6, evidence: 'Venus in lagna' }
      : { matched: false },
  },
];
