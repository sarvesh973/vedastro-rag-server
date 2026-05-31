// =========================================
// FAMILY RELATIONS — 18 classical rules
// =========================================
//
// Sources:
//   - BPHS Ch.46 (Matru — mother), Ch.47 (Pitru — father)
//   - BPHS Ch.48 (Bhratru — siblings)
//   - Phaladeepika Ch.16-18 (family houses)
//   - Saravali Ch.34 (worldly affairs in houses)
//
// House map:
//   - 3rd  = younger siblings, courage
//   - 4th  = MOTHER (also home, comforts)
//   - 9th  = FATHER (also fortune, dharma)
//   - 11th = elder siblings, friends
//   - 2nd  = extended family
//
// Karakas: Moon = mother, Sun = father, Mars = brothers, Mercury = relatives.

const {
  planetSign, planetHouse, lordOfHouse, planetsInHouse,
  isOwnSign, isExalted, isDebilitated, aspectsHouse,
  SIGN_LORD, MALEFICS,
} = require('./schema');

module.exports = [
  // ============== MOTHER ==============

  {
    id: 'fourth_lord_strong_mother',
    domain: 'family',
    source: { book: 'BPHS', chapter: 46, verse: '7' },
    prediction: { polarity: 'positive', text: 'Strong bond with mother. Maternal support and emotional foundation are reliable life-long resources.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 4); if (!l) return { matched: false };
      const dignified = isOwnSign(c, l) || isExalted(c, l);
      const wellPlaced = [1, 4, 5, 7, 9, 10].includes(planetHouse(c, l));
      if (!dignified && !wellPlaced) return { matched: false };
      return { matched: true, intensity: dignified ? 8 : 7, evidence: `4th lord ${l} ${dignified ? 'dignified' : 'well-placed'}` };
    },
  },
  {
    id: 'moon_strong_mother',
    domain: 'family',
    source: { book: 'BPHS', chapter: 46, verse: '12' },
    prediction: { polarity: 'positive', text: 'Moon (matru karaka) strong — mother\'s influence is benevolent, emotionally healthy. Mother\'s health typically good.', timeframe: 'lifetime' },
    predicate: (c) => {
      const dignified = isOwnSign(c, 'Moon') || isExalted(c, 'Moon');
      if (!dignified) return { matched: false };
      return { matched: true, intensity: 7, evidence: `Moon dignified (${planetSign(c, 'Moon')})` };
    },
  },
  {
    id: 'malefic_in_fourth_mother_concern',
    domain: 'family',
    source: { book: 'Phaladeepika', chapter: 16, verse: '14' },
    prediction: { polarity: 'negative', text: 'Malefics in 4th may indicate strain with mother, distance from home, or mother facing health challenges. Conscious effort needed to maintain bond.', timeframe: 'lifetime' },
    predicate: (c) => {
      const ms = planetsInHouse(c, 4).filter(p => MALEFICS.includes(p));
      if (ms.length === 0) return { matched: false };
      if (aspectsHouse(c, 'Jupiter', 4)) return { matched: true, cancelled: 'Jupiter aspect on 4th softens' };
      return { matched: true, intensity: 5, evidence: `Malefics in 4th: ${ms.join(', ')}` };
    },
  },
  {
    id: 'moon_debilitated_mother',
    domain: 'family',
    source: { book: 'BPHS', chapter: 46, verse: '18' },
    prediction: { polarity: 'negative', text: 'Moon debilitated — mother may have struggled emotionally; relationship complex. Healing through forgiveness practice often beneficial.', timeframe: 'lifetime' },
    predicate: (c) => isDebilitated(c, 'Moon')
      ? { matched: true, intensity: 5, evidence: 'Moon debilitated in Scorpio' }
      : { matched: false },
  },

  // ============== FATHER ==============

  {
    id: 'ninth_lord_strong_father',
    domain: 'family',
    source: { book: 'BPHS', chapter: 47, verse: '9' },
    prediction: { polarity: 'positive', text: 'Father is supportive and brings fortune to native\'s life. Father\'s blessings and guidance reliably available.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 9); if (!l) return { matched: false };
      const dignified = isOwnSign(c, l) || isExalted(c, l);
      const wellPlaced = [1, 4, 5, 7, 9, 10].includes(planetHouse(c, l));
      if (!dignified && !wellPlaced) return { matched: false };
      return { matched: true, intensity: dignified ? 8 : 7, evidence: `9th lord ${l} ${dignified ? 'dignified' : 'well-placed'}` };
    },
  },
  {
    id: 'sun_strong_father',
    domain: 'family',
    source: { book: 'BPHS', chapter: 47, verse: '14' },
    prediction: { polarity: 'positive', text: 'Sun (pitru karaka) strong — father is influential figure, respected, often in position of authority or wisdom.', timeframe: 'lifetime' },
    predicate: (c) => {
      const dignified = isOwnSign(c, 'Sun') || isExalted(c, 'Sun');
      const inKendraTrikona = [1, 4, 5, 9, 10].includes(planetHouse(c, 'Sun'));
      if (!dignified && !inKendraTrikona) return { matched: false };
      return { matched: true, intensity: dignified ? 8 : 6, evidence: `Sun ${dignified ? 'dignified' : 'in house ' + planetHouse(c, 'Sun')}` };
    },
  },
  {
    id: 'sun_debilitated_father',
    domain: 'family',
    source: { book: 'BPHS', chapter: 47, verse: '21' },
    prediction: { polarity: 'negative', text: 'Sun debilitated — relationship with father may have lacked warmth or authority; ego clashes possible. Healing through respect-building practices often advised.', timeframe: 'lifetime' },
    predicate: (c) => isDebilitated(c, 'Sun')
      ? { matched: true, intensity: 5, evidence: 'Sun debilitated in Libra' }
      : { matched: false },
  },
  {
    id: 'sun_in_dusthana_father',
    domain: 'family',
    source: { book: 'Phaladeepika', chapter: 17, verse: '11' },
    prediction: { polarity: 'negative', text: 'Sun in 6/8/12 — father may have been distant or faced challenges. Distance from father, either physical or emotional, common.', timeframe: 'lifetime' },
    predicate: (c) => {
      const h = planetHouse(c, 'Sun');
      if (![6, 8, 12].includes(h)) return { matched: false };
      return { matched: true, intensity: 5, evidence: `Sun in house ${h}` };
    },
  },

  // ============== SIBLINGS ==============

  {
    id: 'third_lord_strong_siblings',
    domain: 'family',
    source: { book: 'BPHS', chapter: 48, verse: '8' },
    prediction: { polarity: 'positive', text: 'Younger siblings are supportive. Generally close bond; siblings contribute to native\'s courage and confidence.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 3); if (!l) return { matched: false };
      const dignified = isOwnSign(c, l) || isExalted(c, l);
      const wellPlaced = [1, 3, 4, 5, 9, 10, 11].includes(planetHouse(c, l));
      if (!dignified && !wellPlaced) return { matched: false };
      return { matched: true, intensity: dignified ? 7 : 6, evidence: `3rd lord ${l} ${dignified ? 'dignified' : 'well-placed'}` };
    },
  },
  {
    id: 'mars_strong_brothers',
    domain: 'family',
    source: { book: 'BPHS', chapter: 48, verse: '12' },
    prediction: { polarity: 'positive', text: 'Mars (bhratri karaka) strong — courageous brothers, supportive male siblings. Often successful in physical/competitive fields.', timeframe: 'lifetime' },
    predicate: (c) => {
      const dignified = isOwnSign(c, 'Mars') || isExalted(c, 'Mars');
      if (!dignified) return { matched: false };
      return { matched: true, intensity: 6, evidence: `Mars dignified (${planetSign(c, 'Mars')})` };
    },
  },
  {
    id: 'eleventh_lord_strong_elder_siblings',
    domain: 'family',
    source: { book: 'BPHS', chapter: 41, verse: '32' },
    prediction: { polarity: 'positive', text: 'Strong 11th lord — elder siblings/friends supportive, often source of social capital and income opportunities.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 11); if (!l) return { matched: false };
      const dignified = isOwnSign(c, l) || isExalted(c, l);
      if (!dignified) return { matched: false };
      return { matched: true, intensity: 6, evidence: `11th lord ${l} dignified` };
    },
  },
  {
    id: 'malefic_third_younger_sibling_strain',
    domain: 'family',
    source: { book: 'Phaladeepika', chapter: 18, verse: '7' },
    prediction: { polarity: 'negative', text: 'Strain with younger siblings, or younger sibling may face challenges. Effort to maintain relationship recommended.', timeframe: 'lifetime' },
    predicate: (c) => {
      const malefics = planetsInHouse(c, 3).filter(p => MALEFICS.includes(p) && p !== 'Mars');
      // Mars in 3rd is actually good
      if (malefics.length === 0) return { matched: false };
      return { matched: true, intensity: 5, evidence: `Malefic(s) in 3rd: ${malefics.join(', ')}` };
    },
  },
  {
    id: 'mars_in_third_courage',
    domain: 'family',
    source: { book: 'BPHS', chapter: 48, verse: '18' },
    prediction: { polarity: 'positive', text: 'Mars in 3rd — exceptional courage, supportive male siblings, native often takes initiative for the family.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Mars') === 3
      ? { matched: true, intensity: 7, evidence: 'Mars in 3rd (excellent for siblings + valor)' }
      : { matched: false },
  },

  // ============== EXTENDED FAMILY / 2ND HOUSE ==============

  {
    id: 'second_house_strong_family',
    domain: 'family',
    source: { book: 'BPHS', chapter: 41, verse: '4' },
    prediction: { polarity: 'positive', text: 'Strong 2nd house — extended family ties strong. Family traditions, wealth, and values pass smoothly to native.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 2); if (!l) return { matched: false };
      const dignified = isOwnSign(c, l) || isExalted(c, l);
      if (!dignified) return { matched: false };
      return { matched: true, intensity: 6, evidence: `2nd lord ${l} dignified` };
    },
  },
  {
    id: 'jupiter_in_second_family',
    domain: 'family',
    source: { book: 'Phaladeepika', chapter: 13, verse: '8' },
    prediction: { polarity: 'positive', text: 'Jupiter in 2nd — family is ethically grounded and wisdom-oriented. Native enjoys respect from family circle.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Jupiter') === 2
      ? { matched: true, intensity: 7, evidence: 'Jupiter in 2nd house' }
      : { matched: false },
  },
  {
    id: 'venus_aspects_fourth_harmonious_home',
    domain: 'family',
    source: { book: 'Saravali', chapter: 34, verse: '14' },
    prediction: { polarity: 'positive', text: 'Venus aspect on 4th — harmonious home atmosphere. Family dynamics nurturing; comfort and beauty in domestic life.', timeframe: 'lifetime' },
    predicate: (c) => aspectsHouse(c, 'Venus', 4)
      ? { matched: true, intensity: 6, evidence: 'Venus aspects 4th house' }
      : { matched: false },
  },

  // ============== TIMING / CRITICAL TRIGGERS ==============

  {
    id: 'currently_in_mother_lord_dasha',
    domain: 'family',
    source: { book: 'BPHS', chapter: 51, verse: '24' },
    prediction: { polarity: 'mixed', text: 'Dasha of 4th lord or Moon — period of significant mother-related events. Could be quality time, mother\'s milestones, or health attention needed.', timeframe: 'currentDasha' },
    predicate: (c) => {
      const md = c.dasha && c.dasha.mahadasha;
      const ad = c.dasha && c.dasha.antardasha;
      const l4 = lordOfHouse(c, 4);
      const hits = [];
      if (md === 'Moon' || ad === 'Moon') hits.push('Moon');
      if (l4 && (md === l4 || ad === l4)) hits.push(`4L (${l4})`);
      if (hits.length === 0) return { matched: false };
      return { matched: true, intensity: 6, evidence: `Active: ${hits.join(', ')} (${md}/${ad})` };
    },
  },
  {
    id: 'currently_in_father_lord_dasha',
    domain: 'family',
    source: { book: 'BPHS', chapter: 51, verse: '25' },
    prediction: { polarity: 'mixed', text: 'Dasha of 9th lord or Sun — significant father-related period. Father\'s influence on life decisions heightened.', timeframe: 'currentDasha' },
    predicate: (c) => {
      const md = c.dasha && c.dasha.mahadasha;
      const ad = c.dasha && c.dasha.antardasha;
      const l9 = lordOfHouse(c, 9);
      const hits = [];
      if (md === 'Sun' || ad === 'Sun') hits.push('Sun');
      if (l9 && (md === l9 || ad === l9)) hits.push(`9L (${l9})`);
      if (hits.length === 0) return { matched: false };
      return { matched: true, intensity: 6, evidence: `Active: ${hits.join(', ')} (${md}/${ad})` };
    },
  },
];
