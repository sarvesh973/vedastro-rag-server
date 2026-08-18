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
function targetDate(input) {
  if (!input) return new Date();
  const p = engine.parseCivilDate(input);
  return new Date(p.year, p.month - 1, p.day);
}

// ── access rule (TUNABLE) ──
function canSeeReading(plan, period) {
  if (plan && plan !== 'free') return true; // any paid tier: everything
  return period === 'monthly';              // free: monthly overview only
}

// Deterministic teaser line for the free daily card (no LLM).
const TEASER = {
  favourable: 'A supportive day — lean into it.',
  neutral: 'A steady, ordinary day — keep to your plans.',
  caution: 'Go gently today — be patient, avoid rushed decisions.',
};

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
      const lang = (language || 'en').toString().slice(0, 12);
      const tgt = targetDate(date);
      const mulank = engine.mulank(birthDate);

      // Deterministic layer (always returned).
      let verdict, periodKey, built, det;
      if (period === 'daily') {
        det = engine.dayRating(birthDate, tgt);
        verdict = det.rating; periodKey = ymd(tgt);
        built = prompt.dailyPrompt(birthDate, tgt);
      } else if (period === 'weekly') {
        const mon = weekMonday(tgt);
        built = prompt.weeklyPrompt(birthDate, mon);
        det = built.span; verdict = det.overall; periodKey = ymd(mon);
      } else {
        built = prompt.monthlyPrompt(birthDate, tgt.getFullYear(), tgt.getMonth() + 1);
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
          teaser: TEASER[verdict] || TEASER.neutral,
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
      const { birthDate, date, question } = req.body || {};
      if (!birthDate) return res.status(400).json({ error: 'birthDate is required' });
      if (!question || typeof question !== 'string') {
        return res.status(400).json({ error: 'question is required' });
      }
      if (!(auth.isAdmin || canSeeReading(auth.plan, 'daily'))) {
        return res.status(403).json({ error: 'Upgrade to ask about your day', paywall: true, plan: auth.plan });
      }
      if (!auth.isAdmin && !await rateLimit(auth, 'chat', res)) return; // throttle via chat quota
      const tgt = targetDate(date);
      const built = prompt.askPrompt(birthDate, tgt, question.slice(0, 500));
      let answer = null;
      try { answer = await runLLM(generateResponse, built); }
      catch (e) { console.warn('[mulank/ask] LLM failed:', e.message); return res.status(503).json({ error: 'reading_unavailable' }); }
      res.json({ mulank: engine.mulank(birthDate), answer });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
}

module.exports = { registerMulankRoutes, canSeeReading, weekMonday };
