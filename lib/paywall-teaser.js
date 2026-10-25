// A one-line, chart-grounded teaser for the free-tier chat paywall.
//
// WHY THIS EXISTS. When a free user's single lifetime chat is spent, /chat
// returns 429 and the app deletes the question they just typed, restores
// the text to the input box, and shows a list of prices. The highest-intent
// moment in the product — someone has just asked their chart a real
// question — produced nothing at all.
//
// Compare the compat screen, which gives away the score, both archetypes
// and all eight kutas and locks only the prose. That pattern already works
// here; chat was the one surface not using it.
//
// WHY IT IS FREE TO PRODUCE. No LLM call. Everything below is read off the
// already-computed chart: which house the question's topic runs through,
// which planet rules that house, and what sits in it. The chart itself is
// pure local computation. So this reveals something true and specific about
// the person's own chart without spending a Gemini call on a user who has
// not paid, which is what makes it safe to show on every blocked request.
//
// WHAT IT DELIBERATELY DOES NOT DO. It does not interpret. It states
// placements and stops. A teaser that guessed at meaning would either be
// wrong — this is exactly where the corpus and the LLM earn their keep —
// or it would be the reading, given away. Naming the house and its lord is
// verifiable, feels specific because it IS specific to them, and leaves the
// interpretation on the other side of the paywall.

/** Topic -> the houses that govern it. Mirrors TOPIC_TIMING in index.js. */
const TOPIC_HOUSES = [
  { re: /marriage|relationship|romance|spouse/, houses: [7], label: 'Marriage and partnership' },
  { re: /career|job|business|promotion|profession/, houses: [10], label: 'Career and work' },
  { re: /finance|wealth|money|dhan/, houses: [2, 11], label: 'Money and gains' },
  { re: /child|conception|progeny|santan/, houses: [5], label: 'Children' },
  { re: /health|illness|disease/, houses: [6], label: 'Health' },
  { re: /foreign|abroad|settle|videsh/, houses: [12], label: 'Travel and settling abroad' },
  { re: /education|exam|study|learning/, houses: [4], label: 'Study and exams' },
  { re: /property|home|vehicle/, houses: [4], label: 'Property and home' },
  { re: /spiritual|moksha|dharma/, houses: [9], label: 'Spiritual life' },
  { re: /family|mother|father|parent|sibling/, houses: [4], label: 'Family' },
  { re: /litigation|enemy|dispute|legal/, houses: [6], label: 'Disputes' },
  { re: /longevity|lifespan/, houses: [8], label: 'Longevity' },
  { re: /personality|nature|character/, houses: [1], label: 'Your temperament' },
];

/**
 * Topics that identify no house of their own. 'timing' and 'general' are
 * about WHEN or about everything, and 'remedies' is an answer type rather
 * than a subject — picking a house for any of them would be inventing a
 * connection the chart does not make.
 */
const UNGROUNDED_TOPICS = new Set(['timing', 'general', 'remedies']);

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "Mars", "Mars and Saturn", "Mars, Saturn and Venus" */
function joinNames(names) {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * @param {object} args
 * @param {object} args.chart     calculateChart() output.
 * @param {string[]} args.topics  detectQuestionTopics() output.
 * @returns {{line: string, topic: string, house: number}|null}
 *   null whenever a true, specific line cannot be produced — a vague one
 *   is worse than none, because it reads as a horoscope-app platitude and
 *   undermines the claim that the paid reading is grounded in their chart.
 */
function buildTeaser({ chart, topics }) {
  if (!chart || !chart.planets) return null;
  if (!Array.isArray(topics) || topics.length === 0) return null;

  // First topic that maps to a house. detectQuestionTopics returns them in
  // its own fixed order, not by relevance, so 'timing' frequently rides
  // along with the real subject ("when will I marry") and must not win.
  let map = null;
  let topic = null;
  for (const t of topics) {
    if (UNGROUNDED_TOPICS.has(t)) continue;
    const found = TOPIC_HOUSES.find(m => m.re.test(t));
    if (found) { map = found; topic = t; break; }
  }
  if (!map) return null;

  const house = map.houses[0];
  const lords = (chart.dasha && chart.dasha.houseLords) || [];
  const lord = lords[house - 1] || null;

  // Planets sitting in that house, from the planet summary.
  const occupants = Object.entries(chart.planets)
    .filter(([, p]) => p && p.house === house)
    .map(([name]) => name);

  const where = `your ${ordinal(house)} house`;

  let line;
  if (occupants.length > 0) {
    const sign = chart.planets[occupants[0]].sign;
    const verb = occupants.length === 1 ? 'sits' : 'sit';
    line = `${map.label} runs through ${where}, where ${joinNames(occupants)} ${verb}`;
    if (sign) line += ` in ${sign}`;
    line += lord ? `, under ${lord}.` : '.';
  } else if (lord) {
    const lordPlacement = chart.planets[lord];
    line = `${map.label} runs through ${where}, which no planet occupies. `
      + `Its lord is ${lord}`;
    if (lordPlacement && typeof lordPlacement.house === 'number') {
      line += `, sitting in your ${ordinal(lordPlacement.house)} house`;
    }
    line += '.';
  } else {
    // No occupants and no lord resolved: nothing specific left to say.
    return null;
  }

  return { line, topic, house };
}

module.exports = {
  buildTeaser,
  ordinal,
  joinNames,
  TOPIC_HOUSES,
  UNGROUNDED_TOPICS,
};
