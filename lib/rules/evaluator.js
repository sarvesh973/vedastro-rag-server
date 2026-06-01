// =========================================
// RULE EVALUATOR
// =========================================
//
// Given a chart + question domain, returns the top N matched
// classical rules ranked by intensity. The chat endpoint passes the
// matched list to the LLM with strict instructions to PRESENT them
// (not invent new predictions).
//
// A rule is "cancelled" when:
//   - its own predicate returns { matched: true, cancelled: 'reason' }
//   - another rule in the cancellations[] list of THIS rule fires
//
// Cancellation handling is centralised here so rule files stay focused
// on detection logic.

const marriageRules = require('./marriage');
const careerRules = require('./career');
const wealthRules = require('./wealth');
const healthRules = require('./health');
const childrenRules = require('./children');
const educationRules = require('./education');
const foreignRules = require('./foreign');
const familyRules = require('./family');
const spiritualityRules = require('./spirituality');
const nakshatraRules = require('./nakshatra');

const REGISTRY = {
  marriage: marriageRules,
  career: careerRules,
  wealth: wealthRules,
  health: healthRules,
  children: childrenRules,
  education: educationRules,
  foreign: foreignRules,
  family: familyRules,
  spirituality: spiritualityRules,
  // Nakshatra rules describe the native's intrinsic pattern (janma
  // nakshatra character + key planet placements). They don't bind to a
  // single question topic, so /chat evaluates this domain ALWAYS in
  // addition to the topic-routed domain (see `evaluateNakshatra` below).
  nakshatra: nakshatraRules,
};

/**
 * Run all rules for a domain against a chart.
 *
 * @param {object} chart   the calculated chart (with .planets, .ascendant, etc.)
 * @param {string} domain  'marriage' | 'career' | ...
 * @param {object} [opts]
 * @param {number} [opts.topN=6]      how many matched rules to return
 * @param {number} [opts.minIntensity=3]  drop matches below this
 * @returns {Array<object>}  matched rules with evidence + source
 */
function evaluateDomain(chart, domain, opts = {}) {
  const { topN = 6, minIntensity = 3 } = opts;
  const rules = REGISTRY[domain];
  if (!rules || !Array.isArray(rules)) return [];

  const matched = [];
  const cancellations = new Set();

  for (const rule of rules) {
    let result;
    try {
      result = rule.predicate(chart);
    } catch (e) {
      continue; // bad chart data — skip this rule silently
    }
    if (!result || !result.matched) continue;
    // If this rule was self-cancelled (e.g. Mangal Dosha cancelled by
    // Saturn aspect), surface it as evidence but don't include in
    // matched output.
    if (result.cancelled) {
      cancellations.add(rule.id);
      continue;
    }
    const intensity = typeof result.intensity === 'number' ? result.intensity : 5;
    if (intensity < minIntensity) continue;
    matched.push({
      id: rule.id,
      domain: rule.domain,
      source: rule.source,
      polarity: rule.prediction.polarity,
      timeframe: rule.prediction.timeframe,
      text: rule.prediction.text,
      evidence: result.evidence || '',
      intensity,
      note: rule.note || '',
    });
  }

  matched.sort((a, b) => b.intensity - a.intensity);
  return matched.slice(0, topN);
}

/**
 * Map a topic string (from LLM classifier) to a rule domain. Allows
 * fuzzy matching — 'marriage_timing', 'marriage_partner', 'romance'
 * all map to 'marriage' until we add more granular rule files.
 */
function topicToDomain(topic) {
  if (!topic) return null;
  const t = String(topic).toLowerCase();
  if (t.includes('marriage') || t.includes('spouse') ||
      t === 'relationship' || t === 'romance') return 'marriage';
  if (t.includes('career') || t.includes('job') ||
      t.includes('profession') || t.includes('promotion')) return 'career';
  if (t.includes('wealth') || t.includes('finance') ||
      t.includes('money') || t.includes('property')) return 'wealth';
  if (t.includes('health') || t.includes('illness') ||
      t.includes('disease') || t.includes('mental')) return 'health';
  if (t.includes('children') || t.includes('child') ||
      t.includes('conception') || t.includes('pregnan')) return 'children';
  if (t.includes('education') || t.includes('study') ||
      t.includes('exam') || t.includes('school') ||
      t.includes('college') || t.includes('learn')) return 'education';
  if (t.includes('foreign') || t.includes('abroad') ||
      t.includes('overseas') || t.includes('visa') ||
      t.includes('migration') || t.includes('relocat')) return 'foreign';
  if (t.includes('family') || t.includes('mother') ||
      t.includes('father') || t.includes('parent') ||
      t.includes('sibling') || t.includes('brother') ||
      t.includes('sister')) return 'family';
  if (t.includes('spiritual') || t.includes('moksha') ||
      t.includes('dharma') || t.includes('guru') ||
      t.includes('meditation') || t.includes('religion') ||
      t.includes('god')) return 'spirituality';
  return null;
}

/**
 * Format matched rules into a prompt block the LLM can directly
 * cite. Lays them out in source-attribution form.
 */
function formatRulesForPrompt(matched) {
  if (!matched || matched.length === 0) return '';
  let text = `\n\nMATCHED CLASSICAL RULES (cite these as fact, ranked by intensity):`;
  matched.forEach((m, i) => {
    const src = `${m.source.book} Ch.${m.source.chapter}${m.source.verse ? '.' + m.source.verse : ''}`;
    const polarity = {
      positive: '✓',
      negative: '⚠',
      neutral: '·',
      mixed: '~',
    }[m.polarity] || '·';
    text += `\n${i + 1}. [${polarity} ${m.polarity}, intensity ${m.intensity}/10] ${m.text}`;
    text += `\n   Source: ${src} | Rule ID: ${m.id}`;
    if (m.evidence) text += `\n   Evidence in chart: ${m.evidence}`;
    if (m.note) text += `\n   Note: ${m.note}`;
  });
  text += `\n\nCRITICAL: Frame your answer AROUND these matched rules. Do not invent`;
  text += `\npredictions that aren't grounded in matched rules or the chart facts above.`;
  text += `\nWhen citing, mention the book name naturally (e.g. "Phaladeepika notes that…").`;
  text += `\nIf only weak rules matched, acknowledge the chart doesn't show strong signals`;
  text += `\non this topic rather than fabricating certainty.`;
  return text;
}

/**
 * Convenience wrapper: always-on nakshatra evaluation. Returns the top N
 * nakshatra rules that match. Called by /chat alongside the topic-specific
 * domain so every reply has native-character anchors (the LLM gets to
 * weave them into whatever topic the user asked about).
 */
function evaluateNakshatra(chart, opts = {}) {
  const { topN = 3, minIntensity = 5 } = opts;
  return evaluateDomain(chart, 'nakshatra', { topN, minIntensity });
}

module.exports = {
  evaluateDomain,
  evaluateNakshatra,
  topicToDomain,
  formatRulesForPrompt,
  REGISTRY,
};
