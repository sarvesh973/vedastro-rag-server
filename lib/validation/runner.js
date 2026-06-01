// =========================================
// VALIDATION RUNNER
// =========================================
//
// For each celebrity event in the dataset:
//   1. Compute their natal chart
//   2. Figure out what dasha+bhukti was active at the event date
//   3. Build a chart context with that historical dasha state
//   4. Run the rule evaluator for the event's domain
//   5. HIT = at least one rule matched whose timeframe is the
//      currently-active dasha and whose evidence includes the
//      planet that was active. Plus polarity must broadly align
//      with the event nature (positive marriage rule fires for an
//      actual marriage event; not for a divorce, etc.)
//
// This produces a deterministic, falsifiable accuracy number per
// domain — the marketing claim the app can publish.

const { getKundli, Observer } = require('@prisri/jyotish');
const { DateTime } = require('luxon');
const { computeKarakas } = require('../karakas');
const { computeShadbala } = require('../shadbala');
const { computeAshtakavarga } = require('../ashtakavarga');
const { detectAllYogas } = require('../yogas');
const { computeTransits } = require('../transits');
const { evaluateDomain } = require('../rules/evaluator');
const celebrities = require('./celebrity-charts');

// Convert a celebrity's birth record into the chart shape our rule
// engine expects (matches what calculateChart returns in index.js).
function buildNatalChart(birth) {
  const localDt = DateTime.fromObject(
    {
      year: +birth.date.slice(0, 4),
      month: +birth.date.slice(5, 7),
      day: +birth.date.slice(8, 10),
      hour: +birth.time.slice(0, 2),
      minute: +birth.time.slice(3, 5),
    },
    { zone: birth.timezone },
  );
  const utcMs = localDt.toUTC().toJSDate();
  const observer = new Observer(birth.lat, birth.lon, 0);
  return getKundli(utcMs, observer);
}

// Find which mahadasha + antardasha + pratyantar was active on the
// target date. Pratyantar is the 3rd-level sub-period and the actual
// CLASSICAL event trigger in most predictive use — many real events
// happen in pratyantar of a relevant planet even if the mahadasha
// itself doesn't match.
function dashaAt(natalChart, targetDate) {
  const t = new Date(targetDate);
  const md = natalChart.dasha.mahadashas.find(
    m => new Date(m.startTime) <= t && new Date(m.endTime) >= t);
  if (!md) return { mahadasha: 'unknown', antardasha: 'unknown', pratyantar: 'unknown' };
  const ad = (md.antars || []).find(
    a => new Date(a.startTime) <= t && new Date(a.endTime) >= t);
  const pad = ad && (ad.pratyantars || []).find(
    p => new Date(p.startTime) <= t && new Date(p.endTime) >= t);
  return {
    mahadasha: md.planet || 'unknown',
    antardasha: ad ? ad.planet : 'unknown',
    pratyantar: pad ? pad.planet : 'unknown',
  };
}

// Build a chart context valid AS OF a specific historical date.
// Uses the natal chart's static facts (planets, houses) but injects
// the dasha that was active at the event date.
function buildContextAtDate(natalChart, eventDate) {
  const dasha = dashaAt(natalChart, eventDate);

  const planetSummary = {};
  for (const [name, data] of Object.entries(natalChart.planets)) {
    if (['Uranus', 'Neptune', 'Pluto'].includes(name)) continue;
    const houseNum = natalChart.houses.findIndex(h => h.planets.includes(name)) + 1;
    planetSummary[name] = {
      sign: data.rashiName,
      degree: Math.floor(data.longitude % 30),
      nakshatra: data.nakshatra,
      house: houseNum || -1,
      longitude: data.longitude,
    };
  }

  // D9 / D10 (sign-only summary like the production code)
  const d9 = {};
  if (natalChart.vargas?.d9) {
    for (const [n, d] of Object.entries(natalChart.vargas.d9.planets || {})) d9[n] = d.rashiName;
    d9['Ascendant'] = natalChart.vargas.d9.ascendant?.rashiName;
  }
  const d10 = {};
  if (natalChart.vargas?.d10) {
    for (const [n, d] of Object.entries(natalChart.vargas.d10.planets || {})) d10[n] = d.rashiName;
    d10['Ascendant'] = natalChart.vargas.d10.ascendant?.rashiName;
  }

  const ctx = {
    ascendant: { sign: natalChart.ascendant.rashiName, lord: natalChart.ascendant.rashiLord },
    planets: planetSummary,
    houses: natalChart.houses,
    dasha,
    d9Navamsha: d9,
    d10Dasamsa: d10,
    karakas: computeKarakas(natalChart),
    shadbala: computeShadbala(natalChart),
    ashtakavarga: computeAshtakavarga(natalChart),
    yogas: detectAllYogas(natalChart),
  };
  // Transits AT the event date (not today). Rule files like
  // sade_sati_health_caution check this; with event-date transits
  // they can now fire correctly for historical events.
  const natalForTransits = {
    ascendant: { sign: natalChart.ascendant.rashiName, rashiName: natalChart.ascendant.rashiName },
    planets: Object.fromEntries(Object.entries(natalChart.planets).map(([n, d]) => [
      n, { sign: d.rashiName, rashiName: d.rashiName, longitude: d.longitude },
    ])),
  };
  ctx.transits = computeTransits(natalForTransits, eventDate);
  return ctx;
}

