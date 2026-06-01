// =========================================
// NAKSHATRA RULES — Janma Nakshatra + key planet placements
// =========================================
//
// Encoded from:
//   - Saravali Ch.7-8 (nakshatra-character chapters)
//   - Phaladeepika Ch.4 (Moon in each nakshatra)
//   - Brihat Parashara Hora Shastra Ch.11 (nakshatra natures)
//
// THIS DOMAIN ALWAYS RUNS — nakshatra describes the native's intrinsic
// pattern (personality, life path, soul archetype). It's not tied to a
// topic query, so /chat evaluates it alongside the topic-specific
// domain instead of routing to it via topicToDomain.
//
// Why this exists: real-user feedback flagged that the engine treated
// nakshatras as decorative metadata when classical sources treat them
// as a first-class predictive signal. The 27 janma-nakshatra rules give
// the LLM concrete native-character anchors instead of pure house+lord
// reasoning.

const { dashaActive, dashaIntensity } = require('./schema');

// 27 nakshatra → archetypal traits, condensed from Saravali Ch.7-8.
// Each entry: [polarity, intensity, text, note]
// text  : what to predict about the native
// note  : terse classical anchor for the LLM
const JANMA_TRAITS = {
  Ashwini: ['positive', 7,
    'Swift, healing nature. Pioneering, athletic, restless. Quick to start ventures and quick to act on instinct.',
    'Ruled by Ashwini Kumars, the divine physicians.'],
  Bharani: ['mixed', 7,
    'Intense, transformative path. Carries heavy responsibility. Self-disciplined, learns through endurance.',
    'Ruled by Yama; nakshatra of restraint and accountability.'],
  Krittika: ['mixed', 8,
    'Sharp, ambitious, critical. Cutting intelligence and leadership. Can be harsh in speech.',
    'Ruled by Agni; the cutting flame.'],
  Rohini: ['positive', 9,
    'Magnetic, attractive, sensual. Strong taste for beauty and material comfort. Steady and fertile.',
    "Moon's exaltation nakshatra; the most fruitful star."],
  Mrigashira: ['positive', 6,
    'Curious, seeking, gentle. Restless searcher of meaning and connection. Can lack decisiveness.',
    'Ruled by Soma; nakshatra of the seeking deer.'],
  Ardra: ['mixed', 7,
    'Stormy emotional intensity. Research-minded; breakthroughs come after struggle and tears.',
    'Ruled by Rudra; nakshatra of the storm and the cleansing tear.'],
  Punarvasu: ['positive', 8,
    'Optimistic, philosophical, returns to roots after wandering. Generous teacher nature.',
    "Ruled by Aditi; nakshatra of return and renewal."],
  Pushya: ['positive', 9,
    'Nurturing, devotional, conservative. Brings prosperity and stability. Most auspicious nakshatra.',
    'Ruled by Brihaspati; the most auspicious of all nakshatras.'],
  Ashlesha: ['negative', 8,
    'Penetrating insight, secretive, hypnotic. Risk of manipulation or self-deception. Powerful intuition.',
    'Ruled by the Nagas; the serpent-coil nakshatra.'],
  Magha: ['positive', 8,
    'Royal demeanor, ancestral pride, natural leadership. Drawn to tradition and lineage.',
    'Ruled by the Pitris (ancestors); the throne nakshatra.'],
  PurvaPhalguni: ['positive', 7,
    'Pleasure-loving, romantic, creative. Marriage and artistic enjoyment favored.',
    'Ruled by Bhaga; nakshatra of love and good fortune.'],
  UttaraPhalguni: ['positive', 8,
    'Helpful, generous, organized. Friendship and contracts go well; reliable partner energy.',
    'Ruled by Aryaman; nakshatra of pacts and patronage.'],
  Hasta: ['positive', 8,
    'Skillful hands, clever, witty. Excellent at crafts, healing, and detail work.',
    'Ruled by Savitar; nakshatra of skilled hands.'],
  Chitra: ['mixed', 7,
    'Charismatic, artistic, glamorous. Beauty may mask illusion. Drawn to design and architecture.',
    'Ruled by Tvashtar, the divine architect.'],
  Swati: ['positive', 7,
    'Independent, diplomatic, restless. Strong business instinct; thrives in trade and movement.',
    'Ruled by Vayu; nakshatra of the independent wind.'],
  Vishakha: ['positive', 8,
    'Goal-oriented, intense focus, achievement-driven. Burns long for chosen objectives.',
    'Ruled by Indra-Agni; nakshatra of the forked, focused fire.'],
  Anuradha: ['positive', 8,
    'Friendly, devoted, succeeds through cooperation and community. Loyal partnerships.',
    'Ruled by Mitra; nakshatra of friendship and devotion.'],
  Jyeshtha: ['mixed', 7,
    'Senior responsibility, protective, hides inner struggles. Elder-child or burdened-leader pattern.',
    'Ruled by Indra; nakshatra of the eldest and the secret burden.'],
  Mula: ['negative', 8,
    'Investigative, philosophical. Harsh or uprooted beginnings, but the soul moves toward liberation.',
    'Ruled by Nirriti; nakshatra of the root and dissolution.'],
  PurvaAshadha: ['positive', 7,
    'Invincibility, popularity, debate. Strong public persona; wins arguments.',
    'Ruled by Apas; nakshatra of unconquerable waters.'],
  UttaraAshadha: ['positive', 9,
    'Enduring success, ethical leadership. Late-life accomplishment; integrity is the engine.',
    'Ruled by the Vishvadevas; nakshatra of lasting victory.'],
  Shravana: ['positive', 8,
    'Listening, learning, fame through knowledge. Teachers, scholars, broadcasters.',
    'Ruled by Vishnu; nakshatra of sacred hearing.'],
  Dhanishta: ['positive', 7,
    'Wealthy, musical, ambitious. Rhythm-driven; strong drive for status and resources.',
    'Ruled by the eight Vasus; nakshatra of rhythm and wealth.'],
  Shatabhisha: ['mixed', 7,
    'Healer, mystical, secretive, eccentric. Drawn to hidden knowledge and unconventional paths.',
    "Ruled by Varuna; the hundred-physicians nakshatra."],
  PurvaBhadrapada: ['mixed', 7,
    'Intense, transformative, dark wisdom. Penetrates taboos and shadow material.',
    'Ruled by Aja Ekapad; nakshatra of fierce austerity.'],
  UttaraBhadrapada: ['positive', 8,
    'Deep wisdom, kundalini, oceanic depth. Calm exterior over profound inner life.',
    'Ruled by Ahir Budhnya; the deep-serpent nakshatra.'],
  Revati: ['positive', 8,
    'Compassionate, completes cycles, safe-journey energy. Wise, gentle, soulful.',
    'Ruled by Pushan; nakshatra of safe passage.'],
};

