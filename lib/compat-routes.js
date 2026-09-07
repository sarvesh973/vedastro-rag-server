// =========================================
// COMPATIBILITY — HTTP routes (reading + ask)
// =========================================
//
// Wires the deterministic Ashtakoot engine (./ashtakoot) into Express.
// Registered from index.js:
//     require('./lib/compat-routes').registerCompatRoutes(app, {
//       verifyAuth, rateLimit, firestoreDb, firebaseAdmin,
//       generateResponse, calculateChart, geocodePlace,
//     });
//
// COST MODEL — same trick as mulank. The prose depends only on the two
// (nakshatra, rashi) pairs and the language, NOT on who the users are. So
// two couples with the same Moon placements share one cache entry. Ceiling
// is bounded by 27x27 nakshatra pairs rather than by user count.
//
// SCOPE — read before extending. This describes a DYNAMIC BETWEEN TWO
// CHARTS. It must never assert that a named partner is unfaithful,
// dishonest, or of bad character. That person is not a user, has not
// consented, and cannot answer back; a screenshot of this app calling
// someone a cheat is a real harm and a brand problem. The "loyalty" framing
// is answered honestly by describing what commitment LOOKS LIKE for each
// temperament, which is real classical material and a better hook anyway.

const engine = require('./ashtakoot');

// Archetype per nakshatra, in engine order. Deliberately short and
// identity-shaped: people share "I'm The Anchor, they're The Spark", they
// do not share a score. This is the viral surface of the feature.
const ARCHETYPE = [
  'The Spark',       // Ashwini
  'The Furnace',     // Bharani
  'The Blade',       // Krittika
  'The Harvest',     // Rohini
  'The Seeker',      // Mrigashira
  'The Storm',       // Ardra
  'The Return',      // Punarvasu
  'The Nourisher',   // Pushya
  'The Coil',        // Ashlesha
  'The Throne',      // Magha
  'The Revel',       // Purva Phalguni
  'The Vow',         // Uttara Phalguni
  'The Craftsman',   // Hasta
  'The Jewel',       // Chitra
  'The Reed',        // Swati
  'The Ambition',    // Vishakha
  'The Devotee',     // Anuradha
  'The Elder',       // Jyeshtha
  'The Root',        // Mula
  'The Undefeated',  // Purva Ashadha
  'The Victor',      // Uttara Ashadha
  'The Listener',    // Shravana
  'The Drum',        // Dhanishta
  'The Veil',        // Shatabhisha
  'The Firebrand',   // Purva Bhadrapada
  'The Still Water', // Uttara Bhadrapada
  'The Voyager',     // Revati
];

// Sanskrit kuta -> what a normal person would call it. Shown alongside the
// traditional name, not instead of it.
const FRIENDLY = {
  'Varna': 'Life approach',
  'Vashya': 'Influence',
  'Tara': 'Wellbeing',
  'Yoni': 'Physical chemistry',
  'Graha Maitri': 'Mental connection',
  'Gana': 'Temperament',
  'Bhakoot': 'Emotional direction',
  'Nadi': 'Health and vitality',
};

// Traffic light per kuta, from its share of its own maximum. This is what
// makes the result screenshot-able - eight rows people can argue about.
function verdictOf(k) {
  const r = k.max ? k.points / k.max : 0;
  if (r >= 0.75) return 'strong';
  if (r >= 0.4) return 'mixed';
  return 'friction';
}

function cacheKey(a, b, lang) {
  // Order-independent: the engine is symmetric, so A+B and B+A must share
  // one entry rather than generating the same prose twice.
  const pair = [`${a.nakshatra}_${a.rashi}`, `${b.nakshatra}_${b.rashi}`]
    .sort().join('__');
  return `${pair}__${lang || 'en'}`.replace(/\s+/g, '_');
}

async function getCached(firestoreDb, key) {
  if (!firestoreDb) return null;
  try {
    const doc = await firestoreDb.doc(`compat_cache/${key}`).get();
    if (doc.exists) return doc.data();
  } catch (e) { console.warn('[compat cache] read:', e.message); }
  return null;
}
async function setCached(firestoreDb, firebaseAdmin, key, data) {
  if (!firestoreDb) return;
  try {
    await firestoreDb.doc(`compat_cache/${key}`).set({
      ...data,
      generatedAt: firebaseAdmin
        ? firebaseAdmin.firestore.FieldValue.serverTimestamp()
        : new Date(),
    });
  } catch (e) { console.warn('[compat cache] write:', e.message); }
}

