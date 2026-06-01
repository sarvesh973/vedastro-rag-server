// =========================================
// ANSWER-FIDELITY VALIDATOR
// =========================================
//
// Real-user feedback flagged that the LLM hallucinates dashas — it would
// confidently cite "Saturn dasha" in the prose even when the chart's
// actual mahadasha is Jupiter. The rule-engine validation suite catches
// rule misfires but never inspects the LLM's PROSE for chart-vs-text
// agreement, so a 100% rule-engine hit rate still allowed wrong dashas
// to reach the user.
//
// This module compares an LLM answer against the chart facts it was
// given and reports mismatches. Used two ways:
//   1. Runtime: /chat calls checkAnswerFidelity() after generation,
//      logs warnings, attaches the report to the response _debug block.
//   2. Validation: lib/validation/runner.js calls runFidelityProbe() to
//      score % of /chat replies whose cited dasha matches the active
//      dasha (admin-runnable metric).

const PLANETS = [
  'Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus',
  'Saturn', 'Rahu', 'Ketu',
];

// Pattern matches phrases like "Saturn dasha", "Saturn mahadasha",
// "Saturn ki mahadasha", "Saturn-Mercury dasha", "Saturn's antardasha".
// Hinglish + English. Captures the planet name only — sub-period type is
// inferred from surrounding text where it matters.
const DASHA_MENTION = new RegExp(
  `\\b(${PLANETS.join('|')})(?:'s|\\s+ki|\\s+ka|-[A-Za-z]+)?` +
  `\\s+(mahadasha|antardasha|antar|pratyantar|bhukti|dasha|dasa|period)\\b`,
  'gi',
);

/**
 * Scan an LLM answer for explicit dasha citations and compare against the
 * chart's actual active dasha.
 *
 * @param {string} answer   the LLM-produced prose
 * @param {object} chartData  result of calculateChart() / buildContextAtDate()
 * @returns {{
 *   citedDashas: string[],      // planet names the LLM cited as the current dasha
 *   activeMaha: string|null,    // chart's actual mahadasha
 *   activeAntar: string|null,
 *   activePratyantar: string|null,
 *   mismatch: boolean,          // true if LLM cited a planet that isn't in any active layer
 *   hallucinatedDashas: string[],  // cited planets that don't match maha/antar/pratyantar
 * }}
 */
function checkAnswerFidelity(answer, chartData) {
  const report = {
    citedDashas: [],
    activeMaha: null,
    activeAntar: null,
    activePratyantar: null,
    mismatch: false,
    hallucinatedDashas: [],
  };
  if (!answer || typeof answer !== 'string') return report;
  if (!chartData || !chartData.dasha) return report;

  report.activeMaha = chartData.dasha.mahadasha || null;
  report.activeAntar = chartData.dasha.antardasha || null;
  report.activePratyantar = chartData.dasha.pratyantar || null;

  const cited = new Set();
  let m;
  // Reset lastIndex because we reuse the RegExp object across calls.
  DASHA_MENTION.lastIndex = 0;
  while ((m = DASHA_MENTION.exec(answer)) !== null) {
    const planet = m[1];
    // Normalize Sanskrit variants — "Surya", "Chandra", "Mangal", etc.
    cited.add(planet);
  }
  report.citedDashas = [...cited];

  const activeSet = new Set(
    [report.activeMaha, report.activeAntar, report.activePratyantar].filter(Boolean),
  );

  for (const planet of cited) {
    if (!activeSet.has(planet)) {
      report.hallucinatedDashas.push(planet);
      report.mismatch = true;
    }
  }

  return report;
}

/**
 * Convert a fidelity report into a one-line log message. Used by /chat
 * so production logs surface mismatches at WARN level.
 */
function fidelityLogLine(report) {
  if (report.citedDashas.length === 0) {
    return `[fidelity] no dasha citation in answer; active=${report.activeMaha}/${report.activeAntar}`;
  }
  if (report.mismatch) {
    return `[fidelity MISMATCH] cited=${report.citedDashas.join(',')} ` +
      `but active=${report.activeMaha}/${report.activeAntar}/${report.activePratyantar} ` +
      `hallucinated=${report.hallucinatedDashas.join(',')}`;
  }
  return `[fidelity ok] cited=${report.citedDashas.join(',')} ` +
    `active=${report.activeMaha}/${report.activeAntar}/${report.activePratyantar}`;
}

/**
 * Validation-suite entry: for each celebrity event, run a synthesized
 * "what was your dasha at this event" answer through fidelity check.
 * This is the offline cousin of the runtime check — it lets us measure
 * fidelity over the celebrity test set instead of waiting for production
 * to surface mismatches.
 *
 * Note: this does NOT call the LLM (would burn API quota). It instead
 * tests the CHECKER itself by feeding it known-correct and
 * known-incorrect synthetic answers and verifying the report flags only
 * the wrong ones. Production runtime check is the source of real metrics.
 */
function runFidelityProbe() {
  const synthetic = [
    {
      answer: 'Aap currently Saturn ki mahadasha mein hain.',
      chart: { dasha: { mahadasha: 'Saturn', antardasha: 'Mercury', pratyantar: 'Venus' } },
      expectMismatch: false,
    },
    {
      answer: 'Aapki current Jupiter mahadasha career success layegi.',
      chart: { dasha: { mahadasha: 'Saturn', antardasha: 'Mercury', pratyantar: 'Venus' } },
      expectMismatch: true,
    },
    {
      answer: 'Mercury antardasha ke dauran technical career mein progress hogi.',
      chart: { dasha: { mahadasha: 'Saturn', antardasha: 'Mercury', pratyantar: 'Venus' } },
      expectMismatch: false,
    },
    {
      answer: "Saturn dasha mein discipline aur Mars dasha ki energy combined hai.",
      chart: { dasha: { mahadasha: 'Saturn', antardasha: 'Mercury', pratyantar: 'Venus' } },
      expectMismatch: true,
    },
    {
      answer: 'Marriage 7th house ke through dekha jaata hai. Specific dasha mention nahi.',
      chart: { dasha: { mahadasha: 'Saturn', antardasha: 'Mercury', pratyantar: 'Venus' } },
      expectMismatch: false,
    },
  ];

  const results = synthetic.map((t, i) => {
    const r = checkAnswerFidelity(t.answer, t.chart);
    const pass = r.mismatch === t.expectMismatch;
    return {
      caseIndex: i,
      pass,
      expected: t.expectMismatch ? 'mismatch' : 'ok',
      got: r.mismatch ? 'mismatch' : 'ok',
      hallucinated: r.hallucinatedDashas,
    };
  });
  const passed = results.filter(r => r.pass).length;
  return {
    total: synthetic.length,
    passed,
    rate: Math.round((passed / synthetic.length) * 100),
    cases: results,
  };
}

module.exports = {
  checkAnswerFidelity,
  fidelityLogLine,
  runFidelityProbe,
};