// Lookup tolerates name variations: "Purva Phalguni", "PurvaPhalguni",
// "Poorva Phalguni", "P.Phalguni" — all should resolve to PurvaPhalguni.
function normalizeNakshatra(raw) {
  if (!raw) return null;
  const cleaned = String(raw)
    .replace(/[\s\-\.]/g, '')
    .replace(/^Poorva/i, 'Purva')
    .replace(/^Pratham/i, 'Purva')
    .toLowerCase();
  for (const key of Object.keys(JANMA_TRAITS)) {
    if (key.toLowerCase() === cleaned) return key;
  }
  // partial match for "U.Phalguni" etc.
  for (const key of Object.keys(JANMA_TRAITS)) {
    if (cleaned.includes(key.toLowerCase())) return key;
  }
  return null;
}

// Nakshatra → ruling planet (used for planet-in-own-nakshatra rules).
const NAK_LORD = {
  Ashwini: 'Ketu', Magha: 'Ketu', Mula: 'Ketu',
  Bharani: 'Venus', PurvaPhalguni: 'Venus', PurvaAshadha: 'Venus',
  Krittika: 'Sun', UttaraPhalguni: 'Sun', UttaraAshadha: 'Sun',
  Rohini: 'Moon', Hasta: 'Moon', Shravana: 'Moon',
  Mrigashira: 'Mars', Chitra: 'Mars', Dhanishta: 'Mars',
  Ardra: 'Rahu', Swati: 'Rahu', Shatabhisha: 'Rahu',
  Punarvasu: 'Jupiter', Vishakha: 'Jupiter', PurvaBhadrapada: 'Jupiter',
  Pushya: 'Saturn', Anuradha: 'Saturn', UttaraBhadrapada: 'Saturn',
  Ashlesha: 'Mercury', Jyeshtha: 'Mercury', Revati: 'Mercury',
};

