#!/usr/bin/env node
// =========================================
// USER BEHAVIOUR + ANSWER QUALITY ANALYSER
// =========================================
//
// Pulls real traffic from the /admin/api/* endpoints and scores it against
// the failure modes buildChatPrompt() already tries to prevent. The prompt
// has rules like "TIMING QUESTIONS - A WINDOW IS MANDATORY" and "SHORT
// FOLLOW-UPS INHERIT THE THREAD" — this measures how often production
// actually honours them, instead of us assuming it does.
//
// Nothing here writes to the server. Read-only.
//
// USAGE
//   export MOKSHA_ADMIN_TOKEN='<Firebase ID token>'
//   node scripts/analyze-chats.mjs
//   node scripts/analyze-chats.mjs --limit 500 --days 30
//   node scripts/analyze-chats.mjs --offline        # re-score the last dump
//   node scripts/analyze-chats.mjs --share          # redacted, safe to paste
//
// Get the token from the dashboard console (it is exposed on purpose):
//   await window.__moksha.getToken()
// Firebase ID tokens expire after ~1 hour; re-copy when you get a 401.
//
// The raw dump lands in the OS temp dir, NOT the repo — it contains user
// emails and their actual questions, and .gitignore does not cover it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes(`--${name}`);

const BASE = (process.env.MOKSHA_API || 'https://vedastro-rag-server.onrender.com').replace(/\/$/, '');
const TOKEN = process.env.MOKSHA_ADMIN_TOKEN || '';
const LIMIT = Math.min(parseInt(flag('limit', '500'), 10) || 500, 500);
const DAYS = parseInt(flag('days', '30'), 10) || 30;
const OFFLINE = has('offline');
const SHARE = has('share');
const DUMP = path.join(os.tmpdir(), 'moksha-chat-dump.json');

// plan id -> what the user actually sees. Copied from PLAN_LABELS in
// admin_v2.html: the internal ids do NOT match the marketed tier names,
// so a report without this mapping names the wrong tier as best-selling.
const PLAN_LABELS = {
  pass: 'Starter Pass ₹49/wk',
  trial: 'Standard ₹199/mo',
  standard: 'Premium ₹499/mo',
  premium: 'Unlimited ₹999/mo',
  free: 'Free',
};

// ── fetch ────────────────────────────────────────────────
// Firestore collection-group index URLs recovered from 500 bodies.
// /admin/api/chats/{recent,top-users} put the console link in `indexUrl`;
// /admin/api/overview does not, so we also scrape it out of the raw message.
const indexUrls = new Set();

