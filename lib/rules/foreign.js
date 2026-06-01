// =========================================
// FOREIGN TRAVEL & SETTLEMENT — 18 classical rules
// =========================================
//
// Sources:
//   - BPHS Ch.55 (12th house — foreign lands, exile, expenditure)
//   - BPHS Ch.43 (9th house — long journeys, pilgrimage)
//   - Phaladeepika Ch.21 (12th house effects)
//   - Saravali Ch.34 (foreign matters in worldly affairs)
//
// Houses for foreign matters:
//   - 12th = foreign settlement, exile, "moving away from birth land"
//   - 9th = long journeys, pilgrimage, foreign higher education
//   - 7th = foreign business, partnerships abroad
//   - 3rd = short-distance travel
// Rahu = foreigners, foreign culture, technology — universal karaka.

const {
  planetSign, planetHouse, lordOfHouse, planetsInHouse,
  isOwnSign, isExalted, isDebilitated, isRetrograde, isCombust, aspectsHouse,
  SIGN_LORD, SIGN_ORDER, signIdx,
  dashaActive, dashaIntensity,
} = require('./schema');

module.exports = [
  {
    id: 'twelfth_lord_in_kendra',
    domain: 'foreign',
    source: { book: 'Phaladeepika', chapter: 21, verse: '8' },
    prediction: { polarity: 'positive', text: 'Strong indications for foreign opportunities. 12th-lord well-placed = travel and overseas connections come naturally.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 12); if (!l) return { matched: false };
      if (![1, 4, 7, 10].includes(planetHouse(c, l))) return { matched: false };
      return { matched: true, intensity: 7, evidence: `12th lord ${l} in kendra (house ${planetHouse(c, l)})` };
    },
  },
  {
    id: 'rahu_in_seventh_or_twelfth',
    domain: 'foreign',
    source: { book: 'BPHS', chapter: 55, verse: '14' },
    prediction: { polarity: 'positive', text: 'Rahu in 7th or 12th — strong pull toward foreign cultures, foreign spouse, foreign business connections, or long-term overseas residence.', timeframe: 'lifetime' },
    predicate: (c) => {
      const h = planetHouse(c, 'Rahu');
      if (h !== 7 && h !== 12) return { matched: false };
      return { matched: true, intensity: 8, evidence: `Rahu in ${h === 7 ? '7th (foreign partner/business)' : '12th (foreign residence)'}` };
    },
  },
  {
    id: 'ninth_lord_in_twelfth',
    domain: 'foreign',
    source: { book: 'BPHS', chapter: 43, verse: '17' },
    prediction: { polarity: 'positive', text: 'Classical foreign-travel yoga — fortune (9th) connected to foreign lands (12th). Travel for education, work, or pilgrimage strongly indicated.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 9); if (!l) return { matched: false };
      if (planetHouse(c, l) !== 12) return { matched: false };
      return { matched: true, intensity: 8, evidence: `9th lord ${l} in 12th` };
    },
  },
  {
    id: 'twelfth_lord_in_ninth',
    domain: 'foreign',
    source: { book: 'Phaladeepika', chapter: 21, verse: '11' },
    prediction: { polarity: 'positive', text: 'Foreign connections tied to fortune — overseas travel often produces wealth, learning, or spiritual growth. Higher education abroad highly favoured.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 12); if (!l) return { matched: false };
      if (planetHouse(c, l) !== 9) return { matched: false };
      return { matched: true, intensity: 8, evidence: `12th lord ${l} in 9th` };
    },
  },
  {
    id: 'lagna_lord_in_twelfth',
    domain: 'foreign',
    source: { book: 'BPHS', chapter: 55, verse: '8' },
    prediction: { polarity: 'positive', text: 'Self (lagna lord) in foreign-house (12th) — life path involves significant time away from birthplace. Often settles abroad.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 1); if (!l) return { matched: false };
      if (planetHouse(c, l) !== 12) return { matched: false };
      return { matched: true, intensity: 8, evidence: `Lagna lord ${l} in 12th` };
    },
  },
  {
    id: 'moon_in_water_sign_foreign',
    domain: 'foreign',
    source: { book: 'Saravali', chapter: 34, verse: '8' },
    prediction: { polarity: 'positive', text: 'Moon in water sign — natural draw across oceans. Often travel happens via sea or to coastal/island regions.', timeframe: 'lifetime' },
    predicate: (c) => {
      const sign = planetSign(c, 'Moon');
      if (!['Cancer', 'Scorpio', 'Pisces'].includes(sign)) return { matched: false };
      return { matched: true, intensity: 5, evidence: `Moon in ${sign} (water sign)` };
    },
  },
  {
    id: 'multiple_planets_in_twelfth',
    domain: 'foreign',
    source: { book: 'BPHS', chapter: 55, verse: '12' },
    prediction: { polarity: 'positive', text: 'Several planets concentrated in 12th — significant foreign-element life pattern. Multiple trips, possibly multiple countries lived in.', timeframe: 'lifetime' },
    predicate: (c) => {
      const planets = planetsInHouse(c, 12).filter(p => !['Rahu', 'Ketu'].includes(p));
      if (planets.length < 2) return { matched: false };
      return { matched: true, intensity: 6, evidence: `${planets.length} planets in 12th: ${planets.join(', ')}` };
    },
  },
  {
    id: 'currently_in_rahu_dasha_foreign',
    domain: 'foreign',
    source: { book: 'BPHS', chapter: 51, verse: '21' },
    prediction: { polarity: 'positive', text: 'Rahu dasha — primary classical trigger for foreign-related events. Migration, foreign job, overseas study often manifest now.', timeframe: 'currentDasha' },
    predicate: (c) => {
      const layer = dashaActive(c, 'Rahu');
      if (!layer) return { matched: false };
      return {
        matched: true,
        intensity: dashaIntensity(layer) + 1, // Rahu is primary foreign trigger
        evidence: `Rahu active at ${layer} level`,
      };
    },
  },
  {
    id: 'currently_in_twelfth_lord_dasha',
    domain: 'foreign',
    source: { book: 'Phaladeepika', chapter: 21, verse: '20' },
    prediction: { polarity: 'positive', text: 'Dasha of 12th lord active — direct timing trigger for foreign movement, expenses related to travel, or significant overseas events.', timeframe: 'currentDasha' },
    predicate: (c) => {
      const l = lordOfHouse(c, 12); if (!l) return { matched: false };
      const layer = dashaActive(c, l);
      if (!layer) return { matched: false };
      return {
        matched: true,
        intensity: dashaIntensity(layer) + 1,
        evidence: `12th lord ${l} active at ${layer} level`,
      };
    },
  },
  // NEW: 9th-lord dasha for long-journey/foreign-education events
  {
    id: 'currently_in_ninth_lord_dasha_foreign',
    domain: 'foreign',
    source: { book: 'BPHS', chapter: 43, verse: '24' },
    prediction: { polarity: 'positive', text: 'Dasha of 9th lord active — fortune/long-journey trigger. Often foreign higher-education or pilgrimage event window.', timeframe: 'currentDasha' },
    predicate: (c) => {
      const l = lordOfHouse(c, 9); if (!l) return { matched: false };
      const layer = dashaActive(c, l);
      if (!layer) return { matched: false };
      return { matched: true, intensity: dashaIntensity(layer) - 1, evidence: `9th lord ${l} active at ${layer} level` };
    },
  },
  {
    id: 'fourth_lord_in_twelfth_settle',
    domain: 'foreign',
    source: { book: 'BPHS', chapter: 55, verse: '19' },
    prediction: { polarity: 'mixed', text: 'Home (4th) connected to foreign (12th) — home base may shift abroad. Sometimes indicates emotional distance from birthplace.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 4); if (!l) return { matched: false };
      if (planetHouse(c, l) !== 12) return { matched: false };
      return { matched: true, intensity: 6, evidence: `4th lord ${l} in 12th` };
    },
  },
  {
    id: 'tenth_lord_in_twelfth_foreign_career',
    domain: 'foreign',
    source: { book: 'BPHS', chapter: 49, verse: '34' },
    prediction: { polarity: 'positive', text: 'Career (10th) connects with foreign (12th) — likely career in international company, remote work for foreign client, or job that requires travel.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 10); if (!l) return { matched: false };
      if (planetHouse(c, l) !== 12) return { matched: false };
      return { matched: true, intensity: 7, evidence: `10th lord ${l} in 12th` };
    },
  },
  {
    id: 'ninth_house_strong_long_travel',
    domain: 'foreign',
    source: { book: 'Phaladeepika', chapter: 8, verse: '11' },
    prediction: { polarity: 'positive', text: 'Strong 9th house — favourable for long-distance travel for pilgrimage, higher education, or spiritual purpose. Foreign teachers/gurus.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 9); if (!l) return { matched: false };
      if (!isOwnSign(c, l) && !isExalted(c, l)) return { matched: false };
      return { matched: true, intensity: 6, evidence: `9th lord ${l} dignified` };
    },
  },
  {
    id: 'rahu_in_ninth',
    domain: 'foreign',
    source: { book: 'BPHS', chapter: 43, verse: '22' },
    prediction: { polarity: 'positive', text: 'Rahu in 9th — unconventional spiritual or higher-education path, often abroad. Foreign-born or foreign-trained gurus may play key role.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Rahu') === 9
      ? { matched: true, intensity: 7, evidence: 'Rahu in 9th' }
      : { matched: false },
  },
  {
    id: 'jupiter_in_twelfth',
    domain: 'foreign',
    source: { book: 'Saravali', chapter: 32, verse: '24' },
    prediction: { polarity: 'positive', text: 'Jupiter in 12th — foreign land brings expansion and blessings. Often ethical foreign work (teaching, advisory) or spiritual pilgrimage.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Jupiter') === 12
      ? { matched: true, intensity: 7, evidence: 'Jupiter in 12th' }
      : { matched: false },
  },
  {
    id: 'venus_in_twelfth',
    domain: 'foreign',
    source: { book: 'Saravali', chapter: 32, verse: '25' },
    prediction: { polarity: 'positive', text: 'Venus in 12th — comfortable foreign life. Often foreign spouse, luxury experiences abroad, or career in international luxury/hospitality.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Venus') === 12
      ? { matched: true, intensity: 6, evidence: 'Venus in 12th' }
      : { matched: false },
  },
  {
    id: 'saturn_in_twelfth_delayed_foreign',
    domain: 'foreign',
    source: { book: 'BPHS', chapter: 55, verse: '23' },
    prediction: { polarity: 'mixed', text: 'Saturn in 12th — foreign opportunities arrive after effort and patience. When they manifest, they tend to be long-lasting (decade+).', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Saturn') === 12
      ? { matched: true, intensity: 6, evidence: 'Saturn in 12th' }
      : { matched: false },
  },
  {
    id: 'ketu_in_twelfth_spiritual_foreign',
    domain: 'foreign',
    source: { book: 'Phaladeepika', chapter: 21, verse: '25' },
    prediction: { polarity: 'mixed', text: 'Ketu in 12th — strong moksha indicator. Foreign element may relate to spiritual seeking (ashram, monastery, retreat) rather than worldly migration.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Ketu') === 12
      ? { matched: true, intensity: 5, evidence: 'Ketu in 12th' }
      : { matched: false },
  },
  {
    id: 'no_foreign_indications',
    domain: 'foreign',
    source: { book: 'BPHS', chapter: 55, verse: '27' },
    prediction: { polarity: 'neutral', text: 'Chart shows no strong foreign indicators — life path more rooted in birth country. Travel can still happen, but not as a defining life feature.', timeframe: 'lifetime' },
    predicate: (c) => {
      // Match if NONE of the key foreign indicators present
      const l12 = lordOfHouse(c, 12);
      const l12House = l12 ? planetHouse(c, l12) : -1;
      const rahuH = planetHouse(c, 'Rahu');
      const lagnaLord = lordOfHouse(c, 1);
      const lagL12 = lagnaLord && planetHouse(c, lagnaLord) === 12;
      const has = (l12House === 9 || l12House === 1 || l12House === 10) ||
                  [7, 9, 12].includes(rahuH) ||
                  lagL12 ||
                  planetsInHouse(c, 12).length >= 2;
      if (has) return { matched: false };
      return { matched: true, intensity: 3, evidence: 'No strong foreign-yoga signals present' };
    },
  },

  // ============== EXPANDED NEGATIVES (polarity-balance audit) ==============
  // Foreign domain had 15 positive rules and ZERO negative rules. Going
  // abroad isn't always a success story — classical texts have plenty
  // of warnings (afflicted 12L, retrograde Rahu in 12th, etc.). Adding
  // 4 negative configurations so charts with genuine foreign-life
  // friction surface that honestly.

  {
    id: 'twelfth_lord_afflicted_by_saturn',
    domain: 'foreign',
    source: { book: 'BPHS', chapter: 55, verse: '17' },
    note: 'Saturn aspecting or conjunct the 12th lord delays and complicates foreign settlement — visa rejections, prolonged separations, hardship in the new land.',
    prediction: { polarity: 'negative', text: 'Foreign movement is achievable but heavily delayed and hard-earned. Visa processes drag, applications get rejected and re-submitted, and the new country imposes harsh adjustment — long separation from family, isolation, expensive struggles. Settlement happens eventually but the road is grinding.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 12); if (!l) return { matched: false };
      const lh = planetHouse(c, l);
      const satConj = planetHouse(c, 'Saturn') === lh;
      const satAsp = aspectsHouse(c, 'Saturn', lh);
      if (!satConj && !satAsp) return { matched: false };
      return { matched: true, intensity: 7, evidence: `12th lord ${l} ${satConj ? 'conjunct' : 'aspected by'} Saturn` };
    },
  },

  {
    id: 'fourth_lord_stronger_than_twelfth',
    domain: 'foreign',
    source: { book: 'Phaladeepika', chapter: 14, verse: '6' },
    note: 'When the 4th lord (home, motherland) is dignified and the 12th lord (foreign land) is weak, the native is pulled home. Going abroad doesn\'t stick — homesickness wins.',
    prediction: { polarity: 'negative', text: 'The pull toward home is stronger than the pull abroad. Foreign stints happen but don\'t last — homesickness, family obligations, or a deep cultural mismatch keep returning the native home. Lasting settlement abroad requires deliberate effort against natural inclination.', timeframe: 'lifetime' },
    predicate: (c) => {
      const fourL = lordOfHouse(c, 4); if (!fourL) return { matched: false };
      const twelveL = lordOfHouse(c, 12); if (!twelveL) return { matched: false };
      // Crude strength heuristic: dignity for 4L beats 12L's debility
      const fourStrong = isOwnSign(c, fourL) || isExalted(c, fourL);
      const twelveWeak = isDebilitated(c, twelveL) || isCombust(c, twelveL);
      if (!(fourStrong && twelveWeak)) return { matched: false };
      return { matched: true, intensity: 6, evidence: `4th lord ${fourL} dignified, 12th lord ${twelveL} weak` };
    },
  },

  {
    id: 'rahu_retrograde_in_twelfth',
    domain: 'foreign',
    source: { book: 'Saravali', chapter: 34, verse: '12' },
    note: 'Rahu is classically always retrograde, but its placement in 12th coupled with severe affliction (debilitated or with malefics) brings legal complications around foreign matters — visa scams, deportation risk, immigration disputes.',
    prediction: { polarity: 'negative', text: 'Foreign matters carry hidden legal complications. Visa or paperwork problems surface late, sometimes with unauthorized agents involved. Caution: classical reading specifically warns against shortcuts in foreign documentation — they tend to unravel badly.', timeframe: 'lifetime' },
    predicate: (c) => {
      if (planetHouse(c, 'Rahu') !== 12) return { matched: false };
      // Strengthened if Saturn or Ketu aspects, or Rahu in enemy sign
      const sign = planetSign(c, 'Rahu');
      const debil = ['Sagittarius', 'Scorpio'].includes(sign);
      const malAsp = aspectsHouse(c, 'Saturn', 12) || aspectsHouse(c, 'Mars', 12);
      if (!debil && !malAsp) return { matched: false };
      return { matched: true, intensity: 6, evidence: `Rahu in 12th${debil ? ' debilitated' : ''}${malAsp ? ' + malefic aspect' : ''}` };
    },
  },

  {
    id: 'ninth_lord_in_dusthana_foreign',
    domain: 'foreign',
    source: { book: 'BPHS', chapter: 43, verse: '21' },
    note: '9th lord (dharma, long journeys, fortune abroad) in 6/8/12 turns foreign aspirations into setbacks. The journey happens but doesn\'t deliver the expected fortune.',
    prediction: { polarity: 'negative', text: 'Long journeys for fortune don\'t quite pay off as planned. Foreign education or work abroad delivers less than promised — the degree is real but doesn\'t translate to a great job, or the move costs more (financially or emotionally) than the gain. Realistic expectations matter here.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 9); if (!l) return { matched: false };
      const h = planetHouse(c, l);
      if (![6, 8, 12].includes(h)) return { matched: false };
      return { matched: true, intensity: 6, evidence: `9th lord ${l} in dusthana (house ${h})` };
    },
  },
];