// Gandanta = the last 3°20' of a water sign / first 3°20' of a fire sign.
// In nakshatra terms: junctions of Revati-Ashwini, Ashlesha-Magha,
// Jyeshtha-Mula. Moon here is classically considered sensitive — emotional
// turbulence, karmic crossings.
const GANDANTA_PAIRS = new Set([
  'Revati-Ashwini', 'Ashlesha-Magha', 'Jyeshtha-Mula',
]);

function isGandantaMoon(chart) {
  const m = chart.planets && chart.planets.Moon;
  if (!m) return false;
  const nak = normalizeNakshatra(m.nakshatra);
  if (!nak) return false;
  // Use longitude: if Moon is within 3°20' of nakshatra boundary that's
  // gandanta-adjacent. Without the degree we approximate: just flag if
  // the Moon's nakshatra is one of the gandanta pair members AND
  // longitude (if available) is near the boundary.
  if (typeof m.longitude !== 'number') return false;
  const segment = 360 / 27; // 13°20'
  const inNakDeg = m.longitude % segment;
  // Near the start (first 3°20') of a fire-sign nakshatra OR end (last
  // 3°20') of a water-sign nakshatra.
  const nearStart = inNakDeg < 3.333;
  const nearEnd = inNakDeg > segment - 3.333;
  if (nak === 'Ashwini' && nearStart) return true;
  if (nak === 'Magha' && nearStart) return true;
  if (nak === 'Mula' && nearStart) return true;
  if (nak === 'Revati' && nearEnd) return true;
  if (nak === 'Ashlesha' && nearEnd) return true;
  if (nak === 'Jyeshtha' && nearEnd) return true;
  return false;
}

// Build the 27 janma-nakshatra character rules programmatically.
const characterRules = Object.entries(JANMA_TRAITS).map(
  ([nak, [polarity, intensity, text, note]]) => ({
    id: `janma_nakshatra_${nak.toLowerCase()}`,
    domain: 'nakshatra',
    source: { book: 'Saravali', chapter: 7, verse: nak },
    note,
    prediction: {
      polarity,
      text,
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      const moon = c.planets && c.planets.Moon;
      if (!moon) return { matched: false };
      const norm = normalizeNakshatra(moon.nakshatra);
      if (norm !== nak) return { matched: false };
      return {
        matched: true,
        intensity,
        evidence: `Janma nakshatra is ${nak} (Moon in ${moon.nakshatra}).`,
      };
    },
  }),
);

