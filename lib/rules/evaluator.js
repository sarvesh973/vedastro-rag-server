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

const REGISTRY = {
  marriage: marriageRules,
  // Future domains slot in here: career, wealth, health, children, etc.
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
  if (t.includes('health')) return 'health';
  if (t.includes('children') || t.includes('child') ||
      t.includes('conception')) return 'children';
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

module.exports = {
  evaluateDomain,
  topicToDomain,
  formatRulesForPrompt,
  REGISTRY,
};
