// =========================================
// SPIRITUALITY RULES — 16 classical rules
// =========================================
//
// Sources:
//   - BPHS Ch.43 (9th house — dharma), Ch.55 (12th house — moksha)
//   - BPHS Ch.59 (Sanyasa Yogas — renunciation)
//   - Phaladeepika Ch.8 (9th), Ch.21 (12th)
//   - Saravali Ch.20 (Combinations for Renunciation)
//
// Houses:
//   - 9th  = dharma, religious philosophy, righteousness, guru
//   - 12th = moksha (liberation), retreat, contemplation
//   - 5th  = mantra, meditation, devotion (purva punya = past-life merit)
//   - 8th  = occult, mysticism, transformative experiences
// Karakas: Jupiter = guru/wisdom; Ketu = detachment/moksha; Saturn = discipline.

const {
  planetSign, planetHouse, lordOfHouse, planetsInHouse,
  isOwnSign, isExalted, isDebilitated, isRetrograde, isCombust, aspectsHouse,
  MALEFICS,
  dashaActive, dashaIntensity,
} = require('./schema');

module.exports = [
  {
    id: 'ninth_lord_strong_dharma',
    domain: 'spirituality',
    source: { book: 'BPHS', chapter: 43, verse: '8' },
    prediction: { polarity: 'positive', text: 'Strong 9th house — natural dharmic orientation. Religious or philosophical inclinations form early; teachers and gurus appear easily.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 9); if (!l) return { matched: false };
      const dignified = isOwnSign(c, l) || isExalted(c, l);
      const wellPlaced = [1, 4, 5, 9, 10].includes(planetHouse(c, l));
      if (!dignified && !wellPlaced) return { matched: false };
      return { matched: true, intensity: dignified ? 8 : 6, evidence: `9th lord ${l} ${dignified ? 'dignified' : 'well-placed'}` };
    },
  },
  {
    id: 'jupiter_in_ninth_guru',
    domain: 'spirituality',
    source: { book: 'Phaladeepika', chapter: 8, verse: '7' },
    prediction: { polarity: 'positive', text: 'Jupiter (guru karaka) in dharma-house — strong philosophical wisdom develops naturally. Often becomes a teacher or counselor figure.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Jupiter') === 9
      ? { matched: true, intensity: 8, evidence: 'Jupiter in 9th (guru karaka in dharma house)' }
      : { matched: false },
  },
  {
    id: 'ketu_strong_moksha',
    domain: 'spirituality',
    source: { book: 'BPHS', chapter: 55, verse: '17' },
    prediction: { polarity: 'positive', text: 'Strong Ketu — soul-level pull toward moksha (liberation). Detachment comes naturally; material attachments loosen with time.', timeframe: 'lifetime' },
    predicate: (c) => {
      const h = planetHouse(c, 'Ketu');
      if (![1, 9, 12].includes(h)) return { matched: false };
      return { matched: true, intensity: 7, evidence: `Ketu in ${h === 1 ? 'lagna' : 'house ' + h}` };
    },
  },
  {
    id: 'twelfth_lord_strong_moksha',
    domain: 'spirituality',
    source: { book: 'BPHS', chapter: 55, verse: '11' },
    prediction: { polarity: 'positive', text: '12th-lord strong — capacity for retreat, contemplation, and ultimate moksha. Often drawn to monastic or pilgrim experiences.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 12); if (!l) return { matched: false };
      const dignified = isOwnSign(c, l) || isExalted(c, l);
      if (!dignified) return { matched: false };
      return { matched: true, intensity: 7, evidence: `12th lord ${l} dignified` };
    },
  },
  {
    id: 'sanyasa_yoga_renunciation',
    domain: 'spirituality',
    source: { book: 'Saravali', chapter: 20, verse: '3' },
    note: 'Classical Sanyasa Yoga: 4+ planets in same sign, with strongest being the renunciation indicator.',
    prediction: { polarity: 'positive', text: 'Sanyasa Yoga indicated — strong renunciation tendency. May not literally leave the world but lives a notably simple/detached life.', timeframe: 'lifetime' },
    predicate: (c) => {
      const signCounts = {};
      for (const p of ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']) {
        const s = planetSign(c, p);
        if (s) signCounts[s] = (signCounts[s] || 0) + 1;
      }
      const max = Math.max(...Object.values(signCounts));
      if (max < 4) return { matched: false };
      const sign = Object.entries(signCounts).find(([_, v]) => v === max)[0];
      return { matched: true, intensity: 7, evidence: `${max} planets conjunct in ${sign}` };
    },
  },
  {
    id: 'fifth_house_devotion',
    domain: 'spirituality',
    source: { book: 'BPHS', chapter: 81, verse: '5' },
    prediction: { polarity: 'positive', text: '5th house (purva punya = past-life merit) strong — natural devotion, mantra practice, ritual easily becomes second nature.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 5); if (!l) return { matched: false };
      const dignified = isOwnSign(c, l) || isExalted(c, l);
      if (!dignified) return { matched: false };
      return { matched: true, intensity: 6, evidence: `5th lord ${l} dignified (purva punya signal)` };
    },
  },
  {
    id: 'currently_in_jupiter_dasha_spiritual',
    domain: 'spirituality',
    source: { book: 'BPHS', chapter: 51, verse: '11' },
    prediction: { polarity: 'positive', text: 'Jupiter active in dasha — spiritual growth period. Drawn toward higher teachings, often a guru figure enters life.', timeframe: 'currentDasha' },
    predicate: (c) => {
      const layer = dashaActive(c, 'Jupiter');
      if (!layer) return { matched: false };
      return { matched: true, intensity: dashaIntensity(layer) - 1, evidence: `Jupiter active at ${layer} level` };
    },
  },
  {
    id: 'currently_in_ketu_dasha_detachment',
    domain: 'spirituality',
    source: { book: 'BPHS', chapter: 51, verse: '20' },
    prediction: { polarity: 'mixed', text: 'Ketu active in dasha — material detachment period. Worldly ambitions feel hollow; pull toward solitude, meditation, philosophical questioning intensifies.', timeframe: 'currentDasha' },
    predicate: (c) => {
      const layer = dashaActive(c, 'Ketu');
      if (!layer) return { matched: false };
      return { matched: true, intensity: dashaIntensity(layer), evidence: `Ketu active at ${layer} level` };
    },
  },
  {
    id: 'eighth_house_occult',
    domain: 'spirituality',
    source: { book: 'BPHS', chapter: 54, verse: '14' },
    prediction: { polarity: 'mixed', text: 'Strong 8th house — interest in occult, mysticism, hidden knowledge. Tantric practices, energy work, and esoteric study fascinate.', timeframe: 'lifetime' },
    predicate: (c) => {
      const planets = planetsInHouse(c, 8);
      if (planets.length < 2) return { matched: false };
      return { matched: true, intensity: 6, evidence: `${planets.length} planets in 8th: ${planets.join(', ')}` };
    },
  },
  {
    id: 'saturn_aspect_ninth_disciplined_dharma',
    domain: 'spirituality',
    source: { book: 'Phaladeepika', chapter: 8, verse: '18' },
    prediction: { polarity: 'mixed', text: 'Saturn\'s aspect on 9th — slow, disciplined approach to spirituality. Yoga, sustained practice, monastic-style commitment over decades.', timeframe: 'lifetime' },
    predicate: (c) => aspectsHouse(c, 'Saturn', 9)
      ? { matched: true, intensity: 6, evidence: 'Saturn aspects 9th' }
      : { matched: false },
  },
  {
    id: 'jupiter_ketu_conjunction_guru_chandala',
    domain: 'spirituality',
    source: { book: 'BPHS', chapter: 36, verse: '54' },
    note: 'Jupiter-Ketu conjunction = "Guru Chandala Yoga" — complex spiritual life.',
    prediction: { polarity: 'mixed', text: 'Jupiter-Ketu conjunction (Guru Chandala) — intense spiritual seeker but often discontent with traditional teachings. Tends toward DIY spirituality or rebellion against orthodoxy.', timeframe: 'lifetime' },
    predicate: (c) => {
      const js = planetSign(c, 'Jupiter');
      const ks = planetSign(c, 'Ketu');
      if (!js || !ks || js !== ks) return { matched: false };
      return { matched: true, intensity: 7, evidence: `Jupiter + Ketu conjunct in ${js}` };
    },
  },
  {
    id: 'no_spiritual_indicators',
    domain: 'spirituality',
    source: { book: 'BPHS', chapter: 43, verse: '29' },
    prediction: { polarity: 'neutral', text: 'Chart shows modest spiritual indicators — worldly orientation dominates. Spirituality can develop later via life experience rather than innate pull.', timeframe: 'lifetime' },
    predicate: (c) => {
      const j9 = planetHouse(c, 'Jupiter') === 9;
      const ketuStrong = [1, 9, 12].includes(planetHouse(c, 'Ketu'));
      const l9 = lordOfHouse(c, 9);
      const l9Strong = l9 && (isOwnSign(c, l9) || isExalted(c, l9));
      if (j9 || ketuStrong || l9Strong) return { matched: false };
      return { matched: true, intensity: 3, evidence: 'No strong dharma/moksha signals' };
    },
  },
  {
    id: 'ninth_lord_in_twelfth_pilgrimage',
    domain: 'spirituality',
    source: { book: 'BPHS', chapter: 43, verse: '21' },
    prediction: { polarity: 'positive', text: '9th lord in 12th — pilgrimage and retreat are key spiritual paths. Often draws to foreign spiritual traditions or ashram-style retreats.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 9); if (!l) return { matched: false };
      if (planetHouse(c, l) !== 12) return { matched: false };
      return { matched: true, intensity: 7, evidence: `9th lord ${l} in 12th` };
    },
  },
  {
    id: 'twelfth_lord_in_ninth_dharmic_retreat',
    domain: 'spirituality',
    source: { book: 'Phaladeepika', chapter: 21, verse: '12' },
    prediction: { polarity: 'positive', text: '12th lord in 9th — moksha through dharma. Retreats, fasting, donations, and pilgrimages produce inner growth.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 12); if (!l) return { matched: false };
      if (planetHouse(c, l) !== 9) return { matched: false };
      return { matched: true, intensity: 7, evidence: `12th lord ${l} in 9th` };
    },
  },
  {
    id: 'venus_in_twelfth_spiritual_arts',
    domain: 'spirituality',
    source: { book: 'Saravali', chapter: 32, verse: '25' },
    prediction: { polarity: 'mixed', text: 'Venus in 12th — bhakti (devotional) path may resonate. Music, art, beauty become forms of spiritual practice.', timeframe: 'lifetime' },
    predicate: (c) => planetHouse(c, 'Venus') === 12
      ? { matched: true, intensity: 6, evidence: 'Venus in 12th' }
      : { matched: false },
  },
  {
    id: 'mahapurusha_in_kendra_spiritual_force',
    domain: 'spirituality',
    source: { book: 'BPHS', chapter: 37 },
    prediction: { polarity: 'positive', text: 'Mahapurusha planet in kendra — soul carries significant spiritual force. Practice tends to crystallize and manifest tangible inner shifts.', timeframe: 'lifetime' },
    predicate: (c) => {
      const hits = [];
      for (const p of ['Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']) {
        const h = planetHouse(c, p);
        if ([1, 4, 7, 10].includes(h) && (isOwnSign(c, p) || isExalted(c, p))) hits.push(p);
      }
      if (hits.length === 0) return { matched: false };
      return { matched: true, intensity: 7, evidence: `Mahapurusha-eligible planets: ${hits.join(', ')}` };
    },
  },

  // ============== EXPANDED NEGATIVES (polarity-balance audit) ==============
  // Spirituality had 10 positive rules and ZERO negative rules. Real
  // charts show genuine spiritual crisis configurations — broken faith,
  // dharma confusion, sceptic phase. Adding 4 negatives so honest
  // readings can name these patterns when they're present.

  {
    id: 'ninth_lord_in_dusthana_dharma_break',
    domain: 'spirituality',
    source: { book: 'BPHS', chapter: 43, verse: '19' },
    note: '9th lord (dharma, traditional path, guru-link) in 6/8/12 breaks the inherited religious framework. Native questions, rebels against, or sees through the family\'s tradition.',
    prediction: { polarity: 'negative', text: 'The inherited religious or spiritual path doesn\'t hold. There is a real break with the family tradition — questioning, rebellion, or simply finding the old framework empty. Authentic dharma has to be built from scratch, not received. This often feels like loss before it feels like freedom.', timeframe: 'lifetime' },
    predicate: (c) => {
      const l = lordOfHouse(c, 9); if (!l) return { matched: false };
      const h = planetHouse(c, l);
      if (![6, 8, 12].includes(h)) return { matched: false };
      return { matched: true, intensity: 7, evidence: `9th lord ${l} in dusthana (house ${h})` };
    },
  },

  {
    id: 'ketu_combust_or_afflicted',
    domain: 'spirituality',
    source: { book: 'Phaladeepika', chapter: 21, verse: '14' },
    note: 'Ketu carries the karaka of moksha and detachment. When afflicted by Sun (combust effectively) or under heavy malefic aspect, the detachment instinct turns into confusion and cynicism rather than wisdom.',
    prediction: { polarity: 'negative', text: 'The detachment instinct misfires. What should mature into wisdom and renunciation becomes cynicism, spiritual confusion, or chronic skepticism about meaning itself. The work is to befriend doubt, not eliminate it — that path eventually opens into real understanding.', timeframe: 'lifetime' },
    predicate: (c) => {
      const ketu = c.planets && c.planets.Ketu;
      const sun = c.planets && c.planets.Sun;
      if (!ketu || !sun) return { matched: false };
      // Conjunction within ~10° of Sun behaves like combust for shadow planets
      if (typeof ketu.longitude !== 'number' || typeof sun.longitude !== 'number') {
        return { matched: false };
      }
      let diff = Math.abs(ketu.longitude - sun.longitude) % 360;
      if (diff > 180) diff = 360 - diff;
      const conjSun = diff <= 10;
      const ketuH = planetHouse(c, 'Ketu');
      const malAsp = aspectsHouse(c, 'Saturn', ketuH) || aspectsHouse(c, 'Mars', ketuH);
      if (!conjSun && !malAsp) return { matched: false };
      return { matched: true, intensity: 6, evidence: `Ketu ${conjSun ? `conjunct Sun (${diff.toFixed(1)}°)` : 'aspected by malefic'}` };
    },
  },

  {
    id: 'saturn_aspect_jupiter_doubt',
    domain: 'spirituality',
    source: { book: 'Saravali', chapter: 20, verse: '7' },
    note: 'Saturn aspecting Jupiter is the classical "Guru Chandala" variant via aspect — discipline and tradition compete with wisdom. Faith faces sustained testing.',
    prediction: { polarity: 'negative', text: 'Faith and wisdom are under sustained pressure from skepticism and discipline. Belief doesn\'t come easily — every spiritual claim has to earn its place against doubt. The result, after years of friction, is genuinely tested faith rather than inherited belief. Easy spirituality is not available on this chart.', timeframe: 'lifetime' },
    predicate: (c) => {
      const jupH = planetHouse(c, 'Jupiter');
      if (jupH < 1) return { matched: false };
      if (!aspectsHouse(c, 'Saturn', jupH)) return { matched: false };
      // Conjunction is even stronger
      const conj = planetHouse(c, 'Saturn') === jupH;
      return { matched: true, intensity: conj ? 7 : 6, evidence: `Saturn ${conj ? 'conjunct' : 'aspects'} Jupiter in house ${jupH}` };
    },
  },

  {
    id: 'multiple_malefics_on_ninth',
    domain: 'spirituality',
    source: { book: 'BPHS', chapter: 43, verse: '24' },
    note: 'Two or more malefics afflicting the 9th house (occupying or aspecting without benefic relief) disturb the dharma karaka — faith feels under siege.',
    prediction: { polarity: 'negative', text: 'The faith-bearing 9th house is heavily afflicted. Belief feels under attack — through circumstances, relationships, or sustained intellectual challenge. Many natives go through a long sceptic phase. The classical guidance is patience: the affliction tests, it does not destroy.', timeframe: 'lifetime' },
    predicate: (c) => {
      const occ = planetsInHouse(c, 9).filter(p => MALEFICS.includes(p));
      const aspectors = ['Sun', 'Mars', 'Saturn', 'Rahu', 'Ketu'].filter(p => aspectsHouse(c, p, 9));
      const totalMalefic = new Set([...occ, ...aspectors]).size;
      if (totalMalefic < 2) return { matched: false };
      // Jupiter aspect or Jupiter in 9th cancels
      if (aspectsHouse(c, 'Jupiter', 9)) return { matched: false };
      return { matched: true, intensity: 7, evidence: `${totalMalefic} malefics affecting 9th house` };
    },
  },
];