const planetPlacementRules = [
  // Moon in own nakshatra ruler's nakshatra (e.g. Moon in Rohini — Moon's
  // own nakshatra). Considered very strong placement.
  {
    id: 'moon_in_own_nakshatra',
    domain: 'nakshatra',
    source: { book: 'Phaladeepika', chapter: 4, verse: 'Moon' },
    note: "Moon in its own ruled nakshatra (Rohini/Hasta/Shravana) is among the strongest lunar placements.",
    prediction: {
      polarity: 'positive',
      text: 'Exceptionally stable mind, strong emotional foundation, magnetic personality. The Moon delivers its full effect here.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      const moon = c.planets && c.planets.Moon;
      if (!moon) return { matched: false };
      const nak = normalizeNakshatra(moon.nakshatra);
      if (!nak) return { matched: false };
      if (NAK_LORD[nak] !== 'Moon') return { matched: false };
      return {
        matched: true,
        intensity: 9,
        evidence: `Moon in ${nak}, ruled by Moon itself.`,
      };
    },
  },

  // Sun in a royal/solar nakshatra (Magha, U.Phalguni, U.Ashadha — Sun's
  // own nakshatra group). Strong leadership and dignity.
  {
    id: 'sun_in_solar_nakshatra',
    domain: 'nakshatra',
    source: { book: 'BPHS', chapter: 11, verse: 'Sun' },
    note: "Sun in Krittika/U.Phalguni/U.Ashadha (its own nakshatras) or Magha (royal nakshatra) intensifies leadership and dignity.",
    prediction: {
      polarity: 'positive',
      text: 'Natural authority, leadership posture, dignified self-expression. Father / boss / institutional figures support the native.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      const sun = c.planets && c.planets.Sun;
      if (!sun) return { matched: false };
      const nak = normalizeNakshatra(sun.nakshatra);
      if (!nak) return { matched: false };
      const solar = nak === 'Krittika' || nak === 'UttaraPhalguni' ||
        nak === 'UttaraAshadha' || nak === 'Magha';
      if (!solar) return { matched: false };
      return {
        matched: true,
        intensity: 8,
        evidence: `Sun in ${nak}.`,
      };
    },
  },

  // Lagna lord in a benefic-ruled nakshatra (Jupiter/Mercury/Venus/Moon)
  // — life-path runs smoothly.
  {
    id: 'lagna_lord_in_benefic_nakshatra',
    domain: 'nakshatra',
    source: { book: 'BPHS', chapter: 11, verse: 'Lagnesha' },
    note: 'Lagnesha placed in a nakshatra ruled by a benefic carries the native through life on benefic energy.',
    prediction: {
      polarity: 'positive',
      text: 'Life path is supported by benefic forces. Doors open at the right time; setbacks resolve without lasting damage.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      const lord = c.ascendant && c.ascendant.lord;
      if (!lord) return { matched: false };
      const p = c.planets && c.planets[lord];
      if (!p) return { matched: false };
      const nak = normalizeNakshatra(p.nakshatra);
      if (!nak) return { matched: false };
      const ruler = NAK_LORD[nak];
      const benefics = ['Jupiter', 'Mercury', 'Venus', 'Moon'];
      if (!benefics.includes(ruler)) return { matched: false };
      return {
        matched: true,
        intensity: 7,
        evidence: `Ascendant lord ${lord} in ${nak} (ruled by ${ruler}).`,
      };
    },
  },

  // Gandanta Moon — classical caution flag.
  {
    id: 'moon_gandanta',
    domain: 'nakshatra',
    source: { book: 'BPHS', chapter: 11, verse: 'Gandanta' },
    note: 'Moon at gandanta (water-fire sign junction) is classically considered karmically sensitive — emotional turbulence, early-life difficulty.',
    prediction: {
      polarity: 'negative',
      text: 'Emotional sensitivity and early-life turbulence are likely. The mind faces karmic crossings that, when navigated, deepen wisdom.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      if (!isGandantaMoon(c)) return { matched: false };
      return {
        matched: true,
        intensity: 6,
        evidence: `Moon at gandanta (junction of water-fire sign / sensitive nakshatra boundary).`,
      };
    },
  },

  // Dasha lord in a malefic-ruled nakshatra (Mars/Saturn/Rahu/Ketu).
  // Current dasha will play out through the malefic theme.
  {
    id: 'dasha_lord_in_malefic_nakshatra',
    domain: 'nakshatra',
    source: { book: 'Phaladeepika', chapter: 4, verse: 'Dasha' },
    note: 'The dasha lord delivers its results through its nakshatra ruler. A malefic-ruled nakshatra colors the period with friction.',
    prediction: {
      polarity: 'mixed',
      text: 'The current dasha plays out through friction, effort, or sudden shifts. Results come, but the road is not smooth.',
      timeframe: 'currentDasha',
    },
    predicate: (c) => {
      if (!c.dasha || !c.dasha.mahadasha) return { matched: false };
      const dlord = c.dasha.mahadasha;
      const p = c.planets && c.planets[dlord];
      if (!p) return { matched: false };
      const nak = normalizeNakshatra(p.nakshatra);
      if (!nak) return { matched: false };
      const ruler = NAK_LORD[nak];
      const malefics = ['Mars', 'Saturn', 'Rahu', 'Ketu'];
      if (!malefics.includes(ruler)) return { matched: false };
      const layer = dashaActive(c, dlord) || 'maha';
      return {
        matched: true,
        intensity: dashaIntensity(layer),
        evidence: `Mahadasha lord ${dlord} in ${nak} (ruled by ${ruler}).`,
      };
    },
  },
];

module.exports = [...characterRules, ...planetPlacementRules];

// Helpers exported for tests / debug.
module.exports.JANMA_TRAITS = JANMA_TRAITS;
module.exports.NAK_LORD = NAK_LORD;
module.exports.normalizeNakshatra = normalizeNakshatra;