const SYSTEM = `You are Moksha's compatibility guide, writing about two people's Vedic charts.

ABSOLUTE RULES:
1. The score and every kuta result are ALREADY CALCULATED and given to you.
   Treat them as fixed. NEVER recompute, contradict, or soften them.
2. Write about the PAIR, never a verdict on one person. You may say "you two
   move at different speeds"; you may NEVER say or imply that either person
   is unfaithful, dishonest, untrustworthy, or of bad character. That person
   is not here to answer, and you cannot see character in a chart.
3. No predictions about whether the relationship lasts, ends, or should.
   Describe the dynamic and what each person needs. The reader decides.
4. If asked about loyalty or trust, answer what COMMITMENT LOOKS LIKE for
   each temperament - what makes each feel secure, what reads as distance to
   them. Never answer whether someone will be faithful.
5. Be specific to these numbers. No filler, no generic relationship advice.
6. Warm, direct, a little playful. This is meant to be read aloud to the
   other person and screenshotted, so write something worth sharing.`;

function buildPrompt(result, a, b, names, lang) {
  const rows = result.kutas
    .map(k => `- ${k.label} (${FRIENDLY[k.label]}): ${k.points}/${k.max} — ${k.note}`)
    .join('\n');
  const langLine = String(lang || '').toLowerCase().startsWith('en')
    ? '\n\nWrite in English.'
    : '\n\nWrite in Hinglish (natural Roman-script Hindi-English mix).';

  return {
    system: SYSTEM,
    user: `Write a compatibility reading for these two.

PERSON 1${names.a ? ` (${names.a})` : ''}: Moon in ${a.nakshatra} nakshatra, ${a.rashi} — archetype "${ARCHETYPE[engine.nakIndex(a.nakshatra)]}"
PERSON 2${names.b ? ` (${names.b})` : ''}: Moon in ${b.nakshatra} nakshatra, ${b.rashi} — archetype "${ARCHETYPE[engine.nakIndex(b.nakshatra)]}"

SCORE: ${result.total} of 36 (${result.percent}%) — ${result.band}
${rows}

Produce, as plain prose with no headings:
1. Two or three sentences on the core dynamic, using both archetypes.
2. The single strongest thing between them, naming the kuta it comes from.
3. The single biggest friction, named plainly - do not soften it into a
   "growth opportunity". Say what it actually costs them day to day.
4. What commitment looks like for each of them: what makes each feel
   secure, and what the other might misread as distance.
Keep it under 220 words.${langLine}`,
  };
}

