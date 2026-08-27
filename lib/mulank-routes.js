// =========================================
// MULANK — HTTP routes (reading + ask), with daily caching
// =========================================
//
// Wires the deterministic engine (./mulank) + LLM grounding
// (./mulank-prompt) into Express. Registered from index.js via:
//     require('./lib/mulank-routes').registerMulankRoutes(app, {
//       verifyAuth, rateLimit, firestoreDb, firebaseAdmin, generateResponse
//     });
//
// COST MODEL — the whole point of the caching here:
//   There are only 9 possible mulanks. A reading depends on
//   (mulank, canonical-period, language) — NOT on the individual user.
//   So the first request for a given (mulank, day, lang) generates ONCE
//   and every other user with that mulank is served the cached copy.
//   Ceiling ≈ 9 daily + 9 weekly + 9 monthly LLM calls per language, no
//   matter how many thousands of users. Live LLM is reserved for the
//   paid /mulank/ask follow-up, which reuses the normal chat rate-limit.
//
// PLAN GATING (your model): monthly overview is FREE; daily + weekly full
// readings are PAID. Free users still get the deterministic RATING as a
// teaser (🟢/🟡/🔴) so the daily card still pulls them back every day.
// Edit canSeeReading() to retune.
//
// GRACEFUL DEGRADATION: the deterministic numbers + verdict ALWAYS
// return, even if Gemini is down/unconfigured. The prose `reading` is
// then null with a soft `readingError`; the client shows the rating.

const engine = require('./mulank');
const prompt = require('./mulank-prompt');

// ── period canonicalisation (so all users share one cache entry) ──
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Monday of the ISO week containing `d`.
function weekMonday(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - dow);
  return x;
}
// "Today" must be IST, not the container's clock. Render runs UTC, so a
// bare `new Date()` is still on yesterday's date for the first 5h30m of
// every IST day — which is exactly when the 00:10 IST cron fires, and
// when night-owl users open the app. index.js does this correctly for
// horoscopes (timeZone: 'Asia/Kolkata' on every format call); mulank
// shipped without it. 'en-CA' formats as YYYY-MM-DD.
const IST = 'Asia/Kolkata';
function istToday() {
  const [y, m, d] = new Date()
    .toLocaleDateString('en-CA', { timeZone: IST })
    .split('-')
    .map(Number);
  return new Date(y, m - 1, d); // civil date; local getters round-trip
}

// How far from today a caller may ask for. Bounds cache-key fan-out:
// without this, an arbitrary `date` mints a fresh cache key (and a fresh
// LLM call) for every date a caller cares to enumerate.
const MAX_DATE_OFFSET_DAYS = 400;

function targetDate(input) {
  if (!input) return istToday();
  const p = engine.parseCivilDate(input);
  const d = new Date(p.year, p.month - 1, p.day);
  const drift = Math.abs(d - istToday()) / 86400000;
  if (drift > MAX_DATE_OFFSET_DAYS) {
    throw new Error(`date must be within ${MAX_DATE_OFFSET_DAYS} days of today`);
  }
  return d;
}

// Only these reach a cache key. `language` is caller-supplied, and the
// key is (mulank, period, periodKey, lang) — so an unvalidated value
// lets one account mint unlimited distinct keys, each a cache miss and
// therefore a fresh LLM call. Anything unrecognised collapses to 'en'.
const LANGS = { en: 'en', english: 'en', hi: 'hi', hindi: 'hi', hinglish: 'hinglish' };
function normaliseLang(input) {
  return LANGS[String(input || 'en').toLowerCase().trim()] || 'en';
}

// ── access rule (TUNABLE) ──
function canSeeReading(plan, period) {
  if (plan && plan !== 'free') return true; // any paid tier: everything
  return period === 'monthly';              // free: monthly overview only
}

// Teaser lines now live in the engine (engine.teaserFor) so they vary by
// mulank and rotate by date instead of being one fixed line per verdict.

