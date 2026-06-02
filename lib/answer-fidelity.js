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

const SIGNS_EN = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
];

// Sanskrit ↔ English sign-name map. LLM often writes Mesha / Karka / Tula etc.
const SIGN_ALIAS = {
  Mesha: 'Aries', Vrishabha: 'Taurus', Mithuna: 'Gemini', Karka: 'Cancer',
  Karkata: 'Cancer', Simha: 'Leo', Kanya: 'Virgo', Tula: 'Libra',
  Vrishchika: 'Scorpio', Vrischika: 'Scorpio', Dhanu: 'Sagittarius',
  Dhanus: 'Sagittarius', Makara: 'Capricorn', Makar: 'Capricorn',
  Kumbha: 'Aquarius', Meena: 'Pisces', Min: 'Pisces',
};

function normalizeSign(name) {
  if (!name) return null;
  const cap = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
  if (SIGNS_EN.includes(cap)) return cap;
  if (SIGN_ALIAS[cap]) return SIGN_ALIAS[cap];
  return null;
}

// Pull just the English sign out of a chart-provided rashiName which can
// look like "Karka (Cancer)", "Cancer", or "Karka".
function extractSign(rashiName) {
  if (!rashiName) return null;
  const m = String(rashiName).match(/\(([^)]+)\)/);
  const candidate = m ? m[1] : rashiName;
  return normalizeSign(candidate.trim().split(/\s+/)[0]);
}

// Pattern matches phrases like "Saturn dasha", "Saturn mahadasha",
// "Saturn ki mahadasha", "Saturn-Mercury dasha", "Saturn's antardasha".
// Hinglish + English. Captures the planet name only — sub-period type is
// inferred from surrounding text where it matters.
const DASHA_MENTION = new RegExp(
  `\\b(${PLANETS.join('|')})(?:'s|\\s+ki|\\s+ka|-[A-Za-z]+)?` +
  `\\s+(mahadasha|antardasha|antar|pratyantar|bhukti|dasha|dasa|period)\\b`,
  'gi',
);

// "Mars in the 5th house", "Mars in 5th house", "Mars is in 8th house"
const PLANET_HOUSE_MENTION = new RegExp(
  `\\b(${PLANETS.join('|')})\\s+(?:is\\s+)?(?:placed\\s+)?(?:in|sits\\s+in)\\s+` +
  `(?:the\\s+)?(\\d+)(?:st|nd|rd|th)\\s+house\\b`,
  'gi',
);

// "Jupiter in Cancer", "Jupiter is in Karka", "Sun placed in Leo"
const PLANET_SIGN_MENTION = new RegExp(
  `\\b(${PLANETS.join('|')})\\s+(?:is\\s+)?(?:placed\\s+)?in\\s+` +
  `(${[...SIGNS_EN, ...Object.keys(SIGN_ALIAS)].join('|')})\\b`,
  'gi',
);