async function get(route) {
  const res = await fetch(`${BASE}${route}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const body = await res.text();
  if (!res.ok) {
    let parsed = null;
    try { parsed = JSON.parse(body); } catch { /* not JSON */ }

    // Never truncate a 5xx: the Firestore index link is ~250 chars and
    // getting it cut in half is what makes this error look mysterious.
    const link = (parsed && parsed.indexUrl)
      || (body.match(/https:\/\/console\.firebase\.google\.com\S+?(?=["'\\\s]|$)/) || [])[0]
      || null;
    if (link) indexUrls.add(link);

    const hint = res.status === 401
      ? 'token missing/expired — re-copy via await window.__moksha.getToken()'
      : res.status === 403
        ? 'token valid but its email is not in ADMIN_EMAILS on Render'
        : [
            parsed && parsed.error ? parsed.error : body,
            parsed && parsed.hint ? `\n       hint: ${parsed.hint}` : '',
            link ? '\n       -> missing Firestore index (link collected below)' : '',
          ].join('');
    throw new Error(`${res.status} ${route} :: ${hint}`);
  }
  try { return JSON.parse(body); } catch { throw new Error(`${route} returned non-JSON`); }
}

async function collect() {
  if (!TOKEN) {
    console.error('MOKSHA_ADMIN_TOKEN is not set. See the header of this file.');
    process.exit(2);
  }
  const routes = {
    recent: `/admin/api/chats/recent?limit=${LIMIT}`,
    topUsers: `/admin/api/chats/top-users?days=${DAYS}&limit=25`,
    overview: '/admin/api/overview',
    subscriptions: '/admin/api/subscriptions',
    feedback: '/admin/api/feedback',
  };
  const out = { fetchedAt: new Date().toISOString(), base: BASE, data: {}, errors: {} };
  // Sequential on purpose: Render free tier cold-starts, and a 5-way
  // parallel burst against a sleeping instance just produces 5 timeouts.
  for (const [key, route] of Object.entries(routes)) {
    try {
      out.data[key] = await get(route);
      process.stderr.write(`  ok   ${route}\n`);
    } catch (e) {
      out.errors[key] = e.message;
      process.stderr.write(`  FAIL ${route} :: ${e.message}\n`);
    }
  }
  fs.writeFileSync(DUMP, JSON.stringify(out));
  process.stderr.write(`\ndump -> ${DUMP}\n`);

  if (indexUrls.size) {
    process.stderr.write(
      `\n!! MISSING FIRESTORE COLLECTION-GROUP INDEX — this is the 500.\n` +
      `   collectionGroup('chats').orderBy('timestamp') cannot run without it.\n` +
      `   Open each link, click "Create index", wait ~1-2 min, re-run:\n\n`,
    );
    for (const u of indexUrls) process.stderr.write(`   ${u}\n`);
    process.stderr.write('\n');
  }
  return out;
}

// ── classification (mirrors detectQuestionTopics in index.js) ────────────
const TOPIC_RE = {
  career: /\b(career|job|work|profession|business|naukri|kaam|promotion|salary)\b/i,
  marriage: /\b(marriage|marry|married|shaadi|vivah|wedding|spouse|wife|husband|divorce)\b/i,
  romance: /\b(love|romance|romantic|crush|pyaar|prem|ishq|mohabbat)\b/i,
  relationship: /\b(girlfriend|boyfriend|gf|bf|dating|relationship|partner|breakup)\b/i,
  finance: /\b(money|wealth|rich|finance|paisa|dhan|income|debt|loan|investment|property)\b/i,
  health: /\b(health|sick|illness|disease|bimari|fitness|medical|surgery|pain)\b/i,
  children: /\b(child|children|baby|pregnant|bachcha|santan|son|daughter)\b/i,
  spirituality: /\b(spiritual|moksha|dharma|god|bhagwan|meditation|guru|bhakti)\b/i,
  foreign: /\b(foreign|abroad|visa|videsh|migrate|relocate|nri|overseas)\b/i,
  education: /\b(study|education|exam|college|degree|padhai|vidya|course|phd)\b/i,
  family: /\b(family|mother|father|parent|maa|papa|brother|sister|bhai|behen)\b/i,
  litigation: /\b(court|case|legal|lawsuit|enemy|dispute|police)\b/i,
  longevity: /\b(age|lifespan|long life|death|ayu|will i live)\b/i,
  remedies: /\b(remedy|remedies|upay|mantra|gemstone|ratna|vrat|puja|daan|solution)\b/i,
  timing: /\b(when|kab|kab tak|kitne din|kitne saal|konsa mahina|how long|which month)\b/i,
  personality: /\b(personality|nature|character|swabhav|kaisa hu|kaisa hoon|who am i)\b/i,
};
const topicsOf = (s) => Object.entries(TOPIC_RE).filter(([, re]) => re.test(s)).map(([t]) => t);

const PLANETS = /\b(sun|moon|mars|mercury|jupiter|venus|saturn|rahu|ketu|surya|chandra|mangal|budh|guru|shukra|shani)\b/i;
const DEVANAGARI = /[ऀ-ॿ]/;
const HINGLISH = /\b(kab|kya|hai|hoga|mera|meri|kaisa|kaisi|kitne|kyu|kyun|nahi|batao|bata|aap|ke|ki|ka|se|me|hu|hoon)\b/i;

// A concrete time window, per the prompt's own definition: a year, a named
// month, or an explicit duration. "a favourable period is running" is not.
const CONCRETE_WINDOW = /\b(20\d{2}|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?|\d{1,2}\s*(months?|years?|saal|mahine|din|weeks?))\b/i;
// The exact evasions buildChatPrompt lists as FAILURES.
const VAGUE = [
  'favourable time is running', 'favorable time is running', 'auspicious period is running',
  'in the near future', 'jald hi', 'sahi samay', 'appropriate time', 'right time will come',
  'time is favourable', 'samay aayega',
];
const CITES = /\b(bphs|parashara|phaladeepika|saravali|jaimini)\b/i;

const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');

// ── pairing ──────────────────────────────────────────────
// /admin/api/chats/recent collapses question OR answer into `text` and
// distinguishes them only by `role`. Pair per-uid in time order: a user
// row followed by a non-user row is one exchange.
function pairExchanges(rows) {
  const byUid = new Map();
  for (const r of rows) {
    if (!r || !r.text) continue;
    const uid = r.uid || `anon:${r.source || 'unknown'}`;
    if (!byUid.has(uid)) byUid.set(uid, []);
    byUid.get(uid).push(r);
  }
  const pairs = [];
  const sessionsPerUid = new Map();
  for (const [uid, list] of byUid) {
    list.sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
    // 30-minute idle gap starts a new session.
    let sessions = 1;
    for (let i = 1; i < list.length; i++) {
      const prev = Date.parse(list[i - 1].timestamp || '');
      const cur = Date.parse(list[i].timestamp || '');
      if (Number.isFinite(prev) && Number.isFinite(cur) && cur - prev > 30 * 60 * 1000) sessions++;
    }
    sessionsPerUid.set(uid, sessions);

    for (let i = 0; i < list.length; i++) {
      if ((list[i].role || 'user') !== 'user') continue;
      const next = list[i + 1];
      if (next && (next.role || 'user') !== 'user') {
        pairs.push({ uid, q: list[i], a: next, prevA: pairs.length ? pairs[pairs.length - 1].a : null });
      } else {
        pairs.push({ uid, q: list[i], a: null, prevA: null });
      }
    }
  }
  return { pairs, byUid, sessionsPerUid };
}

// ── report ───────────────────────────────────────────────
function analyse(dump) {
  const rows = (dump.data.recent && dump.data.recent.items) || [];
  if (!rows.length) {
    console.log('No chat rows returned. Errors:', JSON.stringify(dump.errors, null, 2));
    return;
  }
  const { pairs, byUid, sessionsPerUid } = pairExchanges(rows);
  const answered = pairs.filter((p) => p.a);
  const userMsgs = pairs.map((p) => p.q);

  const stamps = rows.map((r) => Date.parse(r.timestamp || '')).filter(Number.isFinite).sort();
  const span = stamps.length
    ? `${new Date(stamps[0]).toISOString().slice(0, 10)} → ${new Date(stamps.at(-1)).toISOString().slice(0, 10)}`
    : 'unknown';

  const perUser = [...byUid.values()].map((l) => l.length).sort((a, b) => a - b);
  const p = (q) => perUser[Math.floor((perUser.length - 1) * q)] || 0;

  const shortFollowups = userMsgs.filter((m) => words(m.text) <= 5);
  const hinglish = userMsgs.filter((m) => DEVANAGARI.test(m.text) || HINGLISH.test(m.text));

  const topicCount = {};
  for (const m of userMsgs) for (const t of topicsOf(m.text)) topicCount[t] = (topicCount[t] || 0) + 1;

  // Repeat questions by the same user — the "users repeat themselves"
  // complaint the prompt's follow-up rule was written to fix.
  const repeats = new Map();
  for (const [uid, list] of byUid) {
    const seen = new Map();
    for (const r of list) {
      if ((r.role || 'user') !== 'user') continue;
      const k = norm(r.text);
      if (!k) continue;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    const dupes = [...seen.values()].filter((n) => n > 1).length;
    if (dupes) repeats.set(uid, dupes);
  }

  const hours = new Array(24).fill(0);
  for (const s of stamps) hours[new Date(s).getUTCHours() + 5 >= 24 ? new Date(s).getUTCHours() - 19 : new Date(s).getUTCHours() + 5]++;

  // ── answer-quality defects ──
  const defects = {
    timingNoWindow: [],
    vague: [],
    jsonLeak: [],
    dashaNoPlanet: [],
    noCitation: [],
    threadLoss: [],
    empty: [],
  };
  const answerFingerprints = new Map();

  for (const pr of answered) {
    const q = pr.q.text;
    const a = pr.a.text;
    if (!a.trim()) { defects.empty.push(pr); continue; }

    if (TOPIC_RE.timing.test(q) && !CONCRETE_WINDOW.test(a)) defects.timingNoWindow.push(pr);
    if (VAGUE.some((v) => a.toLowerCase().includes(v))) defects.vague.push(pr);
    if (/"summary"\s*:/.test(a) || /^\s*```/.test(a) || /^\s*[[{]/.test(a)) defects.jsonLeak.push(pr);
    if (/\b(maha)?dasha\b/i.test(a) && !PLANETS.test(a)) defects.dashaNoPlanet.push(pr);
    if (!CITES.test(a) && words(a) > 40) defects.noCitation.push(pr);

    // Short follow-up whose answer shares no topic with the previous
    // answer = the thread was probably dropped.
    if (words(q) <= 5 && pr.prevA && pr.prevA.text) {
      const now = topicsOf(a);
      const before = topicsOf(pr.prevA.text);
      if (now.length && before.length && !now.some((t) => before.includes(t))) {
        defects.threadLoss.push(pr);
      }
    }

    const fp = norm(a).slice(0, 110);
    if (!answerFingerprints.has(fp)) answerFingerprints.set(fp, []);
    answerFingerprints.get(fp).push(pr);
  }
  const templated = [...answerFingerprints.values()].filter((g) => g.length > 1);

  // ── print ──
  const L = (k, v) => console.log(`  ${k.padEnd(34)} ${v}`);
  console.log(`\n=== MOKSHA TRAFFIC — ${span} (${rows.length} rows, limit ${LIMIT}) ===\n`);

  console.log('USER BEHAVIOUR');
  L('unique users', byUid.size);
  L('user questions', userMsgs.length);
  L('answered exchanges', `${answered.length} (${pct(answered.length, userMsgs.length)})`);
  L('msgs/user p50 / p90 / max', `${p(0.5)} / ${p(0.9)} / ${perUser.at(-1) || 0}`);
  L('sessions (30min gap)', [...sessionsPerUid.values()].reduce((a, b) => a + b, 0));
  L('short follow-ups (<=5 words)', `${shortFollowups.length} (${pct(shortFollowups.length, userMsgs.length)})`);
  L('Hinglish / Devanagari', `${hinglish.length} (${pct(hinglish.length, userMsgs.length)})`);
  L('users repeating a question', `${repeats.size} (${pct(repeats.size, byUid.size)})`);
  L('single-question users', `${perUser.filter((n) => n <= 2).length} (${pct(perUser.filter((n) => n <= 2).length, byUid.size)})`);

  console.log('\nTOPIC MIX (user questions)');
  Object.entries(topicCount).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => L(t, `${n} (${pct(n, userMsgs.length)})`));

  console.log('\nPEAK HOURS (IST)');
  const peak = hours.map((n, h) => [h, n]).sort((a, b) => b[1] - a[1]).slice(0, 5);
  peak.forEach(([h, n]) => L(`${String(h).padStart(2, '0')}:00`, `${n} msgs`));

  console.log(`\nANSWER DEFECTS (of ${answered.length} answered)`);
  L('timing Q with NO date/window', `${defects.timingNoWindow.length} (${pct(defects.timingNoWindow.length, answered.length)})`);
  L('vague-evasion phrases', `${defects.vague.length} (${pct(defects.vague.length, answered.length)})`);
  L('raw JSON leaked to user', `${defects.jsonLeak.length} (${pct(defects.jsonLeak.length, answered.length)})`);
  L('dasha named, no planet', `${defects.dashaNoPlanet.length} (${pct(defects.dashaNoPlanet.length, answered.length)})`);
  L('no classical citation', `${defects.noCitation.length} (${pct(defects.noCitation.length, answered.length)})`);
  L('follow-up lost the thread', `${defects.threadLoss.length} (${pct(defects.threadLoss.length, answered.length)})`);
  L('empty answers', defects.empty.length);
  L('templated (identical openings)', `${templated.length} groups, ${templated.reduce((a, g) => a + g.length, 0)} answers`);

  if (dump.data.subscriptions && Array.isArray(dump.data.subscriptions.items)) {
    const byPlan = {};
    for (const s of dump.data.subscriptions.items) {
      const k = PLAN_LABELS[s.plan] || s.plan || 'unknown';
      byPlan[k] = (byPlan[k] || 0) + 1;
    }
    console.log('\nSUBSCRIPTIONS (plan ids mapped to marketed names)');
    Object.entries(byPlan).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => L(k, n));
  }

  if (Object.keys(dump.errors).length) {
    console.log('\nENDPOINT ERRORS');
    Object.entries(dump.errors).forEach(([k, v]) => L(k, v));
  }

  if (SHARE) {
    console.log('\n--- REDACTED SUMMARY (safe to paste) ---');
    console.log(JSON.stringify({
      span,
      rows: rows.length,
      uniqueUsers: byUid.size,
      questions: userMsgs.length,
      answered: answered.length,
      shortFollowupPct: +pct(shortFollowups.length, userMsgs.length).replace('%', ''),
      hinglishPct: +pct(hinglish.length, userMsgs.length).replace('%', ''),
      topics: topicCount,
      defects: Object.fromEntries(Object.entries(defects).map(([k, v]) => [k, v.length])),
      templatedGroups: templated.length,
    }, null, 2));
    return;
  }

  // Worst offenders, with text — local only, never in --share mode.
  const show = (label, list) => {
    if (!list.length) return;
    console.log(`\n### ${label} — ${Math.min(5, list.length)} of ${list.length}`);
    for (const pr of list.slice(0, 5)) {
      console.log(`Q: ${pr.q.text.replace(/\s+/g, ' ').slice(0, 140)}`);
      console.log(`A: ${(pr.a ? pr.a.text : '').replace(/\s+/g, ' ').slice(0, 240)}\n`);
    }
  };
  show('TIMING QUESTIONS WITH NO WINDOW', defects.timingNoWindow);
  show('FOLLOW-UP LOST THE THREAD', defects.threadLoss);
  show('RAW JSON LEAKED', defects.jsonLeak);
  show('VAGUE EVASIONS', defects.vague);

  console.log(`\nRe-score without refetching:  node scripts/analyze-chats.mjs --offline`);
  console.log(`Shareable summary:            node scripts/analyze-chats.mjs --offline --share\n`);
}

const dump = OFFLINE
  ? JSON.parse(fs.readFileSync(DUMP, 'utf8'))
  : await collect();
analyse(dump);