// ── cache helpers (mirror the horoscope_cache pattern in index.js) ──
function cacheKey(mulank, period, periodKey, lang) {
  return `${mulank}_${period}_${periodKey}_${lang || 'en'}`.replace(/\s+/g, '_');
}
async function getCached(firestoreDb, key) {
  if (!firestoreDb) return null;
  try {
    const doc = await firestoreDb.doc(`mulank_cache/${key}`).get();
    if (doc.exists) return doc.data();
  } catch (e) { console.warn('[mulank cache] read:', e.message); }
  return null;
}
async function setCached(firestoreDb, firebaseAdmin, key, period, data) {
  if (!firestoreDb) return;
  const ttlHours = period === 'daily' ? 30 : period === 'weekly' ? 24 * 8 : 24 * 32;
  try {
    await firestoreDb.doc(`mulank_cache/${key}`).set({
      ...data,
      generatedAt: firebaseAdmin
        ? firebaseAdmin.firestore.FieldValue.serverTimestamp()
        : new Date(),
      expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
    });
  } catch (e) { console.warn('[mulank cache] write:', e.message); }
}

async function runLLM(generateResponse, built) {
  const text = await generateResponse(`${built.system}\n\n${built.user}`, {
    temperature: 0.5, // a little warmth/variety; still tightly grounded
  });
  return String(text || '').trim();
}