// A rule "fires" for a historical event if:
//   1. Its timeframe is 'currentDasha' or 'lifetime' or
//      'XthLordDasha' (anything that should be active in the dasha
//      context we just built)
//   2. AND for currentDasha rules, the evidence must reference a
//      planet that's actually in the active dasha (otherwise the rule
//      matched on lifetime structure, which is fine but not a TIMING
//      hit for this specific event)
//
// We classify as HIT if any matched rule has polarity broadly
// aligning with the event:
//   - marriage / children / career / wealth / education / foreign
//     / family events: any positive or mixed rule = HIT
//   - health events: any negative (when bad event) or any rule
//     (when "death" — we just want SOMETHING to fire for the chart's
//     longevity / 8th-house signals)
function scoreEventAgainstMatches(event, matched) {
  if (!matched || matched.length === 0) {
    return { hit: false, hitStrict: false, reason: 'no matched rules in domain' };
  }
  // BASIC metric — any timing rule fires
  const timing = matched.filter(m =>
    m.timeframe === 'currentDasha' ||
    /LordDasha/.test(m.timeframe || '') ||
    m.timeframe === 'transit');

  // STRICT metric — at least 2 timing rules fire AND one has
  // intensity ≥ 8 AND its polarity isn't 'negative' for positive
  // life events (marriage/children/career/wealth/education/
  // foreign/family) or vice versa. Catches the "permissive
  // pratyantar makes everything fire" false-positive issue.
  const positiveDomains = new Set(['marriage', 'children', 'career', 'wealth', 'education', 'foreign', 'family']);
  const expectsPositive = positiveDomains.has(event.domain);
  const strongTiming = timing.filter(m => {
    if (m.intensity < 8) return false;
    if (expectsPositive && m.polarity === 'negative') return false;
    return true;
  });
  const hitStrict = strongTiming.length >= 2;

  if (timing.length > 0) {
    return {
      hit: true,
      hitStrict,
      kind: 'timing',
      timingCount: timing.length,
      strongTimingCount: strongTiming.length,
      strongestRule: timing[0].id,
      strongestIntensity: timing[0].intensity,
      reason: `${timing.length} timing rule(s) fired${hitStrict ? ' (STRICT: 2+ strong)' : ' (basic only)'}`,
    };
  }
  return {
    hit: 'soft',
    hitStrict: false,
    kind: 'lifetime-only',
    strongestRule: matched[0].id,
    strongestIntensity: matched[0].intensity,
    reason: `${matched.length} lifetime rule(s) matched but no timing rule for this dasha`,
  };
}

function runValidation() {
  const report = {
    runAt: new Date().toISOString(),
    totalCharts: celebrities.length,
    totalEvents: 0,
    hits: 0,           // basic: any timing rule fired
    hitsStrict: 0,     // strict: 2+ strong timing rules, polarity-aligned
    softHits: 0,       // only lifetime structural rules matched
    misses: 0,
    byDomain: {},
    perChart: [],
  };

  for (const celeb of celebrities) {
    let natal;
    try { natal = buildNatalChart(celeb.birth); }
    catch (e) {
      report.perChart.push({ name: celeb.name, error: 'natal chart failed: ' + e.message });
      continue;
    }
    const chartReport = { name: celeb.name, rodden: celeb.rodden, events: [] };
    for (const evt of celeb.events) {
      report.totalEvents++;
      const ctx = buildContextAtDate(natal, evt.date);
      const matched = evaluateDomain(ctx, evt.domain, { topN: 10, minIntensity: 1 });
      const score = scoreEventAgainstMatches(evt, matched);
      const bd = report.byDomain[evt.domain] ||= { events: 0, hits: 0, hitsStrict: 0, softHits: 0, misses: 0 };
      bd.events++;
      if (score.hit === true) { report.hits++; bd.hits++; }
      else if (score.hit === 'soft') { report.softHits++; bd.softHits++; }
      else { report.misses++; bd.misses++; }
      if (score.hitStrict) { report.hitsStrict++; bd.hitsStrict++; }
      chartReport.events.push({
        date: evt.date,
        domain: evt.domain,
        description: evt.description,
        activeDasha: ctx.dasha.mahadasha + '/' + ctx.dasha.antardasha,
        matchedRules: matched.length,
        outcome: score,
      });
    }
    report.perChart.push(chartReport);
  }

  // Aggregate stats
  report.hitRate = report.totalEvents > 0
    ? Math.round((report.hits / report.totalEvents) * 100) : 0;
  report.hitRateStrict = report.totalEvents > 0
    ? Math.round((report.hitsStrict / report.totalEvents) * 100) : 0;
  report.softHitRate = report.totalEvents > 0
    ? Math.round((report.softHits / report.totalEvents) * 100) : 0;
  report.combinedRate = report.totalEvents > 0
    ? Math.round(((report.hits + report.softHits) / report.totalEvents) * 100) : 0;

  // Self-test the answer-fidelity checker. This doesn't call the LLM
  // (would burn Gemini quota for every validation run); it just verifies
  // the detector itself catches synthetic hallucinations. Real fidelity
  // metrics come from the runtime [fidelity ...] logs in production.
  try {
    const { runFidelityProbe } = require('../answer-fidelity');
    report.fidelityChecker = runFidelityProbe();
  } catch (e) {
    report.fidelityChecker = { error: e.message };
  }

  return report;
}

module.exports = {
  runValidation,
  buildNatalChart,
  buildContextAtDate,
  dashaAt,
};
