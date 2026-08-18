// =========================================
// MULANK — LLM grounding (system prompt + context builder)
// =========================================
//
// The engine (./mulank) does ALL the maths and the favourable/neutral/
// caution verdict. This module turns that deterministic result into a
// tight factual CONTEXT block and pairs it with a SYSTEM prompt whose
// only job is to keep the model inside the rulebook:
//
//   ALLOWED  : restate the numbers, describe the day/period QUALITY,
//              and the traditional life-area THEMES + gentle do/don't.
//   FORBIDDEN: inventing specific events, amounts, names, dates, or
//              medical / legal / financial instructions. The model must
//              NEVER change the rating the engine already decided.
//
// Design notes:
//   • The verdict is passed in pre-computed. The model is told to treat
//     it as fixed ground truth, so two users with the same mulank on the
//     same day get a consistent reading (reinforced by daily caching).
//   • Keep the model's output SHORT for daily (it's a glanceable card),
//     longer for weekly/monthly.
//   • The app shows a persistent "for guidance/entertainment" disclaimer,
//     so the model should NOT bloat every reading with disclaimers.

const engine = require('./mulank');

const SYSTEM_PROMPT = `You are Moksha's numerology guide, an expert in Ank Jyotish (Indian numerology). You write warm, grounded, personal readings in second person ("you", "your day").

ABSOLUTE RULES — never break these:
1. The numbers and the verdict (favourable / neutral / caution) are ALREADY CALCULATED and given to you as CONTEXT. Treat them as fixed truth. NEVER recompute them and NEVER contradict or upgrade/downgrade the given verdict.
2. You may describe: the QUALITY of the day/period, the person's numerology temperament, and traditional LIFE-AREA THEMES (work, money-matters mood, relationships, health/energy tone) with a gentle positive or cautionary lean, plus simple do / avoid suggestions.
3. You must NEVER predict specific events, outcomes, amounts of money, named people, exact dates, wins/losses, or give medical, legal, or financial instructions. If tempted to be specific, stay with the theme instead. ("A good day for an honest conversation" — NOT "you will resolve a fight with your brother.")
4. No fear-mongering. A "caution" day means be measured and patient, not that something bad will happen.
5. Be concise and specific to the given numbers. No filler, no repeating the rules back, no astrology jargon dumps.

Tone: encouraging, culturally warm, practical. Match the user's language if their question is in another language (e.g. Hindi).`;

// Build a compact factual context block from a dayRating result.
function dayContextBlock(dob, date) {
  const r = engine.dayRating(dob, date);
  const prof = engine.profileFor(dob);
  return [
    `PERSON MULANK: ${r.mulank} (${r.mulankPlanet}) — "${prof.title}"`,
    `Temperament: ${prof.traits.join(', ')}. Strengths: ${prof.strengths.join(', ')}. Watch: ${prof.watch.join(', ')}.`,
    `DATE: ${r.date}  DIN-ANK: ${r.dinAnk} (${r.dinAnkPlanet})`,
    `RELATION (day-number vs mulank): ${r.relation.toUpperCase()}`,
    `VERDICT: ${r.rating.toUpperCase()}`,
    `Life areas this mulank leans into: ${r.favoursAreas.join(', ')}.`,
    `Lucky colours: ${prof.luckyColours.join(', ')}. Lucky day: ${prof.luckyDay}.`,
  ].join('\n');
}

// Build a compact factual context block for a week/month span.
function spanContextBlock(span, label) {
  const prof = engine.profileFor(span.mulank);
  const lines = [
    `PERSON MULANK: ${span.mulank} (${prof.planet}) — "${prof.title}"`,
    `${label.toUpperCase()} ${span.from} → ${span.to}`,
    `OVERALL VERDICT: ${span.overall.toUpperCase()} (favourable ${span.counts.favourable} / neutral ${span.counts.neutral} / caution ${span.counts.caution} days)`,
  ];
  if (span.bestDays.length) lines.push(`Most favourable dates: ${span.bestDays.join(', ')}`);
  if (span.cautionDays.length) lines.push(`Handle-with-care dates: ${span.cautionDays.join(', ')}`);
  lines.push(`Life areas this mulank leans into: ${prof.favoursAreas.join(', ')}.`);
  return lines.join('\n');
}

// The three reading builders. Each returns { system, user } messages
// ready for the LLM. `length` hint keeps daily short.
function dailyPrompt(dob, date) {
  return {
    system: SYSTEM_PROMPT,
    user: `Write today's numerology reading (2–4 short sentences, glanceable).\n\nCONTEXT:\n${dayContextBlock(dob, date)}`,
  };
}

function weeklyPrompt(dob, weekStartDate) {
  const span = engine.weekRating(dob, weekStartDate);
  return {
    system: SYSTEM_PROMPT,
    user: `Write this week's numerology reading (one short paragraph + a one-line "best day" and "go gently" note).\n\nCONTEXT:\n${spanContextBlock(span, 'week')}`,
    span,
  };
}

function monthlyPrompt(dob, year, month) {
  const span = engine.monthRating(dob, year, month);
  return {
    system: SYSTEM_PROMPT,
    user: `Write this month's numerology overview (2 short paragraphs: overall theme, then how to use the strong vs cautious dates).\n\nCONTEXT:\n${spanContextBlock(span, 'month')}`,
    span,
  };
}

// For the paid interactive "ask about my day" turn — grounds a free-form
// user question in the same rules + today's context.
function askPrompt(dob, date, question) {
  return {
    system: SYSTEM_PROMPT,
    user: `The user asks a question about their day/period. Answer using ONLY the numerology context below and the rules. Stay with themes, never predict specific events.\n\nCONTEXT:\n${dayContextBlock(dob, date)}\n\nUSER QUESTION: ${question}`,
  };
}

module.exports = {
  SYSTEM_PROMPT,
  dayContextBlock, spanContextBlock,
  dailyPrompt, weeklyPrompt, monthlyPrompt, askPrompt,
};