function registerMulankRoutes(app, deps) {
  const { verifyAuth, rateLimit, firestoreDb, firebaseAdmin, generateResponse } = deps;

  // POST /mulank/profile — pure calc, the "who you are" content.
  app.post('/mulank/profile', async (req, res) => {
    const auth = await verifyAuth(req, res);
    if (!auth) return;
    try {
      const { birthDate } = req.body || {};
      if (!birthDate) return res.status(400).json({ error: 'birthDate is required' });
      const profile = engine.profileFor(birthDate);
      const destiny = (() => { try { return engine.bhagyank(birthDate); } catch { return null; } })();
      res.json({ ...profile, bhagyank: destiny });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  // POST /mulank/reading — daily | weekly | monthly. Deterministic
  // numbers/verdict always; prose reading gated by plan + cached.
  app.post('/mulank/reading', async (req, res) => {
    const auth = await verifyAuth(req, res);
    if (!auth) return;
    try {
      const { birthDate, period = 'daily', date, language } = req.body || {};
      if (!birthDate) return res.status(400).json({ error: 'birthDate is required' });
      if (!['daily', 'weekly', 'monthly'].includes(period)) {
        return res.status(400).json({ error: 'period must be daily|weekly|monthly' });
      }
      const lang = normaliseLang(language);
      const tgt = targetDate(date);
      const mulank = engine.mulank(birthDate);

      // Deterministic layer (always returned).
      let verdict, periodKey, built, det;
      if (period === 'daily') {
        det = engine.dayRating(birthDate, tgt);
        verdict = det.rating; periodKey = ymd(tgt);
        built = prompt.dailyPrompt(birthDate, tgt, lang);
      } else if (period === 'weekly') {
        const mon = weekMonday(tgt);
        built = prompt.weeklyPrompt(birthDate, mon, lang);
        det = built.span; verdict = det.overall; periodKey = ymd(mon);
      } else {
        built = prompt.monthlyPrompt(birthDate, tgt.getFullYear(), tgt.getMonth() + 1, lang);
        det = built.span; verdict = det.overall;
        periodKey = `${tgt.getFullYear()}-${String(tgt.getMonth() + 1).padStart(2, '0')}`;
      }

      const unlocked = auth.isAdmin || canSeeReading(auth.plan, period);
      const base = {
        mulank, planet: engine.PLANET[mulank], period, periodKey,
        verdict, deterministic: det, locked: !unlocked, plan: auth.plan,
      };

      if (!unlocked) {
        return res.json({
          ...base,
          teaser: engine.teaserFor(mulank, verdict, tgt, period),
          reading: null,
          paywall: true,
        });
      }

      // Unlocked → serve cached prose, generate once per (mulank,period,key,lang).
      const key = cacheKey(mulank, period, periodKey, lang);
      const cached = await getCached(firestoreDb, key);
      if (cached && cached.reading) {
        return res.json({ ...base, reading: cached.reading, cached: true });
      }

      // Cache MISS — this is the only path that costs an LLM call, so it
      // is the only path that needs metering. Cached reads stay free and
      // unlimited: a user opening the home screen 50 times in a day must
      // never lose the card to a quota.
      // Metered via a silent res shim (rateLimit only touches res to send
      // its own 401/429). A hard 429 would make the client's getReading
      // return null and hide the card outright; degrading to the
      // deterministic numbers keeps something correct on screen.
      const sink = { status: () => sink, json: () => sink };
      if (!await rateLimit(auth, 'mulank_gen', sink)) {
        return res.json({ ...base, reading: null, readingError: 'rate_limited', cached: false });
      }

      let reading = null, readingError = null;
      try {
        reading = await runLLM(generateResponse, built);
        if (reading) await setCached(firestoreDb, firebaseAdmin, key, period, { reading, mulank, verdict });
      } catch (e) {
        console.warn('[mulank] LLM generation failed:', e.message);
        readingError = 'reading_unavailable';
      }
      res.json({ ...base, reading, readingError, cached: false });
    } catch (e) {
      console.error('[mulank/reading]', e);
      res.status(400).json({ error: e.message });
    }
  });

  // POST /mulank/ask — paid interactive follow-up. Live LLM, grounded in
  // today's context. Reuses the normal chat rate-limit as the throttle.
  app.post('/mulank/ask', async (req, res) => {
    const auth = await verifyAuth(req, res);
    if (!auth) return;
    try {
      const { birthDate, date, question, language } = req.body || {};
      if (!birthDate) return res.status(400).json({ error: 'birthDate is required' });
      if (!question || typeof question !== 'string') {
        return res.status(400).json({ error: 'question is required' });
      }
      if (!(auth.isAdmin || canSeeReading(auth.plan, 'daily'))) {
        return res.status(403).json({ error: 'Upgrade to ask about your day', paywall: true, plan: auth.plan });
      }
      if (!auth.isAdmin && !await rateLimit(auth, 'chat', res)) return; // throttle via chat quota
      const tgt = targetDate(date);
      const built = prompt.askPrompt(birthDate, tgt, question.slice(0, 500), normaliseLang(language));
      let answer = null;
      try { answer = await runLLM(generateResponse, built); }
      catch (e) { console.warn('[mulank/ask] LLM failed:', e.message); return res.status(503).json({ error: 'reading_unavailable' }); }
      res.json({ mulank: engine.mulank(birthDate), answer });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}

// ── pre-generation (morning cron) ──────────────────────────────
// Warm the cache for all 9 mulanks × requested periods × languages so
// the first user of the day never waits. Idempotent: skips entries that
// are already cached. Total LLM calls ≤ 9 × periods × languages.
async function preGenerateMulank(deps, opts = {}) {
  const { firestoreDb, firebaseAdmin, generateResponse } = deps;
  const periods = opts.periods && opts.periods.length ? opts.periods : ['daily'];
  const languages = opts.languages && opts.languages.length ? opts.languages : ['en'];
  const tgt = targetDate(opts.date);
  const label = `[MULANK CRON ${periods.join('+')}]`;
  let generated = 0, skipped = 0, failed = 0;
  const t0 = Date.now();

  for (const period of periods) {
    for (let m = 1; m <= 9; m++) {
      let built, periodKey;
      if (period === 'daily') {
        periodKey = ymd(tgt); built = prompt.dailyPromptForMulank(m, tgt, null);
      } else if (period === 'weekly') {
        const mon = weekMonday(tgt);
        periodKey = ymd(mon); built = prompt.weeklyPromptForMulank(m, mon, null);
      } else {
        periodKey = `${tgt.getFullYear()}-${String(tgt.getMonth() + 1).padStart(2, '0')}`;
        built = prompt.monthlyPromptForMulank(m, tgt.getFullYear(), tgt.getMonth() + 1, null);
      }
      for (const lang of languages) {
        const built2 = { ...built };
        if (lang && lang !== 'en') built2.user = built.user + prompt.langLine(lang);
        const key = cacheKey(m, period, periodKey, lang);
        const existing = await getCached(firestoreDb, key);
        if (existing && existing.reading) { skipped++; continue; }
        try {
          const reading = await runLLM(generateResponse, built2);
          if (reading) {
            await setCached(firestoreDb, firebaseAdmin, key, period, { reading, mulank: m });
            generated++;
            console.log(`${label} ✓ mulank ${m} ${lang}`);
          } else { failed++; }
        } catch (e) {
          failed++;
          console.warn(`${label} ✗ mulank ${m} ${lang}: ${e.message}`);
        }
        await new Promise(r => setTimeout(r, 2000)); // gentle pacing
      }
    }
  }
  console.log(`${label} done generated=${generated} skipped=${skipped} failed=${failed} elapsed=${Math.round((Date.now() - t0) / 1000)}s`);
  return { generated, skipped, failed };
}

module.exports = {
  registerMulankRoutes, canSeeReading, weekMonday, preGenerateMulank,
  // exported for tests:
  istToday, targetDate, normaliseLang, ymd,
};