// Common yoga names. The chart's yogas[] is populated by detectAllYogas().
const KNOWN_YOGAS = [
  'Gajakesari', 'Ruchaka', 'Bhadra', 'Hamsa', 'Malavya', 'Sasha',
  'Pancha Mahapurusha', 'Vipreet Rajayoga', 'Vipreet Raja',
  'Raja Yoga', 'Dhana Yoga', 'Neecha Bhanga', 'Kemadruma',
];
const YOGA_MENTION = new RegExp(
  `\\b(${KNOWN_YOGAS.map(y => y.replace(/\s+/g, '\\s+')).join('|')})\\s+(?:Yoga|yoga)?\\b`,
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
    // Extended categories — added so the validator covers the rest of
    // the hallucination surface (planet-house, planet-sign, yoga claims),
    // not just dasha. Each hallucination entry is { claimed, actual }.
    hallucinatedHouses: [],
    hallucinatedSigns: [],
    hallucinatedYogas: [],
    // REFUSAL detection — Gemini sometimes refuses to cite the dasha even
    // when the chart block above its prompt clearly contains it. Real-user
    // test: Chintan asked "what is my mahadasha" and got "iski jaankari
    // abhi mere paas nahi hai" — despite the prompt containing
    // Mahadasha: Venus. The hallucination check missed this because no
    // wrong planet was named; nothing was named at all. We now flag this
    // separately so auto-retry can correct it with a sharper prompt.
    refusedDespiteChart: false,
  };
  if (!answer || typeof answer !== 'string') return report;
  if (!chartData) return report;

  // ---- DASHA ----
  if (chartData.dasha) {
    report.activeMaha = chartData.dasha.mahadasha || null;
    report.activeAntar = chartData.dasha.antardasha || null;
    report.activePratyantar = chartData.dasha.pratyantar || null;
  }
  const cited = new Set();
  let m;
  DASHA_MENTION.lastIndex = 0;
  while ((m = DASHA_MENTION.exec(answer)) !== null) cited.add(m[1]);
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

  // ---- PLANET-IN-HOUSE ----
  if (chartData.planets) {
    PLANET_HOUSE_MENTION.lastIndex = 0;
    while ((m = PLANET_HOUSE_MENTION.exec(answer)) !== null) {
      const planet = m[1];
      const claimedHouse = parseInt(m[2], 10);
      const actualHouse = chartData.planets[planet] && chartData.planets[planet].house;
      if (typeof actualHouse === 'number' && actualHouse > 0 && actualHouse !== claimedHouse) {
        report.hallucinatedHouses.push({ planet, claimed: claimedHouse, actual: actualHouse });
        report.mismatch = true;
      }
    }
  }

  // ---- PLANET-IN-SIGN ----
  if (chartData.planets) {
    PLANET_SIGN_MENTION.lastIndex = 0;
    while ((m = PLANET_SIGN_MENTION.exec(answer)) !== null) {
      const planet = m[1];
      const claimedSign = normalizeSign(m[2]);
      const p = chartData.planets[planet];
      const actualSign = p && (extractSign(p.sign) || extractSign(p.rashiName));
      if (claimedSign && actualSign && claimedSign !== actualSign) {
        report.hallucinatedSigns.push({ planet, claimed: claimedSign, actual: actualSign });
        report.mismatch = true;
      }
    }
  }

  // ---- YOGA CLAIMS ----
  // chartData.yogas is the matched yogas list from detectAllYogas(). If
  // the LLM cites a yoga that isn't in this list, flag it.
  if (Array.isArray(chartData.yogas)) {
    const matchedYogaNames = chartData.yogas.map(y =>
      (y.name || y.id || '').toLowerCase().replace(/\s+yoga$/i, ''),
    );
    YOGA_MENTION.lastIndex = 0;
    const claimedYogas = new Set();
    while ((m = YOGA_MENTION.exec(answer)) !== null) {
      claimedYogas.add(m[1].toLowerCase().replace(/\s+/g, ' '));
    }
    for (const claimed of claimedYogas) {
      const present = matchedYogaNames.some(name =>
        name.includes(claimed) || claimed.includes(name),
      );
      if (!present) {
        report.hallucinatedYogas.push(claimed);
        report.mismatch = true;
      }
    }
  }

  // ---- REFUSAL detection ----
  // When the chart definitely has a current dasha (chartData.dasha.mahadasha
  // exists) AND the LLM cited NO dasha at all AND the answer text contains
  // a refusal-pattern phrase ("don't have", "can't determine", "need more
  // info", "iski jaankari mere paas nahi"), flag it as a refusal so /chat
  // can auto-retry with a sharper correction prompt.
  if (report.activeMaha && report.citedDashas.length === 0) {
    const refusalPatterns = [
      /(?:do not|don't|don't|cannot|can't|can not)\s+(?:have|know|determine|tell|calculate|verify|see)/i,
      /need\s+(?:more|your|additional)\s+(?:information|info|details|data)/i,
      /(?:jaankari|jankari|janakari|information)\s+(?:abhi|hi)?\s*(?:bhi)?\s*(?:nahi|nhi|nahin)/i,
      /mere\s+paas\s+(?:nahi|nahin|nhi)/i,
      /(?:nahi|nahin)\s+(?:hai|h)(?:[,\s\.]|$)/i,
      /\b(?:uplabdh|available)\s+nahi\b/i,
      /consult\s+(?:a|an|your)?\s*astrologer/i,
      /unable\s+to\s+(?:determine|provide|tell|calculate)/i,
    ];
    if (refusalPatterns.some(re => re.test(answer))) {
      report.refusedDespiteChart = true;
      report.mismatch = true;
    }
  }

  return report;
}

/**
 * Convert a fidelity report into a one-line log message. Used by /chat
 * so production logs surface mismatches at WARN level. Shows ALL
 * hallucination categories, not just dasha.
 */
function fidelityLogLine(report) {
  if (!report.mismatch) {
    const cited = report.citedDashas.length > 0
      ? `cited=${report.citedDashas.join(',')}`
      : 'no dasha cited';
    return `[fidelity ok] ${cited} active=${report.activeMaha}/${report.activeAntar}/${report.activePratyantar}`;
  }
  const parts = [];
  if (report.hallucinatedDashas.length > 0) {
    parts.push(`dasha=${report.hallucinatedDashas.join(',')}(cited) vs ${report.activeMaha}/${report.activeAntar}/${report.activePratyantar}(actual)`);
  }
  if (report.hallucinatedHouses.length > 0) {
    parts.push('houses=' + report.hallucinatedHouses
      .map(h => `${h.planet}(claimed=${h.claimed},actual=${h.actual})`).join(';'));
  }
  if (report.hallucinatedSigns.length > 0) {
    parts.push('signs=' + report.hallucinatedSigns
      .map(s => `${s.planet}(claimed=${s.claimed},actual=${s.actual})`).join(';'));
  }
  if (report.hallucinatedYogas.length > 0) {
    parts.push(`yogas=${report.hallucinatedYogas.join(',')}(not_in_chart)`);
  }
  if (report.refusedDespiteChart) {
    parts.push(`REFUSED despite chart showing maha=${report.activeMaha} antar=${report.activeAntar}`);
  }
  return `[fidelity MISMATCH] ${parts.join(' | ')}`;
}

