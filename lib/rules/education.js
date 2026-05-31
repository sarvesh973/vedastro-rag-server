// =========================================
// EDUCATION RULES — 20 classical rules
// =========================================
//
// Sources:
//   - BPHS Ch.44 (Vidya — knowledge), Ch.50 (4th house)
//   - Phaladeepika Ch.5 (4th house effects)
//   - Saravali Ch.30-34 (house effects)
//
// Three layers of education in Vedic astrology:
//   - 4th house = basic education, school years, foundational learning
//   - 5th house = intellect, applied knowledge, creativity, exam success
//   - 9th house = higher education, research, philosophy, PhD-level
//   - 2nd house = memory, retention, language
//
// Mercury is the universal Vidya karaka (knowledge significator).
// Jupiter karaka for wisdom, research, traditional/spiritual learning.

const {
  planetSign, planetHouse, lordOfHouse, planetsInHouse,
  isOwnSign, isExalted, isDebilitated, aspectsHouse, MALEFICS,
  dashaActive, dashaIntensity,
} = require('./schema');

module.exports = [
  {
    id: 'fourth_lord_strong_education',
    domain: 'education',
    source: { book: 'Phaladeepika', chapter: 5, verse: '12' },
    prediction: { polarity: 'positive', text: 'Strong foundational education. School years flow smoothly; building blocks of knowledge are well laid.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 4); if (!l) return { matched: false };
      const dignified = isOwnSign(c, l) || isExalted(c, l);
      const wellPlaced = [1, 4, 5, 7, 9, 10].includes(planetHouse(c, l));
      if (!dignified && !wellPlaced) return { matched: false };
      return { matched: true, intensity: dignified ? 8 : 7, evidence: `4th lord ${l} ${dignified ? 'dignified' : 'well-placed'}` };
    },
  },
  {
    id: 'mercury_strong_education',
    domain: 'education',
    source: { book: 'BPHS', chapter: 44, verse: '6' },
    prediction: { polarity: 'positive', text: 'Mercury (vidya karaka) strong — sharp intellect, quick learning, good with languages and analytics.', timeframe: 'lifetime' },
    predicate: (c) => {
      const dignified = isOwnSign(c, 'Mercury') || isExalted(c, 'Mercury');
      const h = planetHouse(c, 'Mercury');
      const wellPlaced = [1, 2, 4, 5, 9, 10, 11].includes(h);
      if (!dignified && !wellPlaced) return { matched: false };
      return { matched: true, intensity: dignified ? 8 : 6, evidence: `Mercury ${dignified ? 'dignified' : 'in house ' + h}` };
    },
  },
  {
    id: 'jupiter_aspects_fourth_or_fifth',
    domain: 'education',
    source: { book: 'BPHS', chapter: 44, verse: '11' },
    prediction: { polarity: 'positive', text: 'Jupiter\'s aspect on education houses — wisdom-oriented learning, good teachers naturally appear, ethical approach to study.', timeframe: 'lifetime' },
    predicate: (c) => {
      const a4 = aspectsHouse(c, 'Jupiter', 4);
      const a5 = aspectsHouse(c, 'Jupiter', 5);
      if (!a4 && !a5) return { matched: false };
      return { matched: true, intensity: a4 && a5 ? 8 : 6, evidence: `Jupiter aspects ${a4 && a5 ? '4th and 5th' : a4 ? '4th' : '5th'}` };
    },
  },
  {
    id: 'fifth_house_strong',
    domain: 'education',
    source: { book: 'BPHS', chapter: 81, verse: '8' },
    prediction: { polarity: 'positive', text: 'Strong 5th house — exam success, applied intelligence, ability to retain and reproduce learning under pressure.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 5); if (!l) return { matched: false };
      if (!isOwnSign(c, l) && !isExalted(c, l) && ![1, 4, 5, 9, 10].includes(planetHouse(c, l))) return { matched: false };
      return { matched: true, intensity: 7, evidence: `5th lord ${l} well-placed (house ${planetHouse(c, l)})` };
    },
  },
  {
    id: 'budhaditya_education',
    domain: 'education',
    source: { book: 'Phaladeepika', chapter: 5, verse: '18' },
    prediction: { polarity: 'positive', text: 'Sun + Mercury conjunction — academic recognition, intellectual visibility. Often top of class, public-speaking talent.', timeframe: 'lifetime' },
    predicate: (c) => {
      const sun = planetSign(c, 'Sun'); const merc = planetSign(c, 'Mercury');
      if (!sun || !merc || sun !== merc) return { matched: false };
      return { matched: true, intensity: 7, evidence: `Sun + Mercury conjunct in ${sun}` };
    },
  },
  {
    id: 'ninth_lord_strong_higher_education',
    domain: 'education',
    source: { book: 'Phaladeepika', chapter: 8, verse: '14' },
    prediction: { polarity: 'positive', text: 'Strong 9th house — higher education indications. PhD, postgraduate study, research, or studying abroad all favoured.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 9); if (!l) return { matched: false };
      if (!isOwnSign(c, l) && !isExalted(c, l) && ![1, 4, 5, 9, 10, 11].includes(planetHouse(c, l))) return { matched: false };
      return { matched: true, intensity: 7, evidence: `9th lord ${l} well-placed` };
    },
  },
  {
    id: 'saraswati_yoga_education',
    domain: 'education',
    source: { book: 'BPHS', chapter: 36, verse: '39' },
    prediction: { polarity: 'positive', text: 'Saraswati Yoga conditions — exceptional scholarship potential. Multi-subject mastery, intellectual fame.', timeframe: 'lifetime' },
    predicate: (c) => {
      for (const p of ['Mercury', 'Jupiter', 'Venus']) {
        if (![1, 2, 4, 5, 7, 9, 10].includes(planetHouse(c, p))) return { matched: false };
      }
      return { matched: true, intensity: 9, evidence: 'Mercury+Jupiter+Venus all in kendra/trikona/2nd (Saraswati Yoga)' };
    },
  },
  {
    id: 'second_house_strong_memory',
    domain: 'education',
    source: { book: 'BPHS', chapter: 50, verse: '4' },
    prediction: { polarity: 'positive', text: 'Strong 2nd house — excellent memory and retention. Good at memorisation-heavy subjects (law, medicine, history).', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 2); if (!l) return { matched: false };
      if (!isOwnSign(c, l) && !isExalted(c, l)) return { matched: false };
      return { matched: true, intensity: 7, evidence: `2nd lord ${l} dignified (${planetSign(c, l)})` };
    },
  },
  {
    id: 'fourth_lord_in_dusthana_education',
    domain: 'education',
    source: { book: 'Phaladeepika', chapter: 5, verse: '17' },
    prediction: { polarity: 'negative', text: 'Disruptions in basic education. School transfers, changes in environment, or non-traditional learning path likely.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 4); if (!l) return { matched: false };
      const h = planetHouse(c, l);
      if (![6, 8, 12].includes(h)) return { matched: false };
      return { matched: true, intensity: 6, evidence: `4th lord ${l} in dusthana (house ${h})` };
    },
  },
  {
    id: 'mercury_combust_education',
    domain: 'education',
    source: { book: 'BPHS', chapter: 44, verse: '15' },
    prediction: { polarity: 'negative', text: 'Mercury combust — intellectual self-doubt, exam anxiety. Ability is there but recognition lags. Confidence-building rituals advised.', timeframe: 'lifetime' },
    predicate: (c) => {
      const m = c.planets && c.planets.Mercury;
      const s = c.planets && c.planets.Sun;
      if (!m || !s || typeof m.longitude !== 'number' || typeof s.longitude !== 'number') return { matched: false };
      const diff = Math.min(Math.abs(m.longitude - s.longitude), 360 - Math.abs(m.longitude - s.longitude));
      if (diff > 12) return { matched: false };
      return { matched: true, intensity: 5, evidence: `Mercury combust (${diff.toFixed(1)}° from Sun)` };
    },
  },
  {
    id: 'jupiter_in_fourth',
    domain: 'education',
    source: { book: 'Saravali', chapter: 32, verse: '7' },
    prediction: { polarity: 'positive', text: 'Jupiter in 4th — natural inclination toward formal learning. Often becomes a teacher, mentor, or wisdom-keeper later in life.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Jupiter') === 4
      ? { matched: true, intensity: 7, evidence: 'Jupiter in 4th (natural Dig Bala)' }
      : { matched: false },
  },
  {
    id: 'mercury_in_lagna',
    domain: 'education',
    source: { book: 'Saravali', chapter: 30, verse: '8' },
    prediction: { polarity: 'positive', text: 'Mercury in lagna — agile mind, quick learner, articulate. Communication and writing flow naturally.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Mercury') === 1
      ? { matched: true, intensity: 6, evidence: 'Mercury in 1st house' }
      : { matched: false },
  },
  {
    id: 'mercury_jupiter_aspect_education',
    domain: 'education',
    source: { book: 'BPHS', chapter: 44, verse: '21' },
    prediction: { polarity: 'positive', text: 'Mercury-Jupiter mutual influence — refined intellect, wisdom and analysis combined. Excellent for academia, law, philosophy.', timeframe: 'lifetime' },
    predicate: (c) => {
      const mh = planetHouse(c, 'Mercury'); const jh = planetHouse(c, 'Jupiter');
      if (mh < 0 || jh < 0) return { matched: false };
      // Mercury aspects Mercury's sign (7th); Jupiter aspects 5/7/9
      const merMer = planetSign(c, 'Mercury') === planetSign(c, 'Jupiter');
      const rel = ((jh - mh + 12) % 12) + 1;
      const aspect = merMer || rel === 5 || rel === 7 || rel === 9;
      if (!aspect) return { matched: false };
      return { matched: true, intensity: 7, evidence: merMer ? 'Mercury+Jupiter conjunct' : `Jupiter aspects Mercury (rel ${rel})` };
    },
  },
  {
    id: 'currently_in_mercury_dasha_education',
    domain: 'education',
    source: { book: 'BPHS', chapter: 51, verse: '17' },
    prediction: { polarity: 'positive', text: 'Mercury active in dasha — peak intellectual period. Best time for new learning, exams, certifications, language acquisition.', timeframe: 'currentDasha' },
    predicate: (c) => {
      const layer = dashaActive(c, 'Mercury');
      if (!layer) return { matched: false };
      return { matched: true, intensity: dashaIntensity(layer) - 1, evidence: `Mercury active at ${layer} level` };
    },
  },
  {
    id: 'currently_in_jupiter_dasha_education',
    domain: 'education',
    source: { book: 'BPHS', chapter: 51, verse: '11' },
    prediction: { polarity: 'positive', text: 'Jupiter active in dasha — favourable period for higher learning, returning to study, philosophical/spiritual research.', timeframe: 'currentDasha' },
    predicate: (c) => {
      const layer = dashaActive(c, 'Jupiter');
      if (!layer) return { matched: false };
      return { matched: true, intensity: dashaIntensity(layer) - 1, evidence: `Jupiter active at ${layer} level` };
    },
  },
  {
    id: 'malefics_in_fourth',
    domain: 'education',
    source: { book: 'Phaladeepika', chapter: 5, verse: '19' },
    prediction: { polarity: 'negative', text: 'Malefics in 4th — disrupted school environment. May indicate study despite difficult circumstances; resilience builds character.', timeframe: 'lifetime' },
    predicate: (c) => {
      const ms = planetsInHouse(c, 4).filter(p => MALEFICS.includes(p));
      if (ms.length === 0) return { matched: false };
      if (aspectsHouse(c, 'Jupiter', 4)) return { matched: true, cancelled: 'Jupiter aspects 4th — mitigates' };
      return { matched: true, intensity: 5, evidence: `Malefics in 4th: ${ms.join(', ')}` };
    },
  },
  {
    id: 'fifth_lord_in_dusthana_exams',
    domain: 'education',
    source: { book: 'BPHS', chapter: 81, verse: '20' },
    prediction: { polarity: 'negative', text: 'Exam anxiety or repeated attempts may be needed. Persistence rewarded; first try not always successful.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 5); if (!l) return { matched: false };
      if (![6, 8, 12].includes(planetHouse(c, l))) return { matched: false };
      return { matched: true, intensity: 6, evidence: `5th lord ${l} in dusthana ${planetHouse(c, l)}` };
    },
  },
  {
    id: 'rahu_in_fourth_unconventional_learning',
    domain: 'education',
    source: { book: 'BPHS', chapter: 50, verse: '24' },
    prediction: { polarity: 'mixed', text: 'Rahu in 4th — unconventional education path. Online learning, foreign study, self-taught, or studying outside traditional system.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Rahu') === 4
      ? { matched: true, intensity: 6, evidence: 'Rahu in 4th' }
      : { matched: false },
  },
  {
    id: 'venus_fifth_arts_education',
    domain: 'education',
    source: { book: 'Saravali', chapter: 31, verse: '12' },
    prediction: { polarity: 'positive', text: 'Venus in 5th — talent in arts, music, design, performance. Education leaning toward creative subjects naturally favoured.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Venus') === 5
      ? { matched: true, intensity: 6, evidence: 'Venus in 5th' }
      : { matched: false },
  },
  {
    id: 'ketu_in_education_house_research',
    domain: 'education',
    source: { book: 'BPHS', chapter: 81, verse: '27' },
    prediction: { polarity: 'mixed', text: 'Ketu in 4th, 5th, or 9th — research-oriented mind, deep-diving into niche subjects. Sometimes feels education is "given" rather than acquired.', timeframe: 'lifetime' },
    predicate: (c) => {
      const h = planetHouse(c, 'Ketu');
      if (![4, 5, 9].includes(h)) return { matched: false };
      return { matched: true, intensity: 5, evidence: `Ketu in house ${h}` };
    },
  },
];
