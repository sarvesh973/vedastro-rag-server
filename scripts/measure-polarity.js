#!/usr/bin/env node
// =========================================
// POLARITY BALANCE METRIC
// =========================================
//
// Real-user observation: the app "gives mostly positive answers, rarely
// negative". That is a claim about what the LLM SEES, not about the LLM
// itself — buildChatPrompt can only report difficulty if difficulty
// reaches it. This measures exactly that.
//
// For every Rodden-rated chart in the validation corpus, it runs the same
// selection /chat runs — evaluateDomain(topN 6) plus the always-on
// evaluateNakshatra(topN 3, minIntensity 6) — and reports the polarity
// mix of the rules that end up in the prompt.
//
// The headline number is READINGS WITH NO NEGATIVE AT ALL: the share of
// chart+topic combinations where the model is handed nothing but good
// news and therefore cannot produce a balanced answer no matter how the
// prompt is worded.
//
// Usage: node scripts/measure-polarity.js [--per-domain]
//
// Run it before and after any rule-scoring change. Prompt wording cannot
// move these numbers; only the rule data can.

const { buildNatalChart, buildContextAtDate } = require('../lib/validation/runner');
const { evaluateDomain, evaluateNakshatra, REGISTRY } = require('../lib/rules/evaluator');
const celebrities = require('../lib/validation/celebrity-charts');

const PER_DOMAIN = process.argv.includes('--per-domain');
const DOMAINS = Object.keys(REGISTRY).filter((d) => d !== 'nakshatra');
const ASOF = new Date();

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) + '%' : '—');

function main() {
  const tally = { positive: 0, negative: 0, mixed: 0, neutral: 0 };
  const intensity = { positive: [], negative: [] };
  const position = { positive: [], negative: [] };
  const perDomain = {};

  let chartsOk = 0;
  let chartsFailed = 0;
  let combos = 0;
  let combosNoNegative = 0;

  for (const celeb of celebrities) {
    let ctx;
    try {
      ctx = buildContextAtDate(buildNatalChart(celeb.birth), ASOF);
    } catch (e) {
      chartsFailed++;
      continue;
    }
    chartsOk++;

    for (const domain of DOMAINS) {
      let selected;
      try {
        // Exactly what /chat assembles: topic rules + always-on nakshatra.
        selected = evaluateDomain(ctx, domain, { topN: 6 })
          .concat(evaluateNakshatra(ctx, { topN: 3, minIntensity: 6 }));
      } catch (e) {
        continue;
      }
      if (selected.length === 0) continue;

      combos++;
      perDomain[domain] = perDomain[domain] || { combos: 0, pos: 0, neg: 0, noNeg: 0 };
      perDomain[domain].combos++;

      let negatives = 0;
      selected.forEach((m, idx) => {
        const p = m.polarity || 'neutral';
        tally[p] = (tally[p] || 0) + 1;
        if (p === 'positive' || p === 'negative') {
          intensity[p].push(m.intensity);
          position[p].push(idx + 1); // 1-based order the model reads
        }
        if (p === 'negative') negatives++;
        if (p === 'positive') perDomain[domain].pos++;
        if (p === 'negative') perDomain[domain].neg++;
      });

      if (negatives === 0) {
        combosNoNegative++;
        perDomain[domain].noNeg++;
      }
    }
  }

  const totalRules = Object.values(tally).reduce((a, b) => a + b, 0);
  const L = (k, v) => console.log(`  ${k.padEnd(36)} ${v}`);

  console.log(`\n=== POLARITY OF RULES REACHING THE PROMPT ===\n`);
  L('charts analysed', `${chartsOk}${chartsFailed ? ` (${chartsFailed} failed)` : ''}`);
  L('chart x topic readings', combos);
  L('rules selected in total', totalRules);

  console.log('\nPOLARITY MIX');
  for (const p of ['positive', 'negative', 'mixed', 'neutral']) {
    L(p, `${tally[p] || 0}  (${pct(tally[p] || 0, totalRules)})`);
  }

  console.log('\nWHAT THE MODEL IS TOLD ABOUT STRENGTH');
  L('mean intensity, positive', mean(intensity.positive).toFixed(2));
  L('mean intensity, negative', mean(intensity.negative).toFixed(2));
  L('max intensity, positive', intensity.positive.length ? Math.max(...intensity.positive) : '—');
  L('max intensity, negative', intensity.negative.length ? Math.max(...intensity.negative) : '—');

  console.log('\nWHERE THEY APPEAR IN THE LIST (1 = read first)');
  L('mean position, positive', mean(position.positive).toFixed(2));
  L('mean position, negative', mean(position.negative).toFixed(2));

  console.log('\n*** HEADLINE ***');
  L('readings with NO negative at all', `${combosNoNegative}/${combos}  (${pct(combosNoNegative, combos)})`);

  if (PER_DOMAIN) {
    console.log('\nPER DOMAIN');
    console.log(`  ${'domain'.padEnd(16)}${'readings'.padStart(9)}${'pos'.padStart(7)}${'neg'.padStart(7)}${'no-neg'.padStart(9)}`);
    for (const [d, s] of Object.entries(perDomain).sort((a, b) => b[1].neg - a[1].neg)) {
      console.log(
        `  ${d.padEnd(16)}${String(s.combos).padStart(9)}${String(s.pos).padStart(7)}` +
        `${String(s.neg).padStart(7)}${pct(s.noNeg, s.combos).padStart(9)}`,
      );
    }
  }
  console.log('');
}

main();