function registerCompatRoutes(app, deps) {
  const { verifyAuth, rateLimit, firestoreDb, firebaseAdmin,
    generateResponse, calculateChart, geocodePlace } = deps;

  // Resolve birth details to the Moon nakshatra + rashi the engine needs.
  async function moonOf({ birthDate, birthTime, place, lat, lon }) {
    if (!birthDate || !birthTime) throw new Error('birth date and time are required');
    let coords = { lat, lon };
    if ((!coords.lat || !coords.lon) && place) coords = await geocodePlace(place);
    if (!coords || !coords.lat || !coords.lon) throw new Error('place or lat/lon required');
    const chart = calculateChart(birthDate, birthTime, coords.lat, coords.lon);
    if (!chart || !chart.planets || !chart.planets.Moon) throw new Error('chart calculation failed');
    return { nakshatra: chart.planets.Moon.nakshatra, rashi: chart.planets.Moon.sign };
  }

  // POST /compat/reading
  app.post('/compat/reading', async (req, res) => {
    const auth = await verifyAuth(req, res);
    if (!auth) return;
    try {
      const { you = {}, partner = {}, partnerName, yourName, language } = req.body || {};
      const a = await moonOf(you);
      const b = await moonOf(partner);
      const result = engine.ashtakoot(a, b);

      const dimensions = result.kutas.map(k => ({
        label: k.label,
        friendly: FRIENDLY[k.label] || k.label,
        points: k.points,
        max: k.max,
        verdict: verdictOf(k),
        note: k.note,
      }));

      const archetypes = {
        you: ARCHETYPE[engine.nakIndex(a.nakshatra)],
        partner: ARCHETYPE[engine.nakIndex(b.nakshatra)],
      };

      // Free tier gets the score, the archetypes and the dimension bars -
      // everything screenshot-able. The written reading is the upsell.
      const unlocked = auth.isAdmin || (auth.plan && auth.plan !== 'free');
      const base = {
        total: result.total, max: 36, percent: result.percent, band: result.band,
        archetypes, dimensions,
        moons: { you: a, partner: b },
        locked: !unlocked, plan: auth.plan,
      };

      if (!unlocked) {
        return res.json({ ...base, reading: null, paywall: true });
      }

      const lang = String(language || 'en').toLowerCase().startsWith('en') ? 'en' : 'hinglish';
      const key = cacheKey(a, b, lang);
      const cached = await getCached(firestoreDb, key);
      if (cached && cached.reading) {
        return res.json({ ...base, reading: cached.reading, cached: true });
      }

      if (!auth.isAdmin && !await rateLimit(auth, 'mulank_gen', res)) return;

      let reading = null, readingError = null;
      try {
        const built = buildPrompt(result, a, b, { a: yourName, b: partnerName }, lang);
        const text = await generateResponse(`${built.system}\n\n${built.user}`, { temperature: 0.5 });
        reading = String(text || '').trim() || null;
        if (reading) await setCached(firestoreDb, firebaseAdmin, key, { reading, total: result.total });
      } catch (e) {
        console.warn('[compat] generation failed:', e.message);
        readingError = 'reading_unavailable';
      }

      return res.json({ ...base, reading, readingError, cached: false });
    } catch (e) {
      console.error('[compat/reading]', e.message);
      return res.status(400).json({ error: e.message });
    }
  });

  // POST /compat/ask — questions about the dynamic.
  //
  // Its own voice, like /palm/ask. No corpus, no citations, and a hard
  // refusal on "is my partner cheating" style questions - answering those
  // from a birth chart is both unfounded and the thing most likely to cause
  // real damage between two real people.
  app.post('/compat/ask', async (req, res) => {
    const auth = await verifyAuth(req, res);
    if (!auth) return;
    try {
      const { question, you = {}, partner = {}, partnerName, chatHistory, language } = req.body || {};
      if (!question || typeof question !== 'string') {
        return res.status(400).json({ error: 'question is required' });
      }
      if (!(auth.isAdmin || (auth.plan && auth.plan !== 'free'))) {
        return res.status(403).json({ error: 'Upgrade to ask about your match', paywall: true, plan: auth.plan });
      }
      if (!auth.isAdmin && !await rateLimit(auth, 'chat', res)) return;

      const a = await moonOf(you);
      const b = await moonOf(partner);
      const result = engine.ashtakoot(a, b);
      const rows = result.kutas
        .map(k => `- ${k.label} (${FRIENDLY[k.label]}): ${k.points}/${k.max}`)
        .join('\n');
      const history = Array.isArray(chatHistory) && chatHistory.length
        ? `\n\nRECENT CONVERSATION:\n${chatHistory.slice(-6).join('\n')}`
        : '';

      const prompt = `${SYSTEM}

THE MATCH (already calculated, treat as fixed):
Person 1: ${a.nakshatra}, ${a.rashi} — "${ARCHETYPE[engine.nakIndex(a.nakshatra)]}"
Person 2${partnerName ? ` (${partnerName})` : ''}: ${b.nakshatra}, ${b.rashi} — "${ARCHETYPE[engine.nakIndex(b.nakshatra)]}"
Score: ${result.total}/36 (${result.band})
${rows}${history}

THEIR QUESTION: ${question.slice(0, 500)}

Answer in 2-4 short bullets, grounded in the numbers above.
If the question asks whether the other person is cheating, lying, or will
betray them, do NOT answer it. Say plainly that a chart cannot show that
about anyone, and that you will not put that idea in their head about a
real person. Then offer what you CAN speak to: what each of them needs to
feel secure, and where this pairing tends to misread each other.
Answer in ${String(language || '').toLowerCase().startsWith('en') ? 'English' : 'Hinglish'}.`;

      let answer = null;
      try {
        answer = await generateResponse(prompt, { temperature: 0.4 });
      } catch (e) {
        console.warn('[compat/ask] LLM failed:', e.message);
        return res.status(503).json({ error: 'reading_unavailable' });
      }
      return res.json({ answer: String(answer || '').trim(), total: result.total, band: result.band });
    } catch (e) {
      console.error('[compat/ask]', e.message);
      return res.status(400).json({ error: e.message });
    }
  });
}

module.exports = {
  registerCompatRoutes,
  // exported for tests:
  ARCHETYPE, FRIENDLY, verdictOf, cacheKey,
};
