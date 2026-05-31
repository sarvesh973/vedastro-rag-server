// =========================================
// KARAKAS — Parashari 7-grade significator chain
// =========================================
//
// In Jaimini-style analysis (also adopted by Parashari astrologers),
// the 7 planets are ranked by their longitude WITHIN their current
// sign (degrees only, ignoring which sign they're in). The highest
// gets the strongest signification — the Atmakaraka — and the rest
// cascade down through specific life areas.
//
// 7 Karakas (Chara Karakas) in descending order of degree:
//   1. Atmakaraka  (AK) — the SOUL'S lesson this lifetime
//   2. Amatyakaraka (AmK) — career, profession, advisor figure
//   3. Bhratrukaraka (BK) — siblings, courage, efforts
//   4. Matrukaraka (MK) — mother, mind, emotional foundation
//   5. Putrakaraka (PuK) — children, intelligence, creativity
//   6. Gnatikaraka (GK) — extended relations, struggles, enemies
//   7. Darakaraka (DK) — spouse, partnerships
//
// Rahu's degree is COUNTED IN REVERSE (180 - longitude_in_sign) per
// Jaimini's convention. Ketu is excluded from karaka ranking.
//
// What the Atmakaraka tells us:
//   The AK planet signifies the BIGGEST karmic theme of this life.
//   Its sign + house + dignity + nakshatra reveal the soul's primary
//   lesson. e.g. Saturn AK = lesson is discipline, hard work,
//   responsibility. Venus AK = lesson is relationships, beauty,
//   diplomacy. Sun AK = lesson is leadership, ego, authority.
//
// The Darakaraka (DK) is critical for marriage analysis — the planet
// that signifies the spouse's nature, profession, appearance.
//
// Source: Jaimini Sutras Ch.1; BPHS Ch.32.

const ORDER = ['Atmakaraka', 'Amatyakaraka', 'Bhratrukaraka',
  'Matrukaraka', 'Putrakaraka', 'Gnatikaraka', 'Darakaraka'];

// Soul-lesson descriptions for each Atmakaraka planet — sourced from
// Sanjay Rath / Jaimini Sutras commentary. Concrete language we hand
// to the LLM so it doesn't have to invent these.
const AK_LESSONS = {
  Sun: 'Soul lesson is LEADERSHIP and SELF-EXPRESSION. The native is here to develop authentic ego, lead from the front, learn to wield authority without arrogance. Father-figure themes prominent.',
  Moon: 'Soul lesson is EMOTIONAL MASTERY and NURTURING. The native is here to develop emotional intelligence, learn to give care without losing self, master the mind. Mother-figure themes prominent.',
  Mars: 'Soul lesson is COURAGE and RIGHTEOUS ACTION. The native is here to learn when to fight, when to hold back, master energy without aggression. Sibling/competitor themes prominent.',
  Mercury: 'Soul lesson is COMMUNICATION and INTELLECT. The native is here to develop sharp thinking, learn to speak truth skillfully, master commerce or learning.',
  Jupiter: 'Soul lesson is WISDOM and DHARMA. The native is here to develop spiritual understanding, teach or guide others, walk the righteous path. Often becomes a counselor figure.',
  Venus: 'Soul lesson is RELATIONSHIPS and BEAUTY. The native is here to learn deep love, refine the senses, balance desire with detachment. Often artistic or in arts/luxury.',
  Saturn: 'Soul lesson is DISCIPLINE and RESPONSIBILITY. The native is here to learn patience, accept hardship as teacher, master long-term commitment. Often a late bloomer who achieves much through sustained effort.',
  Rahu: 'Soul lesson is BREAKING BOUNDARIES. The native is here to obsessively pursue worldly desires until exhausted, then transcend them. Often unconventional, foreign-element, hungry for experience.',
};

// Darakaraka spouse-nature descriptions — what kind of partner the DK
// planet typically indicates. From classical Jaimini commentary.
const DK_NATURES = {
  Sun: 'Spouse will be confident, leadership-oriented, somewhat dominant. May come from a respected family or hold authority.',
  Moon: 'Spouse will be emotionally nurturing, family-oriented, sensitive. Often beautiful, gentle, mother-figure type.',
  Mars: 'Spouse will be energetic, courageous, possibly assertive or argumentative. May be in technical/military/sports field.',
  Mercury: 'Spouse will be intelligent, witty, communicative. Often younger-looking, in business or media/teaching field.',
  Jupiter: 'Spouse will be wise, ethical, educated. Often from a religious or scholarly background. Older or more mature.',
  Venus: 'Spouse will be attractive, refined, artistic. Marriage tends toward harmony, luxury, sensual fulfillment.',
  Saturn: 'Spouse will be serious, disciplined, possibly older. Marriage may be delayed but stable and long-lasting.',
  Rahu: 'Spouse may be from a different culture, region, religion, or background. Unconventional partnership.',
};

// Extract the planet's degree WITHIN its sign (0-30).
// chart.planets[p] may have:
//   degree: 12  (already within-sign)
//   longitude: 132  (full 0-360)
function degreeInSign(chart, name) {
  const p = chart.planets && chart.planets[name];
  if (!p) return null;
  if (typeof p.degree === 'number' && p.degree < 30) return p.degree;
  if (typeof p.longitude === 'number') return p.longitude % 30;
  return null;
}

// Compute the 7 Chara Karakas using Parashari (7-karaka) scheme.
function computeKarakas(chart) {
  if (!chart || !chart.planets) return null;

  const candidates = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn'];
  const scored = [];
  for (const name of candidates) {
    const d = degreeInSign(chart, name);
    if (d == null) continue;
    scored.push({ planet: name, degree: d });
  }

  // Rahu's degree is reversed (30 - x) in Jaimini convention. We include
  // Rahu as an 8th candidate; if it outranks anyone, it bumps them down.
  // For the 7-karaka system we still only assign 7 roles; Rahu replaces
  // the planet it outranks.
  const rahuDeg = degreeInSign(chart, 'Rahu');
  if (rahuDeg != null) {
    scored.push({ planet: 'Rahu', degree: 30 - rahuDeg });
  }

  // Sort descending by degree
  scored.sort((a, b) => b.degree - a.degree);

  // First 7 become the karakas in order
  const result = {};
  ORDER.forEach((role, i) => {
    if (scored[i]) {
      result[role] = {
        planet: scored[i].planet,
        degree: Math.round(scored[i].degree * 100) / 100,
      };
    }
  });

  // Enrich Atmakaraka and Darakaraka with their classical descriptions
  if (result.Atmakaraka) {
    result.Atmakaraka.lesson = AK_LESSONS[result.Atmakaraka.planet] || '';
  }
  if (result.Darakaraka) {
    result.Darakaraka.spouseNature = DK_NATURES[result.Darakaraka.planet] || '';
  }

  return result;
}

module.exports = { computeKarakas, ORDER, AK_LESSONS, DK_NATURES };