/**
 * Build a correction prompt the LLM can use to rewrite a failed answer.
 * Used by /chat's auto-retry path. The prompt is concrete about what
 * was wrong and what the correct facts are, so the model can fix the
 * specific mistakes without re-imagining the whole answer.
 *
 * Returns null if the report has no mismatch (nothing to correct).
 */
function buildCorrectionPrompt(report) {
  if (!report.mismatch) return null;
  const lines = ['CORRECTION REQUIRED. Your previous answer contained the following factual errors. Rewrite the ENTIRE answer using the correct facts. Do not add disclaimers about the correction — just produce a fresh accurate answer in the same JSON format.'];
  if (report.hallucinatedDashas.length > 0) {
    lines.push(`- You cited ${report.hallucinatedDashas.join(', ')} as a current dasha. The actual current dasha is: Mahadasha = ${report.activeMaha}, Antardasha = ${report.activeAntar}, Pratyantar = ${report.activePratyantar}. Use only these names if you mention the current dasha.`);
  }
  for (const h of report.hallucinatedHouses) {
    lines.push(`- You said ${h.planet} is in the ${h.claimed}th house. ${h.planet} is actually in the ${h.actual}th house.`);
  }
  for (const s of report.hallucinatedSigns) {
    lines.push(`- You said ${s.planet} is in ${s.claimed}. ${s.planet} is actually in ${s.actual}.`);
  }
  if (report.hallucinatedYogas.length > 0) {
    lines.push(`- You claimed the following yogas are present in this chart: ${report.hallucinatedYogas.join(', ')}. These yogas do NOT match in this chart. Do not cite them.`);
  }
  if (report.refusedDespiteChart) {
    lines.push(
      `- CRITICAL: you said you do not have the user's current dasha information. This is WRONG. The CURRENT DASHA PERIOD is right there in the chart context: Mahadasha = ${report.activeMaha}, Antardasha = ${report.activeAntar}, Pratyantar = ${report.activePratyantar}. Rewrite your answer naming these exact planets. Do not say "I don't know" — the data is in your prompt. Example: "Aapki vartaman Mahadasha ${report.activeMaha} hai, Antardasha ${report.activeAntar} hai."`,
    );
  }
  return lines.join('\n');
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
  // Test chart used across cases: Saturn/Mercury/Venus dasha,
  // Mars in 8th house in Cancer, Jupiter in 2nd house in Leo.
  const testChart = {
    dasha: { mahadasha: 'Saturn', antardasha: 'Mercury', pratyantar: 'Venus' },
    planets: {
      Mars: { house: 8, sign: 'Cancer', rashiName: 'Karka (Cancer)' },
      Jupiter: { house: 2, sign: 'Leo', rashiName: 'Simha (Leo)' },
    },
    yogas: [{ name: 'Raja Yoga' }],
  };
  const synthetic = [
    // Dasha cases (kept from earlier)
    { answer: 'Aap currently Saturn ki mahadasha mein hain.', chart: testChart, expectMismatch: false },
    { answer: 'Aapki current Jupiter mahadasha career success layegi.', chart: testChart, expectMismatch: true },
    { answer: 'Mercury antardasha ke dauran technical career mein progress hogi.', chart: testChart, expectMismatch: false },
    { answer: 'Saturn dasha mein discipline aur Mars dasha ki energy combined hai.', chart: testChart, expectMismatch: true },
    { answer: 'Marriage 7th house ke through dekha jaata hai. Specific dasha mention nahi.', chart: testChart, expectMismatch: false },
    // Planet-in-house cases (new)
    { answer: 'Mars in the 8th house brings transformative energy.', chart: testChart, expectMismatch: false },
    { answer: 'Mars in the 5th house gives sports talent.', chart: testChart, expectMismatch: true },
    // Planet-in-sign cases (new)
    { answer: 'Jupiter in Leo expands your authority.', chart: testChart, expectMismatch: false },
    { answer: 'Jupiter in Cancer (exalted) brings deep wisdom.', chart: testChart, expectMismatch: true },
    // Yoga claim (new) — Raja Yoga IS in chart, Gajakesari is NOT
    { answer: 'You have Raja Yoga in your chart.', chart: testChart, expectMismatch: false },
    { answer: 'Your chart shows Gajakesari Yoga, which brings fame.', chart: testChart, expectMismatch: true },
    // Refusal-despite-chart cases (new) — Gemini hedges instead of citing
    { answer: 'Aapki vartaman Mahadasha ki specific jaankari mere paas nahi hai. Jyotishi se consult karein.', chart: testChart, expectMismatch: true },
    { answer: "I don't have your current mahadasha information. Please provide your janma nakshatra.", chart: testChart, expectMismatch: true },
    { answer: 'For a complete reading I need more information about your birth.', chart: testChart, expectMismatch: true },
    // Genuine no-chart case — should NOT flag refusal (no chart to flag against)
    { answer: "I don't have your dasha information.", chart: { dasha: { mahadasha: null, antardasha: null, pratyantar: null } }, expectMismatch: false },
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
  buildCorrectionPrompt,
  runFidelityProbe,
};
