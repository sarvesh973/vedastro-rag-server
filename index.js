const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getKundli, Observer } = require('@prisri/jyotish');
// Timezone-correct birth-time handling: geo-tz maps lat/lon -> IANA
// timezone, luxon converts local birth time -> UTC with historical DST.
const { find: geoTzFind } = require('geo-tz');
const { DateTime } = require('luxon');

const app = express();
app.use(cors());
// 8mb limit accommodates palm reading base64 images (~5MB raw → ~7MB base64)
// while still blocking absurdly large payloads.
// Razorpay webhook needs the RAW body (not parsed JSON) so its HMAC
// signature can be verified against the bytes Razorpay actually signed.
// Mount the raw parser BEFORE express.json so it wins for that path.
// Without this, express.json turns req.body into an Object and HMAC
// verification crashes with: 'data argument must be string/Buffer/...'
app.use('/subscription/webhook', express.raw({ type: 'application/json', limit: '1mb' }));

app.use(express.json({ limit: '8mb' }));

// =========================================
// FIREBASE ADMIN SDK
// =========================================
// Used by the Razorpay webhook handler to mark users premium / cancelled
// in Firestore based on subscription events. Requires
// FIREBASE_SERVICE_ACCOUNT_JSON env var (paste the entire JSON from
// Firebase Console -> Project Settings -> Service Accounts -> Generate
// new private key).
//
// Lazy-loaded with a try/catch so the server still boots if the JSON or
// the firebase-admin package is missing — affected endpoints return a
// clear "not configured" error instead of crashing the whole process.
let firebaseAdmin = null;
let firestoreDb = null;
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const admin = require('firebase-admin');
    if (!admin.apps.length) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      console.log(`[firebase-admin] Initialized for project: ${serviceAccount.project_id}`);
    }
    firebaseAdmin = admin;
    firestoreDb = admin.firestore();
  } else {
    console.warn('[firebase-admin] FIREBASE_SERVICE_ACCOUNT_JSON not set — webhook -> Firestore sync disabled');
  }
} catch (e) {
  console.error('[firebase-admin] Init failed:', e.message);
}

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY || 'vedastro2024';

// =========================================
// FOUNDER / ADMIN BYPASS
// =========================================
// Emails that bypass paywalls + quota limits. MUST match the list in
// the Flutter client at lib/config/api_config.dart -> adminEmails.
// Comparison is case-insensitive (everything normalized to lowercase).
//
// SECURITY: anyone can pass any string as `userEmail` in a request body,
// so this list alone doesn't authenticate the caller. To prevent spoofing,
// the production version should verify a Firebase ID token from the
// Authorization header and read the email claim from the verified token.
// For now we trust the body (single-developer admin usage). Add Firebase
// Admin SDK verification before the public launch.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'sarry1254@gmail.com')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

function isAdminEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

// =========================================
// FIREBASE AUTH MIDDLEWARE — verify ID token
// =========================================
// Every protected endpoint MUST call verifyAuth() before doing anything.
// Returns { uid, email, plan, isAdmin } on success; sends 401 + returns null on failure.
//
// SECURITY: this replaces trusting client-supplied userEmail. The email here
// comes from a Firebase-signed token, so users can't spoof admin status.
async function verifyAuth(req, res, { allowAnonymous = false } = {}) {
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/);
  if (!match) {
    if (allowAnonymous) return { uid: null, email: null, plan: 'anonymous', isAdmin: false };
    res.status(401).json({ error: 'Missing Authorization: Bearer <Firebase ID token>' });
    return null;
  }
  if (!firebaseAdmin) {
    res.status(503).json({ error: 'Auth not configured on server (FIREBASE_SERVICE_ACCOUNT_JSON missing)' });
    return null;
  }
  try {
    const decoded = await firebaseAdmin.auth().verifyIdToken(match[1]);
    const email = (decoded.email || '').toLowerCase();

    // Look up user's plan from Firestore (used for rate-limit tier)
    let plan = 'free';
    try {
      if (firestoreDb) {
        const usageDoc = await firestoreDb.doc(`usage/${decoded.uid}`).get();
        if (usageDoc.exists && usageDoc.data().plan) plan = usageDoc.data().plan;
      }
    } catch (_) {}

    return {
      uid: decoded.uid,
      email,
      plan,
      isAdmin: isAdminEmail(email),
    };
  } catch (e) {
    console.warn('[auth] Token verification failed:', e.message);
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
}

// =========================================
// PER-UID RATE LIMITER — Firestore counters
// =========================================
// Daily caps per UID per action. Admins always allowed.
// Returns true if allowed; sends 429 + returns false if over limit.
const RATE_LIMITS = {
  free:        { chat: 5,   palm: 1,  horoscope: 30,  chart: 10,  search: 20 },
  trial:       { chat: 50,  palm: 5,  horoscope: 60,  chart: 60,  search: 100 },
  standard:    { chat: 100, palm: 15, horoscope: 100, chart: 100, search: 200 },
  premium:     { chat: 500, palm: 50, horoscope: 500, chart: 200, search: 500 },
  anonymous:   { chat: 0,   palm: 0,  horoscope: 0,   chart: 0,   search: 0 },
};

async function rateLimit(auth, action, res) {
  if (!auth || auth.isAdmin) return true;          // Admins skip
  if (!firestoreDb) return true;                    // Fail open if Firestore not configured
  const tier = RATE_LIMITS[auth.plan] || RATE_LIMITS.free;
  const limit = tier[action];
  if (limit === undefined || limit < 0) return true;
  if (limit === 0) {
    res.status(401).json({ error: 'Login required for this feature' });
    return false;
  }

  const today = new Date().toISOString().slice(0, 10);
  const ref = firestoreDb.doc(`rate_limits/${auth.uid}_${today}`);
  try {
    const result = await firestoreDb.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      const data = doc.exists ? doc.data() : {};
      const used = data[action] || 0;
      if (used >= limit) return { allowed: false, used, limit };
      tx.set(ref, {
        ...data,
        [action]: used + 1,
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        // 48h TTL — Firestore TTL policy on `expiresAt` deletes it
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      }, { merge: true });
      return { allowed: true, used: used + 1, limit };
    });

    if (!result.allowed) {
      res.status(429).json({
        error: `Daily ${action} limit reached (${result.used}/${result.limit}). Upgrade your plan for more.`,
        used: result.used,
        limit: result.limit,
        plan: auth.plan,
      });
      return false;
    }
    return true;
  } catch (e) {
    console.error('[rateLimit] error:', e.message);
    return true; // fail open — don't block users on infra error
  }
}

// =========================================
// HOROSCOPE CACHE — server-side per (sign × period × date)
// =========================================
function horoscopePeriodKey(period) {
  const d = new Date();
  if (period === 'daily' || period === 'tomorrow') {
    if (period === 'tomorrow') d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (period === 'weekly') {
    const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dayNum = (tmp.getUTCDay() + 6) % 7;
    tmp.setUTCDate(tmp.getUTCDate() - dayNum);
    return tmp.toISOString().slice(0, 10);
  }
  if (period === 'monthly') return d.toISOString().slice(0, 7);
  return d.toISOString().slice(0, 10);
}

async function getCachedHoroscope(sign, period, language) {
  if (!firestoreDb) return null;
  const key = `${sign.toLowerCase()}_${period}_${language || 'hinglish'}_${horoscopePeriodKey(period)}`.replace(/\s+/g, '_');
  try {
    const doc = await firestoreDb.doc(`horoscope_cache/${key}`).get();
    if (doc.exists) return doc.data();
  } catch (e) {
    console.warn('[cache] read error:', e.message);
  }
  return null;
}

async function setCachedHoroscope(sign, period, data, language) {
  if (!firestoreDb) return;
  const key = `${sign.toLowerCase()}_${period}_${language || 'hinglish'}_${horoscopePeriodKey(period)}`.replace(/\s+/g, '_');
  const ttlHours = period === 'daily' || period === 'tomorrow' ? 30 : period === 'weekly' ? 24 * 8 : 24 * 32;
  try {
    await firestoreDb.doc(`horoscope_cache/${key}`).set({
      ...data,
      generatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000),
    });
  } catch (e) {
    console.warn('[cache] write error:', e.message);
  }
}

// Hard caps to prevent prompt-injection cost attacks
const MAX_QUESTION_LEN = 500;

// =========================================
// ADMIN ENDPOINT GUARD — Firebase auth + isAdmin
// =========================================
// Replaces the weak ?key=ADMIN_KEY query param check (which was hardcoded
// in the public repo and brute-forceable). Now requires:
//  1. Valid Firebase ID token in Authorization header
//  2. Token's email is in ADMIN_EMAILS list
//
// LEGACY FALLBACK: still accepts ?key=ADMIN_KEY if firebase-admin isn't
// configured yet, so admin dashboard doesn't break during Render config
// migration. Remove this fallback once FIREBASE_SERVICE_ACCOUNT_JSON is set.
async function requireAdmin(req, res) {
  // Legacy fallback for setup phase only
  if (!firebaseAdmin && req.query.key === ADMIN_KEY) {
    return { uid: 'legacy-admin', email: 'legacy-admin', isAdmin: true };
  }
  const auth = await verifyAuth(req, res);
  if (!auth) return null;
  if (!auth.isAdmin) {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }
  return auth;
}

// =========================================
// RAZORPAY SUBSCRIPTIONS (configured per env)
// =========================================
// Plan IDs are created on dashboard.razorpay.com -> Subscriptions -> Plans
// then set in Render env vars. Falls back to placeholders for dev.
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';
const RAZORPAY_PLAN_TRIAL = process.env.RAZORPAY_PLAN_TRIAL || 'plan_trial_99_placeholder';
const RAZORPAY_PLAN_STANDARD = process.env.RAZORPAY_PLAN_STANDARD || 'plan_standard_199_placeholder';
const RAZORPAY_PLAN_PREMIUM = process.env.RAZORPAY_PLAN_PREMIUM || 'plan_premium_499_placeholder';
const isRazorpayConfigured = !!(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET);
if (!isRazorpayConfigured) {
  console.warn('[Razorpay] keys not set — subscription endpoints will return 503 until configured');
}

// Auto-close unbalanced { and [ in a JSON-ish string. Gemini sometimes
// truncates a response mid-array or mid-object — closing the openers in
// reverse order is usually enough to rescue the structure.
//
// Walks character-by-character respecting string literals + escapes so
// braces/brackets inside strings don't confuse the counter.
function balanceJsonBrackets(s) {
  if (!s || typeof s !== 'string') return s;
  const stack = [];
  let inStr = false, esc = false;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { out += c; inStr = true; continue; }
    if (c === '{' || c === '[') { stack.push(c); out += c; continue; }
    if (c === '}' || c === ']') {
      const top = stack[stack.length - 1];
      if ((c === '}' && top === '{') || (c === ']' && top === '[')) {
        stack.pop();
        out += c;
      } else if (top) {
        // Mismatched closer (e.g. `}` while still inside an array) —
        // auto-close the inner container first, then re-process this
        // character against the now-exposed parent.
        out += top === '{' ? '}' : ']';
        stack.pop();
        i--;
      }
      // No opener at all → drop the stray closer.
      continue;
    }
    out += c;
  }
  out = out.replace(/,(\s*)$/, '$1');
  while (stack.length) {
    const opener = stack.pop();
    out += opener === '{' ? '}' : ']';
  }
  return out;
}

// =========================================
// CONVERSATION STORE (in-memory admin log)
// =========================================
const conversationStore = new Map();
const MAX_CONVERSATION_USERS = 200; // Cap memory — keep only last 200 users
// Key: userIdentifier (name+place), Value: { profile, messages[], firstSeen, lastSeen }

// =========================================
// HOROSCOPE CACHE (pre-generated per sign)
// =========================================
const horoscopeCache = new Map();
// Key: "aries_daily_2026-04-15", Value: { data, generatedAt }

const ZODIAC_SIGNS = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
];

// Map Sanskrit / Vedic rashi names (as the Flutter app sends them, e.g.
// "Mesha (Aries)", "Vrishabha (Taurus)") back to the English key the cache
// and validation use. Also accepts plain English input.
const SANSKRIT_TO_ENGLISH = {
  'mesha': 'Aries', 'vrishabha': 'Taurus', 'vrishabh': 'Taurus',
  'mithuna': 'Gemini', 'mithun': 'Gemini',
  'karka': 'Cancer', 'kark': 'Cancer',
  'simha': 'Leo', 'sinh': 'Leo',
  'kanya': 'Virgo',
  'tula': 'Libra',
  'vrishchika': 'Scorpio', 'vrischika': 'Scorpio', 'vrishchik': 'Scorpio',
  'dhanu': 'Sagittarius', 'dhanus': 'Sagittarius',
  'makara': 'Capricorn', 'makar': 'Capricorn',
  'kumbha': 'Aquarius', 'kumbh': 'Aquarius',
  'meena': 'Pisces', 'meen': 'Pisces',
};

function normalizeSign(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // 1) Parenthesized English: "Mesha (Aries)" → "Aries"
  const paren = s.match(/\(([^)]+)\)/);
  if (paren) {
    const candidate = paren[1].trim();
    const match = ZODIAC_SIGNS.find(z => z.toLowerCase() === candidate.toLowerCase());
    if (match) return match;
  }
  // 2) Plain English input
  const plain = ZODIAC_SIGNS.find(z => z.toLowerCase() === s.toLowerCase());
  if (plain) return plain;
  // 3) Plain Sanskrit input (no parens)
  const firstWord = s.split(/\s+/)[0].toLowerCase();
  if (SANSKRIT_TO_ENGLISH[firstWord]) return SANSKRIT_TO_ENGLISH[firstWord];
  return null;
}
const HOROSCOPE_PERIODS = ['daily', 'tomorrow', 'weekly', 'monthly'];

function storeConversation(userProfile, birthDate, birthTime, place, question, answer, chartUsed, sources) {
  // Create a user key from profile info
  const userKey = `${(place || 'unknown').toLowerCase().trim()}_${(birthDate || '').trim()}`;

  // Extract name from profile string
  let userName = 'Anonymous';
  if (userProfile) {
    const nameMatch = userProfile.match(/(?:Name|name)[:\s]*([^\n,|]+)/i);
    if (nameMatch) userName = nameMatch[1].trim();
  }

  if (!conversationStore.has(userKey)) {
    // Cap memory: remove oldest user if at limit
    if (conversationStore.size >= MAX_CONVERSATION_USERS) {
      let oldestKey = null, oldestTime = Infinity;
      for (const [k, v] of conversationStore) {
        if (v.lastSeen.getTime() < oldestTime) {
          oldestTime = v.lastSeen.getTime();
          oldestKey = k;
        }
      }
      if (oldestKey) conversationStore.delete(oldestKey);
    }

    conversationStore.set(userKey, {
      userName,
      userProfile: userProfile || '',
      birthDate: birthDate || '',
      birthTime: birthTime || '',
      place: place || '',
      firstSeen: new Date(),
      lastSeen: new Date(),
      messages: [],
      totalQuestions: 0,
    });
  }

  const user = conversationStore.get(userKey);
  user.lastSeen = new Date();
  user.totalQuestions++;
  user.messages.push({
    role: 'user',
    text: question,
    timestamp: new Date(),
  });
  user.messages.push({
    role: 'ai',
    text: answer,
    timestamp: new Date(),
    chartUsed: chartUsed || false,
    sourcesCount: sources ? sources.length : 0,
  });
}

// --- LOAD KNOWLEDGE BASE ---
let knowledgeBase = null;

function loadKnowledgeBase() {
  if (knowledgeBase) return knowledgeBase;
  try {
    knowledgeBase = require('./knowledge_base.json');
    console.log(`Knowledge base loaded: ${knowledgeBase.length} chunks`);
  } catch (e) {
    console.error('Failed to load knowledge base:', e.message);
    knowledgeBase = [];
  }
  return knowledgeBase;
}

// --- VECTOR SIMILARITY ---
function cosineSimilarity(a, b) {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function findRelevantChunks(queryEmbedding, chunks, topK = 8) {
  const scored = chunks.map(chunk => ({
    ...chunk,
    score: cosineSimilarity(queryEmbedding, chunk.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// ─────────── RAG SIGNAL ENHANCEMENT ───────────
//
// Goal: make the retrieval pull more topically-relevant chunks from the
// 549 indexed chunks (BPHS + Phaladeepika), without changing the corpus.
//
// Three signal upgrades layered on top of plain cosine similarity:
//
// 1. detectQuestionTopics(question) — classify the user's free-text
//    question into one or more astrology domains by keyword (career,
//    marriage, finance, health, children, spirituality, foreign, etc.)
//    Each domain maps to a vocab pack: classical Sanskrit terms +
//    relevant house numbers + planet names known from the shastras.
//
// 2. buildEnrichedQuery(question, chartData, topics) — concatenates
//    the user's literal text + chart facts + topic vocab. This is what
//    becomes the embedding query. Wider vocab => more BPHS / Phaladeepika
//    chunks score high on cosine, because the indexed text uses the same
//    Sanskrit/house terminology.
//
// 3. fetchAndDiversify(...) — pull TOP_K * 3 candidates first, then
//    apply MMR (Maximal Marginal Relevance) — pick chunks that are both
//    relevant AND distinct from each other. Prevents 8 results all
//    being from the same chapter when the question spans topics.

const TOPIC_VOCAB = {
  career: 'career profession job work karma karya 10th house dasamsa Saturn Mercury Sun Mars Karmesh dignity dasha bhukti professional success vocational rajyog',
  marriage: 'marriage wedding wife husband Kalatra 7th house saptamesh navamsha D9 Venus Jupiter Mars Mangal dosha vivah kalathra bhava commitment matrimony spouse legal union',
  romance: 'romance love attraction affection 5th house Purva Punya panchamesh Venus Moon Mars rati sringara emotional bond crush infatuation feelings heart desire',
  relationship: 'relationship girlfriend boyfriend dating partner companion 5th house 7th house Venus Mars Moon attraction connection bond intimate love affair courting',
  finance: 'wealth money finance dhana 2nd house 11th house labha Jupiter Mercury Venus dhanesh Lakshmi Kubera artha lakshmi yoga prosperity affluence',
  health: 'health body sickness disease 6th house ari Mars Sun Saturn Rahu Ketu roga arishta longevity arogya immunity ailment',
  children: 'children child progeny putra 5th house panchamesh Jupiter Sun Moon putra bhava santati offspring fertility',
  spirituality: 'spirituality moksha dharma 9th house 12th house Jupiter Ketu vimshamsha D20 sadhana meditation devotion gyana pilgrimage tapasya guru bhakti',
  foreign: 'foreign travel abroad relocation 12th house 9th house Rahu Mercury Saturn videsh yatra migration overseas pravas',
  education: 'education learning study vidya 4th house 5th house Mercury Jupiter Saraswati gyana research scholar academics',
  family: 'family mother father siblings 4th house 3rd house parents matri pitri Moon Sun Mars sukhabhava parivar relatives',
  litigation: 'litigation enemies dispute legal 6th house 8th house Mars Saturn Rahu shatru opponents court case lawsuit conflict',
  longevity: 'longevity lifespan age 1st house 8th house Saturn Mars ayur balarishta arishta yoga life span vitality',
  remedies: 'remedies upay mantra gemstone fasting daan donation puja worship parihara propitiation karmaphala spiritual practice',
  timing: 'timing when dasha bhukti antardasha transit gochara sade sati specific period years kaal time prediction event',
  personality: 'personality character nature swabhava 1st house lagna ascendant Sun Moon temperament aura disposition',
  general: 'rajayoga dhanayoga vipreet jeevan life general overall future destiny prarabdha karma fate fortune bhagya'
};

function detectQuestionTopics(question) {
  if (!question || typeof question !== 'string') return ['general'];
  const q = question.toLowerCase();
  const matches = [];

  const triggers = {
    career: /\b(career|job|work|profession|business|naukri|kaam|kaarya|karma|promotion|salary)\b/,
    marriage: /\b(marriage|marry|married|shaadi|vivah|wedding|matrimony|spouse|wife|husband|divorce|engaged|engagement|kab.*shaadi|when.*married|when.*marriage)\b/,
    romance: /\b(love|romance|romantic|crush|attraction|feelings|heart|pyaar|prem|ishq|mohabbat|infatuation|first love)\b/,
    relationship: /\b(girlfriend|boyfriend|gf|bf|dating|relationship|partner|companion|breakup|patch up|love affair|courting|committed)\b/,
    finance: /\b(money|wealth|rich|finance|financial|paisa|dhan|income|earnings|wealthy|debt|loan|investment|property)\b/,
    health: /\b(health|sick|illness|disease|bimari|swasth|fitness|medical|surgery|pain|recovery|treatment)\b/,
    children: /\b(child|children|baby|pregnant|pregnancy|bachcha|santan|santati|putra|son|daughter|conceive|fertility)\b/,
    spirituality: /\b(spiritual|moksha|dharma|god|bhagwan|meditation|sadhana|guru|enlightenment|devotion|bhakti|temple|pilgrimage)\b/,
    foreign: /\b(foreign|abroad|visa|videsh|country|migrate|migration|relocate|nri|overseas|usa|uk|canada|australia)\b/,
    education: /\b(study|education|exam|college|university|degree|padhai|vidya|learning|course|research|phd|scholar)\b/,
    family: /\b(family|mother|father|parent|maa|papa|mom|dad|brother|sister|bhai|behen|parivar|relative)\b/,
    litigation: /\b(court|case|legal|lawsuit|enemy|shatru|dispute|fight|conflict|police|crime|punishment)\b/,
    longevity: /\b(age|lifespan|long life|death|ayu|jeevan|live long|will i live)\b/,
    remedies: /\b(remedy|remedies|upay|upaay|mantra|gemstone|stone|ratna|fast|vrat|puja|donation|daan|parihara|solution|cure|fix)\b/,
    timing: /\b(when|kab|year|month|date|time|how long|after how|aaj|kal|abhi|future|jaldi|soon)\b/,
    personality: /\b(personality|nature|character|swabhav|kaisa hu|kaisa hoon|kaisi hu|who am i|tell me about myself)\b/,
  };

  for (const [topic, re] of Object.entries(triggers)) {
    if (re.test(q)) matches.push(topic);
  }
  return matches.length > 0 ? matches : ['general'];
}

function buildEnrichedQuery(question, chartData, topics) {
  const parts = [question];

  if (chartData) {
    const planets = Object.entries(chartData.planets)
      .map(([name, d]) => `${name} in ${d.sign} house ${d.house}`)
      .join(', ');
    parts.push(`${chartData.ascendant.sign} lagna`);
    parts.push(`${chartData.dasha.mahadasha} mahadasha ${chartData.dasha.antardasha || ''} antardasha`);
    parts.push(planets);
  }

  for (const topic of topics) {
    if (TOPIC_VOCAB[topic]) parts.push(TOPIC_VOCAB[topic]);
  }

  return parts.join(' ').slice(0, 1500); // embedding model handles up to ~2048 tokens, leave headroom
}

// When the LLM classifier fails (timeout, parse error, quota), we
// still want the regex-fallback path to give varied answers — not the
// default "anchor on current dasha" generic reply. This map gives each
// regex topic a one-line focus directive matching what the LLM would
// have produced. Same purpose, lower quality, but better than nothing.
const FOCUS_BY_TOPIC = {
  career: '10th house lord, its placement and aspects, plus Dasamsa (D10) chart. Reference current dasha only if dasha lord directly involves career houses.',
  marriage: '7th house lord, its placement and aspects, plus Navamsha (D9) chart. Venus dignity for both genders. Mars for Mangal dosha checks. Age must be considered.',
  romance: '5th house (Purva Punya / romance), its lord, and Venus placement. Moon for emotional disposition. Avoid jumping to marriage timing.',
  relationship: '5th house for romance + 7th house for commitment, Venus for attraction, Mars/Moon for emotional dynamics. Distinguish casual dating from serious commitment.',
  finance: '2nd house (accumulated wealth), 11th house (gains), and their lords. Jupiter for wealth karaka. Distinguish steady income from sudden gains (5th).',
  health: '6th house (illness), 1st house lord (vitality), ascendant strength. Mars for inflammation, Saturn for chronic, Moon for mental. Never predict severe outcomes.',
  children: '5th house (santan) and its lord, Jupiter as putra karaka, 9th house. Consider current age and marital status.',
  spirituality: '9th house (dharma), 12th house (moksha), Jupiter, Ketu. Vimshamsha (D20) if available.',
  foreign: '12th house (foreign lands), 9th house (long journeys), Rahu placement. Distinguish travel from settlement.',
  education: '4th house (basic education), 5th house (intelligence/higher learning), Mercury, Jupiter. 9th for PhD/research.',
  family: 'Specific bhava per relation: 4th=mother, 9th=father, 3rd=siblings. Reference karakas Moon (mother), Sun (father), Mars (brothers), Mercury (cousins).',
  litigation: '6th house (enemies), 8th house (sudden losses), Mars and Saturn placements.',
  longevity: '8th house, ascendant lord, balarishta / madhya / poorna ayur classification. Do not give specific death predictions ever.',
  remedies: 'Identify the afflicted planet from the chart and give MIX of spiritual (mantra/gem/fast) and concrete behavioral remedies.',
  timing: 'Current Mahadasha+Antardasha lord, sub-period dignity, transit Saturn/Jupiter aspects to relevant house.',
  personality: 'Ascendant sign + ascendant lord placement, Moon sign, Sun sign. Use the trio for full picture.',
  general: 'Pick the strongest unambiguous yoga or planetary configuration in the chart. Be specific, not generic.',
};

function synthesizeFocusFromTopic(topic) {
  return FOCUS_BY_TOPIC[topic] || FOCUS_BY_TOPIC.general;
}

// LLM-based question classifier. Uses gemini-2.5-flash-lite (cheap +
// fast: ~300ms, ~$0.0001 per call). Returns a structured analysis
// of the question that drives both retrieval AND answer focus:
//
//   {
//     topic: "marriage_timing" | "career_change" | "property_purchase" | ...
//     vocab: "specific Sanskrit/house/planet keywords to embed",
//     focus: "which chart factors to anchor the answer on",
//     novelty: "what makes THIS question different from a generic one"
//   }
//
// Why this beats regex: handles paraphrases, code-switching (Hinglish),
// and combined questions ("career and marriage in 2026") without me
// having to enumerate every possible phrasing. The focus field is the
// critical bit — it tells the main answer prompt to anchor on (say)
// the 10th lord and Dasamsa for a career question, instead of just
// defaulting to current dasha which makes every answer feel the same.
async function classifyQuestionWithLLM(question, chartData) {
  if (!question || !GEMINI_API_KEY) return null;

  const chartSummary = chartData ? (
    `Ascendant: ${chartData.ascendant.sign}. ` +
    `Current dasha: ${chartData.dasha.mahadasha}-${chartData.dasha.antardasha}. ` +
    `Key placements: ${Object.entries(chartData.planets)
      .map(([n, d]) => `${n} in ${d.sign} house ${d.house}`)
      .slice(0, 5).join(', ')}.`
  ) : 'No chart available.';

  const prompt = `You are an expert Vedic astrologer routing a user's question to the right shastra chapters. Reply ONLY with a JSON object, no markdown.

User question: "${question}"

User's chart context: ${chartSummary}

Return this exact JSON shape:
{
  "topic": "<one specific astrology sub-topic, e.g. marriage_timing, marriage_partner_nature, career_business_vs_job, career_promotion, career_change, finance_property, finance_debt, finance_wealth, finance_speculation, health_chronic, health_surgery, mental_health, family_mother, family_father, family_siblings, family_inlaws, children_conception, children_welfare, education_higher, education_exam_result, spirituality_path, spirituality_guru, foreign_settle, foreign_short_travel, longevity, remedies_general, remedies_marriage, romance, breakup_recovery, general>",
  "vocab": "<15-25 Sanskrit/English keywords classical Vedic texts use for THIS specific topic: relevant house numbers, planets, karakas, yogas, divisional charts. Be specific. Example for 'career_business': 'business entrepreneur 3rd house 7th house 10th house Mercury Mars Jupiter parakrama vyaya rajayoga svatantra independent venture'>",
  "focus": "<a one-sentence instruction telling the answering astrologer which chart factor(s) to anchor the prediction on, e.g. '7th lord and its placement in D9, plus Venus dignity' or '10th house lord, Dasamsa, current dasha lord effect on career sectors'>",
  "tone": "<one word: serious|hopeful|cautious|neutral|empathetic — based on the emotional weight of the question>"
}`;

  try {
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash-lite',
      generationConfig: {
        responseMimeType: 'application/json', // force JSON, no markdown fences
        temperature: 0.2,
      },
    });
    // Hard 3s timeout — if the classifier is slow we'd rather fall back
    // to regex than slow down chat. Race against a timeout promise.
    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise((_, rej) => setTimeout(() => rej(new Error('classifier-timeout')), 2000)),
    ]);
    const text = result.response.text();
    // Extract first {...} balanced object in case model returns extra text.
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      console.warn('[chat] LLM classifier returned non-JSON:', text.slice(0, 120));
      return null;
    }
    const slice = text.slice(start, end + 1);
    let parsed;
    try {
      parsed = JSON.parse(slice);
    } catch {
      // Apply the same bracket-balancer we use for the main chat JSON.
      parsed = JSON.parse(balanceJsonBrackets(slice));
    }
    if (parsed && typeof parsed.topic === 'string') {
      return {
        topic: parsed.topic,
        vocab: String(parsed.vocab || ''),
        focus: String(parsed.focus || ''),
        tone: String(parsed.tone || 'neutral'),
      };
    }
  } catch (e) {
    console.warn('[chat] LLM classifier failed:', String(e.message || e).slice(0, 160));
  }
  return null;
}

// Maximal Marginal Relevance: select topK chunks that are both highly
// relevant to the query AND diverse from each other. Prevents 8 nearly
// identical chunks from the same BPHS chapter dominating the context.
// lambda 0..1: 1 = pure relevance, 0 = pure diversity. 0.7 is a good
// middle ground that keeps quality high but enforces some spread.
function selectDiverseChunks(candidates, topK = 8, lambda = 0.7) {
  if (candidates.length <= topK) return candidates;
  const selected = [];
  const remaining = candidates.slice();

  // Always take the top-scoring one first.
  selected.push(remaining.shift());

  while (selected.length < topK && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      // Max similarity to anything already picked.
      let maxSimToSelected = 0;
      for (const s of selected) {
        const sim = cosineSimilarity(c.embedding, s.embedding);
        if (sim > maxSimToSelected) maxSimToSelected = sim;
      }
      const mmr = lambda * c.score - (1 - lambda) * maxSimToSelected;
      if (mmr > bestScore) { bestScore = mmr; bestIdx = i; }
    }
    selected.push(remaining.splice(bestIdx, 1)[0]);
  }
  return selected;
}

// --- GEMINI HELPERS ---
function getGenAI() {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured');
  return new GoogleGenerativeAI(GEMINI_API_KEY);
}

async function getQueryEmbedding(text) {
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
  const result = await model.embedContent({
    content: { parts: [{ text }] },
    taskType: 'RETRIEVAL_QUERY',
  });
  return result.embedding.values;
}

async function generateResponse(prompt, opts) {
  const genAI = getGenAI();
  // Pinned to explicit 2.5 versions. Do NOT use 'gemini-flash-latest' —
  // that alias silently routes to gemini-3-flash which has only 20 requests/day
  // on the free tier and will burn the key instantly.
  //
  // opts.preferLite=true → try gemini-2.5-flash-lite first (~2-3x faster
  // than flash, used for chat to stay safely under the app's 15s timeout
  // ceiling). Falls back to flash if lite errors. Horoscope keeps the
  // default flash-first order since it's cached anyway.
  const models = (opts && opts.preferLite)
    ? ['gemini-2.5-flash-lite', 'gemini-2.5-flash']
    : ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

  for (const modelName of models) {
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent(prompt);
      console.log(`Generated response using ${modelName}`);
      return result.response.text();
    } catch (err) {
      console.log(`${modelName} failed: ${err.message?.substring(0, 80)}`);
      if (modelName === models[models.length - 1]) throw err;
    }
  }
}

// =========================================
// BIRTH CHART CALCULATION (Phase 4)
// =========================================

function calculateChart(birthDate, birthTime, lat, lon) {
  try {
    // Parse birth date and time into UTC
    // birthDate: "09/07/2003" or "2003-07-09"
    // birthTime: "12:54 PM" or "12:54" (24hr)
    let dateStr = birthDate;
    let [hours, minutes] = [12, 0];

    // Parse time
    if (birthTime) {
      const timeMatch = birthTime.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (timeMatch) {
        hours = parseInt(timeMatch[1]);
        minutes = parseInt(timeMatch[2]);
        const ampm = timeMatch[3];
        if (ampm) {
          if (ampm.toUpperCase() === 'PM' && hours !== 12) hours += 12;
          if (ampm.toUpperCase() === 'AM' && hours === 12) hours = 0;
        }
      }
    }

    // Parse date
    let year, month, day;
    if (dateStr.includes('/')) {
      const parts = dateStr.split('/');
      if (parts[2].length === 4) {
        // DD/MM/YYYY or MM/DD/YYYY
        day = parseInt(parts[0]);
        month = parseInt(parts[1]);
        year = parseInt(parts[2]);
        // If day > 12, it's DD/MM/YYYY format
        if (day > 12) {
          [day, month] = [month, day]; // swap to get correct values
        }
      } else {
        year = parseInt(parts[0]);
        month = parseInt(parts[1]);
        day = parseInt(parts[2]);
      }
    } else if (dateStr.includes('-')) {
      const parts = dateStr.split('-');
      year = parseInt(parts[0]);
      month = parseInt(parts[1]);
      day = parseInt(parts[2]);
    }

    // Convert the LOCAL birth time to UTC using the birthplace's ACTUAL
    // timezone, derived from lat/lon via geo-tz. Previously this assumed
    // every birth was IST (hardcoded -5:30) — producing wildly wrong charts
    // (ascendant off by 5-6 whole signs) for anyone born outside India.
    // luxon applies the correct historical DST offset for the birth date.
    let tzName = 'Asia/Kolkata'; // fallback: most users are India-born
    try {
      const zones = geoTzFind(lat, lon);
      if (zones && zones.length > 0) tzName = zones[0];
    } catch (_) { /* keep India fallback */ }

    const localDt = DateTime.fromObject(
      { year, month, day, hour: hours, minute: minutes },
      { zone: tzName },
    );
    if (!localDt.isValid) {
      console.error('[chart] Invalid datetime:', localDt.invalidReason);
      return null;
    }
    const dob = localDt.toUTC().toJSDate();
    console.log('[chart] tz=' + tzName + ' local=' + year + '-' + month + '-' + day +
      ' ' + hours + ':' + minutes + ' -> UTC ' + dob.toISOString());

    const observer = new Observer(lat, lon, 0);
    const chart = getKundli(dob, observer);

    // Find current dasha
    const now = new Date();
    const currentMaha = chart.dasha.mahadashas?.find(
      m => new Date(m.startTime) <= now && new Date(m.endTime) >= now
    );
    const currentAntar = currentMaha?.antars?.find(
      a => new Date(a.startTime) <= now && new Date(a.endTime) >= now
    );
    const currentPratyantar = currentAntar?.pratyantars?.find(
      p => new Date(p.startTime) <= now && new Date(p.endTime) >= now
    );

    // Build readable chart summary
    const planetSummary = {};
    for (const [name, data] of Object.entries(chart.planets)) {
      if (['Uranus', 'Neptune', 'Pluto'].includes(name)) continue; // Skip outer planets
      const houseNum = chart.houses.findIndex(h => h.planets.includes(name)) + 1;
      planetSummary[name] = {
        sign: data.rashiName,
        degree: Math.floor(data.longitude % 30),
        nakshatra: data.nakshatra,
        house: houseNum || 'unknown',
        isRetrograde: data.isRetrograde || false,
      };
    }

    // Divisional chart summaries
    const d9Summary = {};
    if (chart.vargas?.d9) {
      for (const [name, data] of Object.entries(chart.vargas.d9.planets || {})) {
        if (['Uranus', 'Neptune', 'Pluto'].includes(name)) continue;
        d9Summary[name] = data.rashiName;
      }
      d9Summary['Ascendant'] = chart.vargas.d9.ascendant?.rashiName;
    }

    const d10Summary = {};
    if (chart.vargas?.d10) {
      for (const [name, data] of Object.entries(chart.vargas.d10.planets || {})) {
        if (['Uranus', 'Neptune', 'Pluto'].includes(name)) continue;
        d10Summary[name] = data.rashiName;
      }
      d10Summary['Ascendant'] = chart.vargas.d10.ascendant?.rashiName;
    }

    const d20Summary = {};
    if (chart.vargas?.d20) {
      for (const [name, data] of Object.entries(chart.vargas.d20.planets || {})) {
        if (['Uranus', 'Neptune', 'Pluto'].includes(name)) continue;
        d20Summary[name] = data.rashiName;
      }
      d20Summary['Ascendant'] = chart.vargas.d20.ascendant?.rashiName;
    }

    return {
      ascendant: {
        sign: chart.ascendant.rashiName,
        degree: chart.ascendant.degree,
        nakshatra: chart.ascendant.nakshatra,
        lord: chart.ascendant.rashiLord,
      },
      planets: planetSummary,
      dasha: {
        mahadasha: currentMaha?.planet || 'unknown',
        mahadashaEnd: currentMaha ? new Date(currentMaha.endTime).toLocaleDateString('en-IN') : '',
        antardasha: currentAntar?.planet || 'unknown',
        antardashaEnd: currentAntar ? new Date(currentAntar.endTime).toLocaleDateString('en-IN') : '',
        pratyantar: currentPratyantar?.planet || '',
      },
      birthNakshatra: chart.dasha.birthNakshatra,
      d9Navamsha: d9Summary,
      d10Dasamsa: d10Summary,
      d20Vimshamsha: d20Summary,
      houses: chart.houses.map(h => ({
        number: h.number,
        sign: h.sign,
        planets: h.planets.filter(p => !['Uranus', 'Neptune', 'Pluto'].includes(p)),
      })),
    };
  } catch (err) {
    console.error('Chart calculation error:', err.message);
    return null;
  }
}

function formatChartForPrompt(chart) {
  if (!chart) return '';

  let text = `\n\nUSER'S BIRTH CHART (Calculated):`;
  text += `\nLagna (Ascendant): ${chart.ascendant.sign} at ${chart.ascendant.degree}° in ${chart.ascendant.nakshatra} nakshatra (Lord: ${chart.ascendant.lord})`;
  text += `\nBirth Nakshatra: ${chart.birthNakshatra}`;

  text += `\n\nPLANETARY POSITIONS (D1 Rashi Chart):`;
  for (const [name, data] of Object.entries(chart.planets)) {
    text += `\n- ${name}: ${data.sign} (${data.degree}°) in House ${data.house}, Nakshatra: ${data.nakshatra}${data.isRetrograde ? ' [RETROGRADE]' : ''}`;
  }

  text += `\n\nCURRENT DASHA PERIOD:`;
  text += `\n- Mahadasha: ${chart.dasha.mahadasha} (until ${chart.dasha.mahadashaEnd})`;
  text += `\n- Antardasha: ${chart.dasha.antardasha} (until ${chart.dasha.antardashaEnd})`;
  if (chart.dasha.pratyantar) text += `\n- Pratyantar: ${chart.dasha.pratyantar}`;

  text += `\n\nNAVAMSHA (D9) Chart:`;
  for (const [name, sign] of Object.entries(chart.d9Navamsha)) {
    text += `\n- ${name}: ${sign}`;
  }

  text += `\n\nDASAMSA (D10 - Career) Chart:`;
  for (const [name, sign] of Object.entries(chart.d10Dasamsa)) {
    text += `\n- ${name}: ${sign}`;
  }

  text += `\n\nVIMSHAMSHA (D20 - Spirituality) Chart:`;
  for (const [name, sign] of Object.entries(chart.d20Vimshamsha)) {
    text += `\n- ${name}: ${sign}`;
  }

  text += `\n\nHOUSES:`;
  for (const h of chart.houses) {
    const pList = h.planets.length > 0 ? ` (${h.planets.join(', ')})` : '';
    text += `\n- House ${h.number}: ${h.sign}${pList}`;
  }

  return text;
}

// =========================================
// GEOCODING (convert place name to lat/lon)
// =========================================

// In-memory cache of geocoded results. Persists for the life of the
// Render process (resets on deploy/restart, which is fine — Nominatim
// data is stable and a deploy is rare). Keyed by the normalized place
// name (lowercased + trimmed). Bounded so a flood of unique places
// can't OOM the process.
const _geocodeCache = new Map();
const GEOCODE_CACHE_MAX = 2000;

async function geocodePlace(placeName) {
  if (!placeName) return null;
  const key = String(placeName).toLowerCase().trim();
  if (!key) return null;

  // Cache hit (positive OR negative — we cache 'null' too so a bad
  // place name doesn't burn Nominatim quota on every retry).
  if (_geocodeCache.has(key)) {
    return _geocodeCache.get(key);
  }

  // Common Indian cities (offline fallback)
  const cities = {
    'gopalganj': { lat: 26.47, lon: 83.57 },
    'delhi': { lat: 28.6139, lon: 77.209 },
    'new delhi': { lat: 28.6139, lon: 77.209 },
    'mumbai': { lat: 19.076, lon: 72.8777 },
    'kolkata': { lat: 22.5726, lon: 88.3639 },
    'chennai': { lat: 13.0827, lon: 80.2707 },
    'bangalore': { lat: 12.9716, lon: 77.5946 },
    'bengaluru': { lat: 12.9716, lon: 77.5946 },
    'hyderabad': { lat: 17.385, lon: 78.4867 },
    'pune': { lat: 18.5204, lon: 73.8567 },
    'ahmedabad': { lat: 23.0225, lon: 72.5714 },
    'jaipur': { lat: 26.9124, lon: 75.7873 },
    'lucknow': { lat: 26.8467, lon: 80.9462 },
    'patna': { lat: 25.6093, lon: 85.1376 },
    'varanasi': { lat: 25.3176, lon: 82.9739 },
    'bhopal': { lat: 23.2599, lon: 77.4126 },
    'indore': { lat: 22.7196, lon: 75.8577 },
    'nagpur': { lat: 21.1458, lon: 79.0882 },
    'chandigarh': { lat: 30.7333, lon: 76.7794 },
    'surat': { lat: 21.1702, lon: 72.8311 },
    'kanpur': { lat: 26.4499, lon: 80.3319 },
    'agra': { lat: 27.1767, lon: 78.0081 },
    'noida': { lat: 28.5355, lon: 77.391 },
    'gurgaon': { lat: 28.4595, lon: 77.0266 },
    'gurugram': { lat: 28.4595, lon: 77.0266 },
    'thane': { lat: 19.2183, lon: 72.9781 },
    'coimbatore': { lat: 11.0168, lon: 76.9558 },
    'visakhapatnam': { lat: 17.6868, lon: 83.2185 },
    'kochi': { lat: 9.9312, lon: 76.2673 },
    'thiruvananthapuram': { lat: 8.5241, lon: 76.9366 },
    'ranchi': { lat: 23.3441, lon: 85.3096 },
    'guwahati': { lat: 26.1445, lon: 91.7362 },
    'dehradun': { lat: 30.3165, lon: 78.0322 },
    'raipur': { lat: 21.2514, lon: 81.6296 },
    'mysore': { lat: 12.2958, lon: 76.6394 },
    'mysuru': { lat: 12.2958, lon: 76.6394 },
    'ujjain': { lat: 23.1765, lon: 75.7885 },
    'haridwar': { lat: 29.9457, lon: 78.1642 },
    'rishikesh': { lat: 30.0869, lon: 78.2676 },
    'allahabad': { lat: 25.4358, lon: 81.8463 },
    'prayagraj': { lat: 25.4358, lon: 81.8463 },
    'amritsar': { lat: 31.634, lon: 74.8723 },
    'sultanpur': { lat: 26.2647, lon: 82.0727 },
    'faridabad': { lat: 28.4089, lon: 77.3178 },
    'ghaziabad': { lat: 28.6692, lon: 77.4538 },
    'meerut': { lat: 28.9845, lon: 77.7064 },
    'rajkot': { lat: 22.3039, lon: 70.8022 },
    'vadodara': { lat: 22.3072, lon: 73.1812 },
    'nashik': { lat: 19.9975, lon: 73.7898 },
    'aurangabad': { lat: 19.8762, lon: 75.3433 },
    'jabalpur': { lat: 23.1815, lon: 79.9864 },
    'gwalior': { lat: 26.2183, lon: 78.1828 },
    'jodhpur': { lat: 26.2389, lon: 73.0243 },
    'udaipur': { lat: 24.5854, lon: 73.7125 },
    'kota': { lat: 25.2138, lon: 75.8648 },
    'bareilly': { lat: 28.367, lon: 79.4304 },
    'aligarh': { lat: 27.8974, lon: 78.088 },
    'moradabad': { lat: 28.8389, lon: 78.7378 },
    'saharanpur': { lat: 29.968, lon: 77.5552 },
    'jhansi': { lat: 25.4484, lon: 78.5685 },
    'gorakhpur': { lat: 26.7606, lon: 83.3732 },
    'siliguri': { lat: 26.7271, lon: 88.3953 },
    'jamshedpur': { lat: 22.8046, lon: 86.2029 },
    'dhanbad': { lat: 23.7957, lon: 86.4304 },
    'cuttack': { lat: 20.4625, lon: 85.8828 },
    'bhubaneswar': { lat: 20.2961, lon: 85.8245 },
  };

  if (cities[key]) {
    _cacheSet(key, cities[key]);
    return cities[key];
  }

  // Try LocationIQ first (5k/day free, 60 req/min — way more headroom
  // than Nominatim's 1 req/sec). Falls back to Nominatim if no key set
  // or LocationIQ returns nothing/errors.
  if (process.env.LOCATIONIQ_API_KEY) {
    const liq = await _geocodeLocationIQ(placeName);
    if (liq) {
      _cacheSet(key, liq);
      return liq;
    }
    // LocationIQ returned no match — fall through to Nominatim as a
    // second opinion before we negative-cache.
  }

  const nom = await _geocodeNominatim(placeName);
  if (nom) {
    _cacheSet(key, nom);
    return nom;
  }

  // Both geocoders came up empty / failed without exception.
  // Negative-cache to spare quota on repeat lookups for the same typo.
  _cacheSet(key, null);
  return null;
}

// LocationIQ search — pk.* API key, JSON response shape compatible
// with Nominatim. Returns {lat, lon} on success, null otherwise.
async function _geocodeLocationIQ(placeName) {
  const https = require('https');
  const key = process.env.LOCATIONIQ_API_KEY;
  if (!key) return null;
  const url = `https://us1.locationiq.com/v1/search?key=${encodeURIComponent(key)}` +
    `&q=${encodeURIComponent(placeName + ', India')}&format=json&limit=1`;
  try {
    const body = await new Promise((resolve, reject) => {
      https.get(url, { headers: { 'Accept': 'application/json' } }, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => {
          if (res.statusCode !== 200) {
            console.warn(`[geocode] LocationIQ ${res.statusCode} for "${placeName}":`, buf.slice(0, 200));
            return resolve(null);
          }
          resolve(buf);
        });
      }).on('error', reject);
    });
    if (!body) return null;
    const data = JSON.parse(body);
    if (Array.isArray(data) && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
  } catch (e) {
    console.warn('[geocode] LocationIQ error for "' + placeName + '":', e.message);
  }
  return null;
}

// Nominatim fallback — free, 1 req/sec, occasional 429.
// Kept around so the server still works without a LocationIQ key.
async function _geocodeNominatim(placeName) {
  const https = require('https');
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(placeName + ', India')}&format=jsonv2&limit=1`;
  try {
    const data = await new Promise((resolve, reject) => {
      https.get(
        url,
        {
          headers: {
            'User-Agent': 'Moksha/1.1 (https://github.com/sarvesh973/vedastro-rag-server; support@vedastro.ai)',
            'Accept': 'application/json',
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => {
            if (res.statusCode !== 200) {
              console.warn(`[geocode] Nominatim ${res.statusCode} for "${placeName}":`, body.slice(0, 200));
              return resolve([]);
            }
            try { resolve(JSON.parse(body)); }
            catch (e) {
              console.warn(`[geocode] Nominatim returned non-JSON for "${placeName}" — first 200 chars: ${body.slice(0, 200)}`);
              resolve([]);
            }
          });
        },
      ).on('error', reject);
    });
    if (Array.isArray(data) && data.length > 0) {
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
  } catch (e) {
    console.log('Geocoding failed:', e.message);
  }
  return null;
}

function _cacheSet(key, value) {
  // Evict oldest entry if at capacity (FIFO).
  if (_geocodeCache.size >= GEOCODE_CACHE_MAX) {
    const oldest = _geocodeCache.keys().next().value;
    if (oldest !== undefined) _geocodeCache.delete(oldest);
  }
  _geocodeCache.set(key, value);
}

// Parse birth details from profile string
function parseBirthDetails(profileStr) {
  if (!profileStr) return null;

  const details = {};

  // Extract date: various formats
  const dateMatch = profileStr.match(/(?:DOB|Date of Birth|Born|Birth Date)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i)
    || profileStr.match(/(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})/);
  if (dateMatch) details.date = dateMatch[1];

  // Extract time
  const timeMatch = profileStr.match(/(?:Time|Birth Time)[:\s]*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i)
    || profileStr.match(/(\d{1,2}:\d{2}\s*(?:AM|PM))/i);
  if (timeMatch) details.time = timeMatch[1];

  // Extract place
  const placeMatch = profileStr.match(/(?:Place|Birth Place|Location|City)[:\s]*([A-Za-z\s]+?)(?:\s*[,\n]|$)/i);
  if (placeMatch) details.place = placeMatch[1].trim();

  if (details.date && details.time && details.place) return details;
  return null;
}

// --- BUILD PROMPTS (Updated with chart data) ---
// Maps the 'language' field from the app to a strict instruction block.
function languageDirective(language) {
  if (language === 'english') {
    return 'LANGUAGE - STRICT: Write the ENTIRE reply in clear, natural ' +
      'English. Do not use Hindi or Hinglish words. No Devanagari.';
  }
  // default: hinglish
  return 'LANGUAGE - STRICT: Write in Hinglish - a natural Hindi + English ' +
    'mix in ROMAN script only (e.g. "Aapke career mein achhi growth hai"). ' +
    'Never use Devanagari script.';
}

function buildChatPrompt(question, relevantChunks, userProfile, chatHistory, chartData, language, classifier) {
  const focus = classifier && classifier.focus ? classifier.focus : '';
  const tone = classifier && classifier.tone ? classifier.tone : 'neutral';
  const topic = classifier && classifier.topic ? classifier.topic : 'general';
  const focusBlock = focus
    ? `QUESTION-SPECIFIC FOCUS (REQUIRED — anchor your reasoning here, do NOT default to current dasha for every answer):
${focus}
Tone for THIS reply: ${tone}.
Sub-topic: ${topic}.
`
    : '';
  const versesContext = relevantChunks
    .map((c, i) => `[Source ${i + 1}: ${c.book} Ch.${c.chapter} "${c.chapter_name}", Verses ${c.verse_range}]\n${c.text}`)
    .join('\n\n---\n\n');

  // Compute current age from the userProfile string so the model never
  // has to do date math itself. Without this, Gemini sometimes predicts
  // marriage at 24 to a 22-year-old simply because the active dasha is
  // a marriage-friendly one — context-blind.
  const ageNote = (() => {
    if (!userProfile) return '';
    const m = userProfile.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
          || userProfile.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (!m) return '';
    let y, mo, d;
    if (m[3].length === 4) { d = +m[1]; mo = +m[2]; y = +m[3]; }
    else                    { y = +m[1]; mo = +m[2]; d = +m[3]; }
    const dob = new Date(y, mo - 1, d);
    if (isNaN(dob.getTime())) return '';
    const now = new Date();
    let age = now.getFullYear() - y;
    const beforeBirthday = now.getMonth() < mo - 1
      || (now.getMonth() === mo - 1 && now.getDate() < d);
    if (beforeBirthday) age--;
    return `CURRENT AGE: ${age} years old. Factor this in for life-event timing (do not predict marriage/children before age 22 unless user explicitly mentions an existing relationship; do not predict retirement before 55, etc.).`;
  })();

  const profileContext = userProfile
    ? `USER'S BIRTH DETAILS:\n${userProfile}\n${ageNote}`
    : 'No birth details available.';

  const chartContext = chartData ? formatChartForPrompt(chartData) : '';

  const historyContext = chatHistory && chatHistory.length > 0
    ? 'RECENT CONVERSATION (use this for context, do NOT repeat previous answers):\n' + chatHistory.slice(-10).join('\n')
    : '';

  return `You are Jyotishi, a learned Vedic astrologer. You speak calmly and respectfully, like a family astrologer.

ADDRESSING THE USER — STRICT RULES:
- Address the user by FIRST NAME ONLY (use the first word of their Name field). Do NOT use "beta", "bachcha", "dear", "putra", "ji" after the name, "Jai Shree Ram / Ram Ram / Har Har Mahadev" or any religious salutations, or pet names.
- In Hindi / Hinglish, always use the formal "aap" form. Never "tum" or "tu".
- Use the first name at most 1-2 times per reply, not every sentence.

OUTPUT FORMAT - STRICT, RETURN ONLY JSON:
Return a SINGLE JSON object, nothing else, exactly this shape:

{
  "summary": [
    "A 2 to 3 line point in plain language. The headline insight only.",
    "Another 2 to 3 line point.",
    "..."
  ],
  "details": [
    {
      "chapter": "Brihat Parashara Hora Shastra - 10th House of Karma",
      "explanation": "The FULL detailed reasoning behind summary point 1: which planet, which house, which dasha, why this result. 3 to 6 sentences."
    },
    {
      "chapter": "Phaladeepika - Dasha Phala",
      "explanation": "Full reasoning behind summary point 2."
    }
  ]
}

RULES FOR THE JSON:
- "summary" has 3 to 5 items. Each item is 2 to 3 lines: the headline
  prediction/observation in plain language. Do NOT cram the full
  reasoning here, keep each one short and scannable.
- "details" has EXACTLY the same number of items as "summary", in the
  SAME ORDER. details[i] is the deep-dive for summary[i].
- details[i].chapter: name the classical text + the relevant chapter or
  topic, e.g. "Brihat Parashara Hora Shastra - Effects of the 7th Lord".
  Do not invent verse numbers you were not given; name chapters/topics.
- details[i].explanation: the full astrological reasoning that backs
  that summary point - the planet, house, dasha, and why. This is the
  long part. 3 to 6 sentences.
- Do NOT put book names or citations inside "summary" - those belong
  only in "details".
- Return ONLY the JSON object. No markdown fences, no text before/after.

CONVERSATION RULES:
- This is an ONGOING CONVERSATION. Read the chat history below and continue naturally. Do not re-introduce yourself.
- Use the USER'S ACTUAL BIRTH CHART for personalized predictions. Reference specific planets, houses, and current dasha.
- VARY your chart references per question type — do NOT anchor every answer on the current Mahadasha/Antardasha. Career questions should foreground the 10th lord and Dasamsa. Marriage should foreground the 7th lord and Navamsha. Health should foreground the 6th lord and ascendant. Property the 4th lord. Education the 4th + 5th lords. Children the 5th lord and Jupiter. Only mention current dasha when it is genuinely the strongest signal for that specific question.
- If the user asks a META-question about you, the system, the books used, or "how do you work", answer plainly in 1-2 sentences (still in JSON format with summary=[answer] details=[]). Do not force astrology verses into a meta answer. You are based on Brihat Parashara Hora Shastra (BPHS) and Phaladeepika.
- If the user requests a different language in THIS message ("reply in English", "Hindi mein bolo"), honor it for this reply only. Otherwise follow the default language directive below.
- Keep the total content (all summary + all explanations) under ~320 words.
- Never predict death, severe illness, or create fear.
- Do NOT add a remedy unless the user explicitly asks for remedies / upay /
  solutions. A normal reading is just the bullet points + references.
- WHEN the user asks for remedies: give a BALANCED MIX, not only mantras.
  Include 1-2 spiritual remedies (mantra, daan, gemstone, fasting) AND
  2-3 practical real-life remedies (concrete habit, lifestyle, behavioural,
  career or financial steps the person can act on this week). Keep the
  same summary+details JSON format. Real-life remedies must be specific and actionable,
  not vague ("stay positive" is bad; "keep a fixed 11pm sleep schedule for
  the next 40 days" is good).
- Do not use em dashes, use commas or periods.
- No emoji. Output the JSON object only.
- ${languageDirective(language)}
- Career questions → reference D10 (Dasamsa) if available.
- Marriage/relationship questions → reference D9 (Navamsha).
- Spirituality questions → reference D20 (Vimshamsha).

${profileContext}
${chartContext}

${focusBlock}
${historyContext}

REFERENCE VERSES (use these for accuracy — DO NOT cite them by name in your reply):
${versesContext}

USER'S LATEST MESSAGE: ${question}

Reply as Jyotishi continuing the conversation. Natural tone, formal "aap", first name only. Output ONLY the bullet list, then one blank line, then the "References: ..." paragraph. Nothing before the first bullet, nothing after the references paragraph.`;
}

function buildHoroscopePrompt(relevantChunks, userProfile, sign, period, chartData, language) {
  const versesContext = relevantChunks
    .map(c => `[${c.book} Ch.${c.chapter}, Verses ${c.verse_range}]\n${c.text}`)
    .join('\n\n---\n\n');

  const chartContext = chartData ? formatChartForPrompt(chartData) : '';

  // Build date context for each period
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const dayOfWeek = now.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' });

  // Week range
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const weekRange = `${weekStart.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })} - ${weekEnd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}`;

  // Month
  const monthName = now.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

  let periodInstructions = '';

  if (period === 'daily') {
    periodInstructions = `TODAY'S DATE: ${todayStr}
Day: ${dayOfWeek}

Generate a DAILY horoscope for TODAY ONLY.
Focus on: today's planetary transits, today's ruling planet (${dayOfWeek}), and immediate energy.
- "overall": 2-3 sentences about today's specific energy, mention the day's ruling planet and how it interacts with their chart
- "love": 1-2 sentences about today's romantic/relationship energy
- "career": 1-2 sentences about today's work energy and any meetings/decisions
- "health": 1-2 sentences about today's physical/mental energy levels
- "luckyNumber": a number 1-27 based on today's nakshatra
- "luckyColor": color aligned with today's ruling planet
- "luckyDay": "${dayOfWeek}" (since this IS today)
- "rating": 1-5 stars for today`;
  } else if (period === 'tomorrow') {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
    const tomorrowDay = tomorrow.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' });

    periodInstructions = `TOMORROW'S DATE: ${tomorrowStr}
Day: ${tomorrowDay}

Generate a horoscope for TOMORROW ONLY (not today).
Focus on: tomorrow's planetary transits, tomorrow's ruling planet (${tomorrowDay}), and upcoming energy.
- "overall": 2-3 sentences about tomorrow's energy, how to prepare, mention the ruling planet of ${tomorrowDay}
- "love": 1-2 sentences about tomorrow's romantic/relationship energy
- "career": 1-2 sentences about tomorrow's work opportunities and challenges
- "health": 1-2 sentences about tomorrow's physical/mental energy
- "luckyNumber": a number 1-27 based on tomorrow's nakshatra
- "luckyColor": color aligned with tomorrow's ruling planet
- "luckyDay": "${tomorrowDay}" (since this IS tomorrow)
- "rating": 1-5 stars for tomorrow`;
  } else if (period === 'weekly') {
    periodInstructions = `WEEK: ${weekRange}

Generate a WEEKLY horoscope for the ENTIRE week ahead.
Focus on: weekly planetary transits, key days to watch, and overall weekly theme.
- "overall": 3-4 sentences covering the week's theme, highlight which days are strongest/weakest and why (planetary movements)
- "love": 2-3 sentences about this week's relationship dynamics, mention best days for romance
- "career": 2-3 sentences about career opportunities this week, mention key days for decisions/meetings
- "health": 2 sentences about weekly health pattern, suggest best days for rest vs activity
- "luckyNumber": a number 1-27 based on this week's dominant nakshatra
- "luckyColor": color for the week based on strongest planet
- "luckyDay": the single best day of this week for them
- "rating": 1-5 stars for the overall week`;
  } else {
    periodInstructions = `MONTH: ${monthName}

Generate a MONTHLY horoscope for the ENTIRE month.
Focus on: major planetary transits this month, long-term trends, key phases of the month.
- "overall": 4-5 sentences covering the month's big picture theme, mention any major planetary ingress or retrograde, divide month into phases (early/mid/late)
- "love": 2-3 sentences about this month's relationship arc, mention if any planet transit affects 7th house
- "career": 2-3 sentences about monthly career trajectory, mention promotions/changes/opportunities
- "health": 2-3 sentences about monthly health trends, seasonal advice
- "luckyNumber": a number 1-27 based on this month's key nakshatra
- "luckyColor": color for the month based on dominant planetary energy
- "luckyDay": the best day of the week to take action this month
- "rating": 1-5 stars for the overall month`;
  }

  return `You are a Vedic astrologer creating a PERSONALIZED ${period.toUpperCase()} horoscope for ${sign} sign.

${periodInstructions}

IMPORTANT: The content MUST be specific to the ${period} timeframe. Daily = just today. Weekly = the full week pattern. Monthly = the big picture for the month. Each period must feel DIFFERENT.

TONE & CITATION RULES — STRICT:
- ${languageDirective(language)} Use a warm, respectful tone; formal "aap" form when in Hinglish.
- If the user's first name is available in the profile, you may use it once naturally. Never use "beta", "bachcha", "dear", "ji" suffix, "Jai Shree Ram" or any religious salutations.
- Inside overall/love/career/health text: at most ONE inline reference (e.g. "Phaladeepika ke anusaar..."). Do NOT pepper the body with "(BPHS Ch.X)(Phaladeepika Ch.Y)" tags — it kills readability.
- Any extra references go in a separate "sources" field as a short semicolon list.

${chartContext}

VERSES (use at most ONE inline in body; rest go in "sources"):
${versesContext}

Generate JSON in EXACTLY this format:
{
  "overall": "...",
  "love": "...",
  "career": "...",
  "health": "...",
  "luckyNumber": number,
  "luckyColor": "...",
  "luckyDay": "...",
  "rating": number,
  "sources": "BPHS Ch.X; Phaladeepika Ch.Y Sloka Z",
  "dailyVibe": [
    "...",
    "...",
    "..."
  ]
}

RULES FOR dailyVibe — STRICT:
- EXACTLY 3 short bullet points. Each item maximum 60 characters.
- Crisp, specific, real-life flavoured. Light dry humor allowed. NOT astrology jargon.
- Each item must convey ONE concrete idea a real person can recognize today, derived from the same astrological reading above. Use the chart specifics (current dasha, key transit, ruling planet) to ground them, but say it in everyday language.
- BAD examples (too vague, drop these):
  * "Today, Friday, May 29, 2026, Gemini"            (just metadata)
  * "In your professional sphere"                     (incomplete)
  * "Your romantic life is highlighted today"         (says nothing)
  * "Health is wealth, take care"                     (generic platitude)
- GOOD examples (specific, observable, slight personality):
  * "Reply to that one message you've been avoiding"
  * "Money decision today, count twice, click once"
  * "Sleep early, tomorrow's energy needs the runway"
  * "Old friend texts. Pick up, don't 'k.' them"
  * "Boss may surprise you. Stay sharp by 11 am"
- One can be playful, one can be practical, one can be relational. Mix the tones.
- NO em-dashes. Commas only. NO emojis. NO hashtags.
- For weekly/monthly periods: same 3-bullet shape, but each bullet sketches a theme spanning the period instead of a single-day micro-event.

Return ONLY valid JSON, no markdown.`;
}

// =========================================
// ENDPOINTS
// =========================================

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'VedAstro AI RAG Server',
    version: '2.3.0',
    features: ['rag', 'chart-calculation', 'dasha', 'divisional-charts', 'admin-dashboard', 'subscriptions', 'webhook-firestore-sync'],
    chunks: loadKnowledgeBase().length,
    razorpayConfigured: isRazorpayConfigured,
    firestoreConfigured: !!firestoreDb,
  });
});

// =========================================
// SUBSCRIPTION ENDPOINTS (Razorpay)
// =========================================
// These are scaffolding for the paid-plan flow. Full wiring needs:
//   1. `npm install razorpay` (added to package.json in this commit)
//   2. RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET set in Render env
//   3. Plans created on Razorpay dashboard, IDs set in env
//   4. Webhook configured on dashboard pointing to /subscription/webhook
//      with the same secret as RAZORPAY_WEBHOOK_SECRET

const VALID_PLAN_IDS = {
  trial: () => RAZORPAY_PLAN_TRIAL,
  standard: () => RAZORPAY_PLAN_STANDARD,
  premium: () => RAZORPAY_PLAN_PREMIUM,
};

// GET /admin/check?email=foo@bar.com — quick test if an email is admin
app.get('/admin/check', (req, res) => {
  const email = (req.query.email || '').toString();
  res.json({ email, isAdmin: isAdminEmail(email) });
});

// POST /subscription/create — creates a Razorpay subscription for the user
// Body: { plan: 'trial'|'standard'|'premium', userEmail, userId }
// Returns: { subscriptionId, shortUrl, planId } OR { admin: true } if email is admin
//
// Trial behaviour: free 7-day trial via Razorpay's `start_at` parameter.
// E-mandate registers today (₹0 charged), first ₹99 charge fires on day 7,
// monthly ₹99 thereafter until cancelled. User can cancel during the
// 7-day window with no charge ever happening.
app.post('/subscription/create', async (req, res) => {
  const auth = await verifyAuth(req, res);
  if (!auth) return;

  try {
    const { plan } = req.body || {};

    // Use auth-verified email/uid, NOT client-supplied (prevents admin spoofing)
    const userEmail = auth.email;
    const userId = auth.uid;

    if (auth.isAdmin) {
      return res.json({
        admin: true,
        message: 'Admin email — no subscription needed, unlimited access granted.',
      });
    }

    if (!plan || !VALID_PLAN_IDS[plan]) {
      return res.status(400).json({ error: 'Invalid plan. Use trial, standard, or premium.' });
    }

    if (!isRazorpayConfigured) {
      return res.status(503).json({
        error: 'Razorpay not configured on server yet. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in env.',
      });
    }

    const planId = VALID_PLAN_IDS[plan]();
    if (!planId || planId.includes('placeholder')) {
      return res.status(503).json({
        error: `Razorpay plan ID for "${plan}" not set. Configure RAZORPAY_PLAN_${plan.toUpperCase()} env var.`,
      });
    }

    // Lazy-load razorpay so the server starts even if package isn't installed yet.
    let Razorpay;
    try {
      Razorpay = require('razorpay');
    } catch (e) {
      return res.status(503).json({
        error: 'razorpay npm package not installed yet. Run: npm install razorpay',
      });
    }

    const rzp = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });

    // Trial plan: ₹0 today (just e-mandate setup; bank may auth ~₹1-5
    // and refund), then ₹99 charges automatically on day 7. After that,
    // monthly ₹99 until cancelled. start_at delays the first charge.
    //
    // Standard / Premium: charges immediately (no start_at).
    const subscriptionParams = {
      plan_id: planId,
      total_count: 12,             // 12 monthly cycles before forced renewal prompt
      customer_notify: 1,           // Razorpay sends pre-debit SMS/email automatically (CCPA compliance)
      notes: {
        userId: userId || '',
        userEmail: userEmail || '',
        plan,
        app: 'vedastro_ai',         // tag for partner's dashboard filtering
      },
    };

    if (plan === 'trial') {
      const trialDays = 7;
      const startAt = Math.floor(Date.now() / 1000) + (trialDays * 24 * 60 * 60);
      subscriptionParams.start_at = startAt;
      subscriptionParams.notes.trialEndsAt = new Date(startAt * 1000).toISOString();
    }

    const subscription = await rzp.subscriptions.create(subscriptionParams);

    return res.json({
      subscriptionId: subscription.id,
      shortUrl: subscription.short_url,
      planId,
      status: subscription.status,
    });
  } catch (e) {
    console.error('[subscription/create] Error:', e.message);
    return res.status(500).json({ error: e.message || 'Subscription creation failed' });
  }
});

// POST /subscription/cancel — cancel an active Razorpay subscription
// Body: { subscriptionId, userEmail, cancelAtCycleEnd? }
app.post('/subscription/cancel', async (req, res) => {
  const auth = await verifyAuth(req, res);
  if (!auth) return;

  try {
    const { subscriptionId, cancelAtCycleEnd } = req.body || {};

    if (auth.isAdmin) {
      return res.json({ admin: true, message: 'Admins have no subscription to cancel.' });
    }

    if (!subscriptionId) {
      return res.status(400).json({ error: 'subscriptionId required' });
    }

    // Verify the subscription belongs to this user (prevents cancelling someone else's)
    if (firestoreDb) {
      try {
        const subDoc = await firestoreDb.doc(`subscriptions/${subscriptionId}`).get();
        if (subDoc.exists && subDoc.data().userId && subDoc.data().userId !== auth.uid) {
          return res.status(403).json({ error: 'Subscription does not belong to you' });
        }
      } catch (_) {}
    }

    if (!isRazorpayConfigured) {
      return res.status(503).json({ error: 'Razorpay not configured' });
    }

    let Razorpay;
    try {
      Razorpay = require('razorpay');
    } catch (e) {
      return res.status(503).json({ error: 'razorpay npm package not installed' });
    }

    const rzp = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });

    // Razorpay's cancel_at_cycle_end: true is only valid once the
    // subscription has an active billing cycle. Trial subscriptions
    // (state = 'authenticated' before day-7 first charge) have no
    // cycle yet and Razorpay rejects the call with BAD_REQUEST_ERROR.
    // Fall back to immediate cancel in that case — there's nothing to
    // "keep until period end" anyway, since the user was never charged.
    const wantsCycleEnd = cancelAtCycleEnd !== false;
    let result;
    try {
      result = await rzp.subscriptions.cancel(subscriptionId, wantsCycleEnd);
    } catch (cycleErr) {
      if (wantsCycleEnd) {
        // Log full Razorpay error shape — SDK errors don't put the real
        // description on .message, it lives on .error.description.
        console.warn(
          '[subscription/cancel] cycle-end cancel rejected, retrying immediate:',
          JSON.stringify((cycleErr && cycleErr.error) || (cycleErr && cycleErr.message) || cycleErr),
        );
        result = await rzp.subscriptions.cancel(subscriptionId, false);
      } else {
        throw cycleErr;
      }
    }

    return res.json({
      cancelled: true,
      status: result.status,
      endsAt: result.current_end ? new Date(result.current_end * 1000).toISOString() : null,
    });
  } catch (e) {
    // Razorpay SDK throws { statusCode, error: { code, description, ... } }
    // — e.message is undefined for those. Surface whatever is actually there.
    const rzpDesc = e && e.error && (e.error.description || e.error.code);
    const detail = rzpDesc || (e && e.message) || JSON.stringify(e);
    console.error('[subscription/cancel] Error:', detail);
    return res.status(500).json({ error: detail || 'Cancellation failed' });
  }
});

// POST /subscription/webhook — Razorpay calls this on every subscription event.
// Configure on dashboard with the same secret as RAZORPAY_WEBHOOK_SECRET.
// Subscribe to: subscription.activated, subscription.charged,
// subscription.cancelled, subscription.completed, subscription.halted,
// subscription.pending, subscription.paused, payment.failed
app.post('/subscription/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    if (!RAZORPAY_WEBHOOK_SECRET) {
      console.warn('[webhook] RAZORPAY_WEBHOOK_SECRET not set — rejecting');
      return res.status(503).json({ error: 'Webhook secret not configured' });
    }

    // Verify HMAC-SHA256 signature so we know the request actually came from Razorpay
    const crypto = require('crypto');
    const expected = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(req.body)
      .digest('hex');
    if (signature !== expected) {
      console.warn('[webhook] Invalid signature — possible spoofing attempt');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    const event = JSON.parse(req.body.toString('utf8'));
    console.log(`[webhook] Received: ${event.event}`);

    // Sync to Firestore so the user's app reflects subscription state
    // across devices / re-installs. If Firestore isn't configured, we
    // log and ack the webhook anyway — Razorpay stops retrying at 200 OK.
    try {
      await syncSubscriptionToFirestore(event);
    } catch (syncErr) {
      console.error('[webhook] Firestore sync error:', syncErr.message);
      // Don't fail the webhook ack — Razorpay would retry forever.
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error('[webhook] Error:', e.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/// Update users/{uid}/subscription/current and users/{uid} in Firestore
/// based on the incoming Razorpay webhook event. Idempotent — same
/// event delivered twice produces the same end state.
async function syncSubscriptionToFirestore(event) {
  if (!firestoreDb) {
    console.warn('[webhook] Firestore not initialized — skipping sync');
    return;
  }

  // Extract the subscription entity. Different event types nest it differently.
  const subEntity = event.payload?.subscription?.entity;
  const paymentEntity = event.payload?.payment?.entity;

  // Pull userId from notes (we set this in /subscription/create)
  const notes = subEntity?.notes || paymentEntity?.notes || {};
  const userId = notes.userId;
  const plan = notes.plan || 'standard';

  if (!userId) {
    console.warn(`[webhook] No userId in notes for ${event.event} — cannot sync`);
    return;
  }

  const userRef = firestoreDb.collection('users').doc(userId);
  const subRef = userRef.collection('subscription').doc('current');
  const FieldValue = firebaseAdmin.firestore.FieldValue;
  const now = FieldValue.serverTimestamp();

  switch (event.event) {
    // For 7-day free trials, 'subscription.authenticated' is the FIRST
    // event Razorpay fires — immediately after the user signs the
    // e-mandate. Without handling it, trial users had no Firestore
    // doc and appeared as 'free' on every cold start, losing premium
    // on clear-data / reinstall during the trial week — even though
    // the mandate was correctly set up with the bank.
    case 'subscription.authenticated':
    case 'subscription.activated': {
      const isTrial = plan === 'trial' || !!notes.trialEndsAt;
      const update = {
        plan,
        state: isTrial ? 'trialing' : 'active',
        razorpaySubscriptionId: subEntity.id,
        activatedAt: now,
        updatedAt: now,
      };
      if (subEntity.current_end) {
        update.currentPeriodEndsAt = new Date(subEntity.current_end * 1000);
      }
      if (notes.trialEndsAt) {
        update.trialEndsAt = new Date(notes.trialEndsAt);
      }
      await subRef.set(update, { merge: true });
      await userRef.set({ isPremium: true, plan }, { merge: true });
      console.log(`[webhook] ${event.event} -> ${update.state} (${plan}) for user ${userId}`);
      break;
    }

    case 'subscription.charged': {
      // A successful debit happened (monthly renewal). Extend access.
      const update = {
        state: 'active',
        lastChargedAt: now,
        chargesCount: FieldValue.increment(1),
        failedAttempts: 0, // reset on successful charge
        updatedAt: now,
      };
      if (subEntity.current_end) {
        update.currentPeriodEndsAt = new Date(subEntity.current_end * 1000);
      }
      await subRef.set(update, { merge: true });
      await userRef.set({ isPremium: true }, { merge: true });
      console.log(`[webhook] Charged ${plan} for user ${userId}, ends ${update.currentPeriodEndsAt}`);
      break;
    }

    case 'subscription.cancelled': {
      // User cancelled. Keep premium until paid period ends.
      const update = {
        state: 'cancelledPending',
        cancelledAt: now,
        updatedAt: now,
      };
      if (subEntity.current_end) {
        update.currentPeriodEndsAt = new Date(subEntity.current_end * 1000);
      }
      await subRef.set(update, { merge: true });
      // isPremium stays true until period ends — a scheduled job or the
      // app's runtime check uses currentPeriodEndsAt to flip it off.
      console.log(`[webhook] Cancelled ${plan} for user ${userId} (access until ${update.currentPeriodEndsAt})`);
      break;
    }

    case 'subscription.completed': {
      // Subscription's total_count exhausted (12 cycles done).
      await subRef.set({ state: 'expired', updatedAt: now }, { merge: true });
      await userRef.set({ isPremium: false }, { merge: true });
      console.log(`[webhook] Completed ${plan} for user ${userId}`);
      break;
    }

    case 'subscription.halted':
    case 'payment.failed': {
      // Razorpay tried to debit but failed (insufficient funds, expired
      // card, mandate rejected). Marks paymentFailed; Razorpay retries
      // up to 4 times before giving up.
      await subRef.set({
        state: 'paymentFailed',
        failedAttempts: FieldValue.increment(1),
        lastFailedAt: now,
        updatedAt: now,
      }, { merge: true });
      console.log(`[webhook] Payment failed for user ${userId}`);
      break;
    }

    case 'subscription.paused': {
      await subRef.set({ state: 'paused', updatedAt: now }, { merge: true });
      console.log(`[webhook] Paused for user ${userId}`);
      break;
    }

    case 'subscription.pending': {
      // Awaiting first successful debit (often during trial e-mandate setup)
      await subRef.set({
        plan,
        state: 'trialing',
        razorpaySubscriptionId: subEntity.id,
        updatedAt: now,
      }, { merge: true });
      console.log(`[webhook] Pending (trial) for user ${userId}`);
      break;
    }

    case 'payment.refunded': {
      // A specific charge was refunded (full or partial). Razorpay does
      // NOT auto-cancel the subscription on refund — that's our call.
      // Policy: any refund -> revoke premium immediately + cancel sub at
      // cycle end so the user isn't charged again next month.
      const payment = paymentEntity || {};
      const refundedAmount = payment.amount_refunded || 0;
      const totalAmount = payment.amount || 0;
      const isFullRefund = refundedAmount >= totalAmount;
      console.log(
        `[webhook] payment.refunded for user ${userId}: ` +
        `${refundedAmount}/${totalAmount} paise (${isFullRefund ? 'FULL' : 'partial'})`
      );

      await subRef.set({
        state: 'refunded',
        lastRefundAt: now,
        refundedAmountPaise: FieldValue.increment(refundedAmount),
        refundsCount: FieldValue.increment(1),
        updatedAt: now,
      }, { merge: true });

      // Full refund -> revoke premium immediately, partial = case-by-case
      if (isFullRefund) {
        await userRef.set({ isPremium: false }, { merge: true });
      }

      // Best-effort: cancel the subscription at cycle end so they aren't
      // re-charged. Failure here doesn't break the webhook ack.
      try {
        const subId = payment.subscription_id || subEntity?.id;
        if (subId && isRazorpayConfigured) {
          const Razorpay = require('razorpay');
          const rzp = new Razorpay({
            key_id: RAZORPAY_KEY_ID,
            key_secret: RAZORPAY_KEY_SECRET,
          });
          await rzp.subscriptions.cancel(subId, true /* atCycleEnd */);
          console.log(`[webhook] auto-cancelled sub ${subId} after refund`);
        }
      } catch (cancelErr) {
        console.error('[webhook] post-refund cancel failed:', cancelErr.message);
      }
      break;
    }

    default:
      console.log(`[webhook] Unhandled event type: ${event.event}`);
  }
}

// POST /chart - Calculate birth chart
app.post('/chart', async (req, res) => {
  const auth = await verifyAuth(req, res);
  if (!auth) return;
  if (!await rateLimit(auth, 'chart', res)) return;

  try {
    const { birthDate, birthTime, place, lat, lon } = req.body;

    if (!birthDate || !birthTime) {
      return res.status(400).json({ error: 'birthDate and birthTime are required' });
    }

    let coords = { lat, lon };
    if (!lat || !lon) {
      if (!place) return res.status(400).json({ error: 'place or lat/lon required' });
      coords = await geocodePlace(place);
      if (!coords) return res.status(400).json({ error: `Could not find coordinates for: ${place}` });
    }

    const chart = calculateChart(birthDate, birthTime, coords.lat, coords.lon);
    if (!chart) return res.status(500).json({ error: 'Chart calculation failed' });

    return res.json(chart);
  } catch (err) {
    console.error('Chart error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /chat - RAG + Chart powered chat
app.post('/chat', async (req, res) => {
  // 1. Auth — token from Authorization: Bearer <Firebase ID token>
  const auth = await verifyAuth(req, res);
  if (!auth) return;

  // 2. Rate limit per UID
  if (!await rateLimit(auth, 'chat', res)) return;

  try {
    const { question, userProfile, chatHistory, birthDate, birthTime, place, lat, lon } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'question is required' });
    }
    if (question.length > MAX_QUESTION_LEN) {
      return res.status(400).json({ error: `Question too long (max ${MAX_QUESTION_LEN} chars)` });
    }

    if (auth.isAdmin) {
      console.log(`[chat] Admin request from ${auth.email} — quota bypassed`);
    }

    // Calculate chart if birth details provided
    let chartData = null;
    if (birthDate && birthTime) {
      let coords = { lat, lon };
      if (!lat || !lon) {
        if (place) coords = await geocodePlace(place);
      }
      if (coords) {
        chartData = calculateChart(birthDate, birthTime, coords.lat, coords.lon);
      }
    } else if (userProfile) {
      // Try to parse birth details from profile string
      const parsed = parseBirthDetails(userProfile);
      if (parsed) {
        const coords = await geocodePlace(parsed.place);
        if (coords) {
          chartData = calculateChart(parsed.date, parsed.time, coords.lat, coords.lon);
        }
      }
    }

    const chunks = loadKnowledgeBase();

    // KEY: run the LLM classifier IN PARALLEL with the embedding call,
    // not before it. This way classifier latency is hidden behind the
    // embedding call instead of stacking on top — total chat time
    // doesn't grow even if classifier takes 2-3s.
    //
    // Retrieval uses regex topics (instant), so embedding kicks off
    // immediately. When the classifier resolves, we use its `focus` for
    // the answer prompt. If classifier is slower than embedding, we just
    // wait the small delta. If it fails, we synthesize focus from the
    // regex topic — answer still gets variety guidance.
    const regexTopics = detectQuestionTopics(question);
    const baseQuery = buildEnrichedQuery(question, chartData, regexTopics);

    const t0 = Date.now();
    const [queryEmbedding, llmClass] = await Promise.all([
      getQueryEmbedding(baseQuery),
      classifyQuestionWithLLM(question, chartData),
    ]);
    const parallelMs = Date.now() - t0;

    let topics, focusInstruction, toneHint;
    if (llmClass) {
      topics = [llmClass.topic];
      focusInstruction = llmClass.focus || synthesizeFocusFromTopic(regexTopics[0]);
      toneHint = llmClass.tone || 'neutral';
      console.log(`[chat] parallel ${parallelMs}ms LLM-topic=${llmClass.topic} tone=${toneHint}`);
    } else {
      topics = regexTopics;
      focusInstruction = synthesizeFocusFromTopic(regexTopics[0]);
      toneHint = 'neutral';
      console.log(`[chat] parallel ${parallelMs}ms regex-only topics=[${regexTopics.join(',')}]`);
    }

    // Fetch wider net (24 candidates), then MMR-diversify down to 8.
    const candidates = findRelevantChunks(queryEmbedding, chunks, 24);
    const relevant = selectDiverseChunks(candidates, 8, 0.7);
    console.log(`[chat] picked ${relevant.length} chunks, top score=${(candidates[0]?.score || 0).toFixed(3)}, books=${[...new Set(relevant.map(c => c.book))].join('+')}`);
    const prompt = buildChatPrompt(
      question, relevant, userProfile, chatHistory, chartData,
      (req.body && req.body.language) || 'hinglish',
      { focus: focusInstruction, tone: toneHint, topic: topics[0] || 'general' },
    );
    // Chat uses default model order (flash first, lite fallback) for
    // best answer quality. Flash-lite latency experiment was reverted
    // pending the next AAB which will bump the client timeout from 15s.
    const raw = await generateResponse(prompt);

    // The prompt asks for JSON { summary: [...], details: [...] }.
    // Parse it; fall back to a single-point answer on malformed output.
    // Gemini occasionally returns truncated/unbalanced JSON (e.g. missing
    // a closing `]` for the details array before the final `}`). We try
    // a strict parse first, then a bracket-balanced retry, then fall back.
    let summary = [];
    let details = [];
    const clean = raw.replace(/```json?/gi, '').replace(/```/g, '').trim();

    const applyParsed = (parsed) => {
      let ok = false;
      if (parsed && Array.isArray(parsed.summary)) {
        summary = parsed.summary.map(x => String(x).trim()).filter(Boolean);
        ok = summary.length > 0;
      }
      if (parsed && Array.isArray(parsed.details)) {
        details = parsed.details
          .filter(d => d && (d.chapter || d.explanation))
          .map(d => ({
            chapter: String(d.chapter || '').trim(),
            explanation: String(d.explanation || '').trim(),
          }));
      }
      return ok;
    };

    let parsedOk = false;
    try {
      parsedOk = applyParsed(JSON.parse(clean));
    } catch (e) {
      console.warn('[chat] strict JSON parse failed:', e.message);
    }

    if (!parsedOk) {
      // Bracket-balance: count unmatched openers (ignoring those inside
      // string literals), append the missing closers in correct order.
      try {
        const balanced = balanceJsonBrackets(clean);
        if (balanced !== clean) {
          parsedOk = applyParsed(JSON.parse(balanced));
          if (parsedOk) console.log('[chat] recovered via bracket-balance');
        }
      } catch (e2) {
        console.warn('[chat] balanced retry also failed:', e2.message);
      }
    }

    if (summary.length === 0) {
      summary = [raw.trim()];
      details = [];
    }

    // 'answer' kept for backward-compat (older app builds read only this).
    const answer = summary.map(p => '• ' + p).join(String.fromCharCode(10));

    const sources = relevant.slice(0, 5).map(c => ({
      book: c.book,
      chapter: c.chapter,
      chapter_name: c.chapter_name,
      verse_range: c.verse_range,
      similarity: Math.round(c.score * 100) / 100,
    }));

    try {
      storeConversation(userProfile, birthDate, birthTime, place, question, answer, !!chartData, sources);
    } catch (logErr) {
      console.log('Conv log error:', logErr.message);
    }

    return res.json({
      answer,
      summary,
      details,
      sources,
      chartUsed: !!chartData,
      currentDasha: chartData ? `${chartData.dasha.mahadasha}/${chartData.dasha.antardasha}` : null,
    });
  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /horoscope
app.post('/horoscope', async (req, res) => {
  const auth = await verifyAuth(req, res);
  if (!auth) return;
  if (!await rateLimit(auth, 'horoscope', res)) return;

  try {
    const { userProfile, sign: rawSign = 'Aries', period = 'daily', language = 'hinglish' } = req.body;

    if (!['daily', 'tomorrow', 'weekly', 'monthly'].includes(period)) {
      return res.status(400).json({ error: 'period must be daily, tomorrow, weekly, or monthly' });
    }

    const sign = normalizeSign(rawSign) || 'Aries';

    // Check server-side cache first — saves 90%+ Gemini cost
    const cached = await getCachedHoroscope(sign, period, language);
    if (cached) {
      return res.json({ ...cached, _cached: true });
    }

    const chunks = loadKnowledgeBase();
    const query = `${sign} horoscope ${period} predictions career love health transits effects`;
    const queryEmbedding = await getQueryEmbedding(query);
    const relevant = findRelevantChunks(queryEmbedding, chunks, 10);
    const prompt = buildHoroscopePrompt(relevant, userProfile, sign, period, null, language);
    const responseText = await generateResponse(prompt);

    let horoscope;
    try {
      const clean = responseText.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
      horoscope = JSON.parse(clean);
    } catch (e) {
      horoscope = {
        overall: responseText,
        love: '', career: '', health: '',
        luckyNumber: 7, luckyColor: 'Yellow', luckyDay: 'Thursday', rating: 4,
      };
    }

    // Cache for next user asking same (sign × period × date)
    await setCachedHoroscope(sign, period, horoscope, language);

    return res.json({ ...horoscope, _cached: false });
  } catch (err) {
    console.error('Horoscope error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /search (debug endpoint)
app.post('/search', async (req, res) => {
  const auth = await verifyAuth(req, res);
  if (!auth) return;
  if (!await rateLimit(auth, 'search', res)) return;

  try {
    const { query, topK = 5 } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });
    if (query.length > MAX_QUESTION_LEN) {
      return res.status(400).json({ error: 'query too long' });
    }

    const chunks = loadKnowledgeBase();
    const queryEmbedding = await getQueryEmbedding(query);
    const results = findRelevantChunks(queryEmbedding, chunks, topK);

    return res.json({
      results: results.map(r => ({
        book: r.book, chapter: r.chapter,
        chapter_name: r.chapter_name, verse_range: r.verse_range,
        topics: r.topics, planets: r.planets,
        text: r.text.substring(0, 500),
        score: Math.round(r.score * 1000) / 1000,
      })),
    });
  } catch (err) {
    console.error('Search error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// =========================================
// PALM READING (server-side Gemini Vision)
// =========================================
// Replaces the old client-side palm analysis that bundled the Gemini key
// in the APK (extractable in 5 mins via apktool). Now the key stays on
// the server. Auth-protected, rate-limited per UID.
//
// Body: { imageBase64: "<base64>", mimeType: "image/jpeg" }
// Returns: { loveLine: {...}, careerLine: {...}, lifeLine: {...} }
//   OR     { error: "NOT_A_PALM", message: "..." }

const PALM_PROMPT = `You are a Vedic palm reading expert versed in Samudrik Shastra.

FIRST: Check if the image actually shows a human palm/hand. If NOT, return EXACTLY this JSON:
{"error":"NOT_A_PALM","message":"This image does not show a hand. Please upload a clear photo of your palm with fingers spread."}

If it IS a palm, analyze:
1. Heart Line (Hridaya Rekha): Love, emotions, relationships
2. Head Line (Buddhi Rekha): Intelligence, thinking style, career approach
3. Life Line (Jeevan Rekha): Vitality, energy, life journey (NOT lifespan)

Return ONLY valid JSON, no markdown:
{
  "loveLine": {"title":"Heart Line","emoji":"❤️","insight":"...","meaning":"...","advice":"..."},
  "careerLine": {"title":"Head Line","emoji":"🧠","insight":"...","meaning":"...","advice":"..."},
  "lifeLine": {"title":"Life Line","emoji":"🧬","insight":"...","meaning":"...","advice":"..."}
}

Each section: 3-4 sentences, warm tone, reference Samudrik Shastra.
NEVER predict death or lifespan.`;

const MAX_PALM_BYTES = 5 * 1024 * 1024; // 5 MB raw

app.post('/palm', async (req, res) => {
  const auth = await verifyAuth(req, res);
  if (!auth) return;
  if (!await rateLimit(auth, 'palm', res)) return;

  try {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'imageBase64 required' });
    }
    // Approx byte size (base64 expands ~4/3)
    const approxBytes = (imageBase64.length * 3) / 4;
    if (approxBytes > MAX_PALM_BYTES) {
      return res.status(413).json({ error: 'Image too large (max 5MB). Please retake or compress.' });
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      return res.status(400).json({ error: 'mimeType must be image/jpeg, image/png, or image/webp' });
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const result = await model.generateContent([
      PALM_PROMPT,
      { inlineData: { data: imageBase64, mimeType } },
    ]);
    const text = result.response.text();

    let parsed;
    try {
      const clean = text.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(clean);
    } catch (e) {
      console.error('[palm] parse failed:', e.message, 'first 200 chars:', text.slice(0, 200));
      return res.status(502).json({
        error: 'AI returned an unexpected format. Please retake the photo with better lighting.',
      });
    }

    // NOT_A_PALM short-circuit
    if (parsed.error === 'NOT_A_PALM') {
      return res.status(200).json(parsed);
    }

    // Validate all 3 line objects exist before returning (prevents client crashes)
    for (const k of ['loveLine', 'careerLine', 'lifeLine']) {
      if (!parsed[k] || typeof parsed[k] !== 'object') {
        console.error('[palm] missing field:', k);
        return res.status(502).json({
          error: 'Incomplete palm reading. Please try again with a clearer photo.',
        });
      }
    }

    // Log to user's palmReadings subcollection
    if (firestoreDb) {
      try {
        await firestoreDb.collection(`users/${auth.uid}/palmReadings`).add({
          result: parsed,
          createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (_) {}
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('[palm] error:', err.message);
    return res.status(500).json({ error: 'Palm reading service error. Please try again.' });
  }
});

// =========================================
// ADMIN DASHBOARD
// =========================================

// GET /admin — serves the new dashboard SPA (admin_v2.html). The page
// signs the admin in via Firebase Auth (Google) and calls the JSON
// endpoints under /admin/api/* with a Bearer token. This replaces the
// legacy ADMIN_KEY-querystring HTML page (still reachable at
// /admin/legacy for the conversation viewer).
let _adminHtmlCache = null;
app.get('/admin', (req, res) => {
  try {
    if (!_adminHtmlCache) {
      _adminHtmlCache = fs.readFileSync(
        path.join(__dirname, 'admin_v2.html'), 'utf8');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Tell browsers to always revalidate — without this, Chrome
    // aggressively caches the HTML and admins miss deploys.
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(_adminHtmlCache);
  } catch (e) {
    res.status(500).send('Failed to load dashboard: ' + e.message);
  }
});

// GET /admin/config — public Firebase Web SDK config for the dashboard.
// `apiKey` is a published web key (safe to expose); the SDK still
// requires a valid Google sign-in + our server still re-verifies the
// resulting ID token via requireAdmin() before returning any data.
app.get('/admin/config', (req, res) => {
  const projectId = process.env.FIREBASE_PROJECT_ID || '';
  res.json({
    apiKey: process.env.FIREBASE_WEB_API_KEY || '',
    projectId,
    authDomain: projectId ? projectId + '.firebaseapp.com' : '',
  });
});

// ─── /admin/api/* JSON endpoints (Firebase Auth + isAdmin gated) ──

// GET /admin/api/overview — counts, signups, subscription breakdown.
//
// Data-location notes (real Firestore paths used by the mobile app):
//   - Users:         users/{uid}                              (saveProfile)
//   - Feedback:      feedback/{auto}                          (top-level)
//   - AI reports:    ai_reports/{auto}                        (top-level)
//   - Subscriptions: users/{uid}/subscription/current         (SUBCOLLECTION,
//                    written by Razorpay webhook). There is no top-level
//                    `subscriptions` collection — must use collectionGroup.
//   - Signup time:   Firebase Auth metadata.creationTime — user docs
//                    don't have a stable `createdAt` field.
app.get('/admin/api/overview', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  if (!firestoreDb) return res.status(503).json({ error: 'firestore not configured' });
  try {
    const [usersAgg, feedbackAgg, reportsAgg] = await Promise.all([
      firestoreDb.collection('users').count().get(),
      firestoreDb.collection('feedback').count().get(),
      firestoreDb.collection('ai_reports').count().get(),
    ]);

    // Signups in last 7 / 30 days — page through Firebase Auth.
    // listUsers is cheap at this scale (51 users) and gives us the real
    // account creation time, not the profile-update timestamp.
    const now = Date.now();
    const SEVEN  = 7  * 24 * 60 * 60 * 1000;
    const THIRTY = 30 * 24 * 60 * 60 * 1000;
    let signups7 = 0, signups30 = 0;
    if (firebaseAdmin) {
      try {
        let nextPageToken = undefined;
        do {
          const page = await firebaseAdmin.auth().listUsers(1000, nextPageToken);
          for (const u of page.users) {
            const created = u.metadata && u.metadata.creationTime
              ? Date.parse(u.metadata.creationTime) : NaN;
            if (!isFinite(created)) continue;
            const age = now - created;
            if (age <= SEVEN)  signups7++;
            if (age <= THIRTY) signups30++;
          }
          nextPageToken = page.pageToken;
        } while (nextPageToken);
      } catch (e) {
        console.warn('[admin/overview] listUsers failed:', e.message);
        signups7 = null;
        signups30 = null;
      }
    }

    // Subscriptions breakdown — they live at users/{uid}/subscription/current,
    // so we use a collectionGroup query. Filter to docId == 'current' to
    // avoid grabbing any historical revisions.
    const byPlan = { trial: 0, standard: 0, premium: 0 };
    const byStatus = { active: 0, cancelled: 0, expired: 0, paused: 0, halted: 0, trialing: 0, authenticated: 0, other: 0 };
    let subTotal = 0;
    try {
      const subsSnap = await firestoreDb.collectionGroup('subscription').get();
      subsSnap.forEach(doc => {
        if (doc.id !== 'current') return;
        subTotal++;
        const d = doc.data() || {};
        // The webhook writes either { plan: 'standard' } or { planId: 'plan_xxx' }.
        // We normalize common values; everything else falls through and is
        // ignored (so we don't pollute the counts with stray plan_ ids).
        const planRaw = String(d.plan || d.planId || '').toLowerCase();
        if (planRaw.includes('premium')) byPlan.premium++;
        else if (planRaw.includes('standard')) byPlan.standard++;
        else if (planRaw.includes('trial')) byPlan.trial++;
        else if (byPlan[planRaw] !== undefined) byPlan[planRaw]++;

        const status = String(d.status || 'other').toLowerCase();
        if (byStatus[status] !== undefined) byStatus[status]++;
        else byStatus.other++;
      });
    } catch (e) {
      console.warn('[admin/overview] subscriptions query failed:', e.message);
    }

    res.json({
      counts: {
        users: usersAgg.data().count,
        feedback: feedbackAgg.data().count,
        aiReports: reportsAgg.data().count,
        signups7Days: signups7,
        signups30Days: signups30,
      },
      subscriptions: {
        total: subTotal,
        byPlan,
        byStatus,
      },
    });
  } catch (e) {
    console.error('[admin/overview]', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /admin/api/reports?limit=100 — recent AI reports (newest first).
app.get('/admin/api/reports', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  if (!firestoreDb) return res.json({ items: [] });
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  try {
    const snap = await firestoreDb.collection('ai_reports')
      .orderBy('timestamp', 'desc').limit(limit).get();
    const items = snap.docs.map(d => {
      const v = d.data();
      return {
        id: d.id,
        ...v,
        timestamp: v.timestamp && v.timestamp.toDate
          ? v.timestamp.toDate().toISOString() : null,
        reviewedAt: v.reviewedAt && v.reviewedAt.toDate
          ? v.reviewedAt.toDate().toISOString() : null,
      };
    });
    res.json({ items });
  } catch (e) {
    console.error('[admin/reports]', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /admin/api/reports/:id/reviewed — mark a report as reviewed.
app.post('/admin/api/reports/:id/reviewed', async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  if (!firestoreDb) return res.status(503).json({ error: 'firestore not configured' });
  try {
    await firestoreDb.collection('ai_reports').doc(req.params.id).set({
      reviewed: true,
      reviewedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      reviewedBy: auth.email,
    }, { merge: true });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /admin/api/reports/:id — permanently delete a report.
app.delete('/admin/api/reports/:id', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  if (!firestoreDb) return res.status(503).json({ error: 'firestore not configured' });
  try {
    await firestoreDb.collection('ai_reports').doc(req.params.id).delete();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /admin/api/feedback?limit=100 — recent feedback (newest first).
app.get('/admin/api/feedback', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  if (!firestoreDb) return res.json({ items: [] });
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  try {
    const snap = await firestoreDb.collection('feedback')
      .orderBy('timestamp', 'desc').limit(limit).get();
    const items = snap.docs.map(d => {
      const v = d.data();
      return {
        id: d.id,
        ...v,
        timestamp: v.timestamp && v.timestamp.toDate
          ? v.timestamp.toDate().toISOString() : null,
      };
    });
    res.json({ items });
  } catch (e) {
    console.error('[admin/feedback]', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /admin/api/chats/recent?limit=200 — global feed of most recent
// chat messages across all users. Uses collectionGroup('chats') to
// span every users/{uid}/chats subcollection. First call will fail with
// a Firestore index URL — click it once, wait ~1 min, retry.
//
// Also opportunistically scans legacy top-level collections
// ('conversations', 'messages') for older chat data written before the
// users/{uid}/chats layout existed. Anything found is merged in by
// timestamp. Missing collections are silently skipped.
app.get('/admin/api/chats/recent', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  if (!firestoreDb) return res.json({ items: [] });
  if (!firebaseAdmin) return res.status(503).json({ error: 'firebase-admin not configured' });
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 500);
  try {
    const snap = await firestoreDb.collectionGroup('chats')
      .orderBy('timestamp', 'desc').limit(limit).get();
    const rows = snap.docs.map((d) => {
      const data = d.data() || {};
      const ts = data.timestamp;
      // parent of doc = chats collection, parent of that = users/{uid}
      const uid = d.ref.parent.parent ? d.ref.parent.parent.id : null;
      return {
        id: d.id,
        uid,
        source: 'firestore',
        text: data.text || data.message || data.question || data.answer || '',
        role: data.role || 'user',
        timestamp: ts && typeof ts.toDate === 'function'
          ? ts.toDate().toISOString() : (typeof ts === 'string' ? ts : null),
      };
    });

    // Probe legacy top-level collections. Each is wrapped in try/catch so
    // a non-existent collection or missing index just yields nothing.
    for (const legacyName of ['conversations', 'messages', 'chatHistory']) {
      try {
        const ls = await firestoreDb.collection(legacyName)
          .orderBy('timestamp', 'desc').limit(limit).get();
        for (const d of ls.docs) {
          const data = d.data() || {};
          const ts = data.timestamp || data.createdAt;
          rows.push({
            id: legacyName + '/' + d.id,
            uid: data.uid || null,
            source: 'legacy:' + legacyName,
            text: data.text || data.message || data.question || data.answer || JSON.stringify(data).slice(0, 500),
            role: data.role || 'user',
            timestamp: ts && typeof ts.toDate === 'function'
              ? ts.toDate().toISOString() : (typeof ts === 'string' ? ts : null),
          });
        }
      } catch (_) { /* collection or index doesn't exist — skip */ }
    }

    // Sort merged set newest-first, cap at limit.
    rows.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
    rows.splice(limit);

    // Batch-resolve emails for the distinct uids (max 100 per call).
    const uids = [...new Set(rows.map(r => r.uid).filter(Boolean))];
    const emailMap = {};
    for (let i = 0; i < uids.length; i += 100) {
      const chunk = uids.slice(i, i + 100).map(uid => ({ uid }));
      try {
        const result = await firebaseAdmin.auth().getUsers(chunk);
        for (const u of result.users) {
          emailMap[u.uid] = u.email || u.phoneNumber || null;
        }
      } catch (_) { /* ignore individual chunk failures */ }
    }
    for (const r of rows) r.email = emailMap[r.uid] || null;

    res.json({ items: rows });
  } catch (e) {
    console.error('[admin/chats/recent]', e);
    const urlMatch = (e.message || '').match(/https:\/\/console\.firebase\.google\.com\S+/);
    res.status(500).json({
      error: e.message,
      indexUrl: urlMatch ? urlMatch[0] : null,
      hint: urlMatch
        ? 'Firestore needs a one-time collection-group index. Click "Create index" then retry in ~1 min.'
        : undefined,
    });
  }
});

// GET /admin/api/chats/top-users?days=7&limit=20 — most active chatters
// in the last N days. Counts messages per uid via collectionGroup query.
app.get('/admin/api/chats/top-users', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  if (!firestoreDb) return res.json({ items: [] });
  if (!firebaseAdmin) return res.status(503).json({ error: 'firebase-admin not configured' });
  const days = Math.min(Math.max(parseInt(req.query.days || '7', 10), 1), 90);
  const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  try {
    // Pull up to 5000 recent chats and aggregate. For larger scale we'd
    // switch to a daily-rollup doc; for now this is plenty.
    const snap = await firestoreDb.collectionGroup('chats')
      .where('timestamp', '>=', since)
      .orderBy('timestamp', 'desc')
      .limit(5000)
      .get();

    const counts = new Map(); // uid -> { total, user, ai, last }
    for (const d of snap.docs) {
      const uid = d.ref.parent.parent ? d.ref.parent.parent.id : null;
      if (!uid) continue;
      const data = d.data() || {};
      const role = data.role || 'user';
      const ts = data.timestamp && data.timestamp.toDate
        ? data.timestamp.toDate() : null;
      const c = counts.get(uid) || { uid, total: 0, user: 0, ai: 0, last: null };
      c.total += 1;
      if (role === 'user') c.user += 1; else c.ai += 1;
      if (ts && (!c.last || ts > c.last)) c.last = ts;
      counts.set(uid, c);
    }

    const ranked = [...counts.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);

    // Resolve emails for these uids.
    const emailMap = {};
    for (let i = 0; i < ranked.length; i += 100) {
      const chunk = ranked.slice(i, i + 100).map(r => ({ uid: r.uid }));
      try {
        const result = await firebaseAdmin.auth().getUsers(chunk);
        for (const u of result.users) {
          emailMap[u.uid] = {
            email: u.email || null,
            displayName: u.displayName || null,
            phoneNumber: u.phoneNumber || null,
          };
        }
      } catch (_) {}
    }

    const items = ranked.map(r => ({
      uid: r.uid,
      total: r.total,
      user: r.user,
      ai: r.ai,
      lastAt: r.last ? r.last.toISOString() : null,
      email: emailMap[r.uid] ? emailMap[r.uid].email : null,
      displayName: emailMap[r.uid] ? emailMap[r.uid].displayName : null,
      phoneNumber: emailMap[r.uid] ? emailMap[r.uid].phoneNumber : null,
    }));

    res.json({ days, items });
  } catch (e) {
    console.error('[admin/chats/top-users]', e);
    const urlMatch = (e.message || '').match(/https:\/\/console\.firebase\.google\.com\S+/);
    res.status(500).json({
      error: e.message,
      indexUrl: urlMatch ? urlMatch[0] : null,
      hint: urlMatch
        ? 'Firestore needs a one-time collection-group index. Click "Create index" then retry in ~1 min.'
        : undefined,
    });
  }
});

// GET /admin/api/signups?limit=500 — full list of every signed-up user
// from Firebase Auth, newest first. Includes email, provider, creation
// time. Page-walks listUsers; fine at current scale (<5k users).
app.get('/admin/api/signups', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  if (!firebaseAdmin) return res.status(503).json({ error: 'firebase-admin not configured' });
  const limit = Math.min(parseInt(req.query.limit || '500', 10), 2000);
  try {
    const all = [];
    let nextPageToken = undefined;
    do {
      const page = await firebaseAdmin.auth().listUsers(1000, nextPageToken);
      for (const u of page.users) {
        const providers = (u.providerData || []).map(p => p.providerId);
        all.push({
          uid: u.uid,
          email: u.email || null,
          displayName: u.displayName || null,
          phoneNumber: u.phoneNumber || null,
          provider: providers.includes('google.com') ? 'google'
            : providers.includes('phone') || u.phoneNumber ? 'phone'
            : providers.includes('password') ? 'email'
            : (providers[0] || 'anonymous'),
          createdAt: u.metadata && u.metadata.creationTime ? new Date(u.metadata.creationTime).toISOString() : null,
          lastSignInAt: u.metadata && u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime).toISOString() : null,
          disabled: !!u.disabled,
        });
      }
      nextPageToken = page.pageToken;
    } while (nextPageToken && all.length < limit);

    all.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json({ total: all.length, items: all.slice(0, limit) });
  } catch (e) {
    console.error('[admin/signups]', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /admin/api/subscriptions?limit=500 — every subscription doc the
// Razorpay webhook has written, regardless of current status. Reads
// users/{uid}/subscription/current via collectionGroup. Includes
// cancelled / expired / paused so the full lifecycle is visible.
app.get('/admin/api/subscriptions', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  if (!firestoreDb) return res.status(503).json({ error: 'firestore not configured' });
  if (!firebaseAdmin) return res.status(503).json({ error: 'firebase-admin not configured' });
  const limit = Math.min(parseInt(req.query.limit || '500', 10), 2000);
  try {
    const snap = await firestoreDb.collectionGroup('subscription').get();
    const rows = [];
    const toIso = (v) => v && typeof v.toDate === 'function'
      ? v.toDate().toISOString() : (typeof v === 'string' ? v : null);

    for (const doc of snap.docs) {
      if (doc.id !== 'current') continue;
      const uid = doc.ref.parent.parent ? doc.ref.parent.parent.id : null;
      if (!uid) continue;
      const d = doc.data() || {};
      rows.push({
        uid,
        plan: d.plan || d.planId || null,
        status: d.status || 'unknown',
        razorpaySubscriptionId: d.razorpaySubscriptionId || null,
        trialEndsAt: toIso(d.trialEndsAt),
        currentPeriodEndsAt: toIso(d.currentPeriodEndsAt),
        cancelledAt: toIso(d.cancelledAt),
        updatedAt: toIso(d.updatedAt),
        createdAt: toIso(d.createdAt),
      });
    }

    // Resolve emails for these uids — single getUsers call per 100.
    const uids = [...new Set(rows.map(r => r.uid))];
    const emailMap = {};
    for (let i = 0; i < uids.length; i += 100) {
      const chunk = uids.slice(i, i + 100).map(uid => ({ uid }));
      try {
        const result = await firebaseAdmin.auth().getUsers(chunk);
        for (const u of result.users) {
          emailMap[u.uid] = u.email || u.phoneNumber || null;
        }
      } catch (_) {}
    }
    for (const r of rows) r.email = emailMap[r.uid] || null;

    // Order: active first, then by most recent activity desc.
    rows.sort((a, b) => {
      const sa = a.status === 'active' ? 0 : 1;
      const sb = b.status === 'active' ? 0 : 1;
      if (sa !== sb) return sa - sb;
      const ta = a.cancelledAt || a.updatedAt || a.currentPeriodEndsAt || '';
      const tb = b.cancelledAt || b.updatedAt || b.currentPeriodEndsAt || '';
      return tb.localeCompare(ta);
    });

    const summary = { total: rows.length, active: 0, cancelled: 0, expired: 0, paused: 0, halted: 0, trialing: 0, other: 0 };
    for (const r of rows) {
      if (summary[r.status] !== undefined) summary[r.status]++;
      else summary.other++;
    }

    res.json({ summary, items: rows.slice(0, limit) });
  } catch (e) {
    console.error('[admin/subscriptions]', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /admin/api/chats/legacy-memory — surface the in-memory
// conversationStore (the old /admin/legacy data). This is RAM-only on
// Render — it resets on every deploy and is capped at MAX_CONVERSATION_USERS.
// Useful for spotting recent anonymous chatters who don't have a Firestore uid.
app.get('/admin/api/chats/legacy-memory', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  try {
    const sessions = Array.from(conversationStore.entries())
      .map(([key, data]) => ({
        key,
        userName: data.userName || 'Anonymous',
        place: data.place || '',
        birthDate: data.birthDate || '',
        birthTime: data.birthTime || '',
        totalQuestions: data.totalQuestions || 0,
        messageCount: (data.messages || []).length,
        firstSeen: data.firstSeen ? data.firstSeen.toISOString() : null,
        lastSeen: data.lastSeen ? data.lastSeen.toISOString() : null,
        messages: (data.messages || []).map((m) => ({
          role: m.role,
          text: m.text,
          timestamp: m.timestamp ? m.timestamp.toISOString() : null,
        })),
      }))
      .sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));

    res.json({
      capacity: MAX_CONVERSATION_USERS,
      sessions,
      note: 'In-memory only — resets on every Render deploy.',
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /admin/api/user/lookup?email= OR ?uid= — fetch a user with their
// subscription + usage stats. Falls through Firebase Auth so accounts
// that haven't created a Firestore profile yet are still findable.
app.get('/admin/api/user/lookup', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  if (!firestoreDb) return res.status(503).json({ error: 'firestore not configured' });
  if (!firebaseAdmin) return res.status(503).json({ error: 'firebase-admin not configured' });
  try {
    let user = null;
    if (req.query.uid) {
      const uid = String(req.query.uid).trim();
      const doc = await firestoreDb.collection('users').doc(uid).get();
      let authUser = null;
      try { authUser = await firebaseAdmin.auth().getUser(uid); } catch (_) {}
      if (doc.exists || authUser) {
        user = {
          uid,
          email: authUser ? authUser.email : (doc.data() || {}).email,
          displayName: authUser ? authUser.displayName : null,
          phoneNumber: authUser ? authUser.phoneNumber : null,
          ...(doc.exists ? doc.data() : {}),
        };
      }
    } else if (req.query.email) {
      const email = String(req.query.email).trim().toLowerCase();
      try {
        const authUser = await firebaseAdmin.auth().getUserByEmail(email);
        const doc = await firestoreDb.collection('users').doc(authUser.uid).get();
        user = {
          uid: authUser.uid,
          email: authUser.email,
          displayName: authUser.displayName,
          phoneNumber: authUser.phoneNumber,
          ...(doc.exists ? doc.data() : {}),
        };
      } catch (_) { /* not found */ }
    }
    if (!user) return res.status(404).json({ error: 'not found' });

    // Enrich with subscription + usage (best-effort).
    const [subDoc, usageDoc] = await Promise.all([
      firestoreDb.doc('users/' + user.uid + '/subscription/current')
        .get().catch(() => null),
      firestoreDb.doc('usage/' + user.uid).get().catch(() => null),
    ]);
    user.subscription = subDoc && subDoc.exists ? subDoc.data() : null;
    user.usage = usageDoc && usageDoc.exists ? usageDoc.data() : null;

    // Convert any Firestore Timestamps in subscription so the JSON is
    // serialisable on the wire.
    if (user.subscription) {
      for (const k of Object.keys(user.subscription)) {
        const v = user.subscription[k];
        if (v && typeof v === 'object' && typeof v.toDate === 'function') {
          user.subscription[k] = v.toDate().toISOString();
        }
      }
    }

    res.json(user);
  } catch (e) {
    console.error('[admin/user/lookup]', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /admin/api/user/:uid/chats?limit=200 — recent chat messages for a
// given user, newest first. Chats are stored at users/{uid}/chats by the
// mobile app (FirestoreService.saveChatMessage).
app.get('/admin/api/user/:uid/chats', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  if (!firestoreDb) return res.status(503).json({ error: 'firestore not configured' });
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
  try {
    const snap = await firestoreDb
      .collection('users')
      .doc(req.params.uid)
      .collection('chats')
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    const items = snap.docs.map((d) => {
      const data = d.data() || {};
      const ts = data.timestamp;
      return {
        id: d.id,
        text: data.text || '',
        role: data.role || 'user',
        timestamp: ts && typeof ts.toDate === 'function'
          ? ts.toDate().toISOString()
          : (typeof ts === 'string' ? ts : null),
      };
    });
    res.json({ items });
  } catch (e) {
    console.error('[admin/user/chats]', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /admin/api/user/:uid/premium  body: { isPremium: bool }
// Grants or revokes premium directly on the user doc. The mobile app
// reads `isPremium` from this doc on launch (FirestoreService.setPremium)
// so the change takes effect on next app open.
app.post('/admin/api/user/:uid/premium', async (req, res) => {
  const auth = await requireAdmin(req, res);
  if (!auth) return;
  if (!firestoreDb) return res.status(503).json({ error: 'firestore not configured' });
  const isPremium = !!(req.body && req.body.isPremium);
  try {
    await firestoreDb.collection('users').doc(req.params.uid).set({
      isPremium,
      premiumGrantedBy: isPremium ? auth.email : null,
      premiumGrantedAt: isPremium
        ? firebaseAdmin.firestore.FieldValue.serverTimestamp()
        : null,
      premiumRevokedBy: isPremium ? null : auth.email,
      premiumRevokedAt: isPremium
        ? null
        : firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    res.json({ ok: true, isPremium });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Legacy HTML conversation viewer (ADMIN_KEY) ────────────────────
// Old conversation viewer, kept available at /admin/legacy?key=... so
// the in-memory chat browser is still reachable while we migrate. The
// new dashboard owns /admin now.

// GET /admin/legacy?key=SECRET — view all conversations (legacy)
app.get('/admin/legacy', (req, res) => {
  if (req.query.key !== ADMIN_KEY || ADMIN_KEY === 'vedastro2024') {
    return res.status(403).send('<h1 style="color:#fff;background:#1a1a2e;margin:0;padding:40vh 0;text-align:center;height:100vh;font-family:sans-serif">Access Denied — set ADMIN_KEY env var to a strong value</h1>');
  }

  // Build user list sorted by last active
  const users = Array.from(conversationStore.entries())
    .map(([key, data]) => ({ key, ...data }))
    .sort((a, b) => b.lastSeen - a.lastSeen);

  const totalMessages = users.reduce((sum, u) => sum + u.messages.length, 0);
  const totalUsers = users.length;

  // Selected user
  const selectedKey = req.query.user || null;
  const selectedUser = selectedKey ? conversationStore.get(selectedKey) : null;

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function timeAgo(date) {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  }

  // Build conversation HTML for selected user
  let conversationHtml = '';
  if (selectedUser) {
    conversationHtml = selectedUser.messages.map(msg => {
      const isUser = msg.role === 'user';
      const bgColor = isUser ? '#2d1b69' : '#1a2744';
      const borderColor = isUser ? '#7c3aed' : '#3b82f6';
      const label = isUser ? 'User' : 'AI';
      const labelColor = isUser ? '#a78bfa' : '#60a5fa';
      const time = new Date(msg.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
      const chartBadge = msg.chartUsed ? ' <span style="background:#065f46;color:#6ee7b7;padding:2px 8px;border-radius:10px;font-size:11px">Chart Used</span>' : '';
      const sourcesBadge = msg.sourcesCount ? ` <span style="background:#713f12;color:#fbbf24;padding:2px 8px;border-radius:10px;font-size:11px">${msg.sourcesCount} sources</span>` : '';

      return `<div style="margin:12px 0;padding:16px;background:${bgColor};border-left:3px solid ${borderColor};border-radius:0 12px 12px 0">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="color:${labelColor};font-weight:600;font-size:13px">${label}${chartBadge}${sourcesBadge}</span>
          <span style="color:#6b7280;font-size:11px">${time}</span>
        </div>
        <div style="color:#e5e7eb;font-size:14px;line-height:1.6;white-space:pre-wrap">${escapeHtml(msg.text)}</div>
      </div>`;
    }).join('');
  }

  // Build user list HTML
  const userListHtml = users.map(u => {
    const isSelected = u.key === selectedKey;
    const bg = isSelected ? '#2d1b69' : '#16213e';
    const border = isSelected ? 'border:1px solid #7c3aed' : 'border:1px solid #1e3a5f';
    const initial = (u.userName || '?')[0].toUpperCase();

    return `<a href="/admin/legacy?key=${ADMIN_KEY}&user=${encodeURIComponent(u.key)}" style="text-decoration:none;display:block;padding:14px;margin:8px 0;background:${bg};${border};border-radius:12px;transition:all 0.2s">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#3b82f6);display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:16px;flex-shrink:0">${initial}</div>
        <div style="flex:1;min-width:0">
          <div style="color:#e5e7eb;font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(u.userName)}</div>
          <div style="color:#6b7280;font-size:12px">${escapeHtml(u.place)} | ${u.totalQuestions} questions</div>
        </div>
        <div style="color:#6b7280;font-size:11px;flex-shrink:0">${timeAgo(u.lastSeen)}</div>
      </div>
    </a>`;
  }).join('');

  const noUsersHtml = totalUsers === 0
    ? '<div style="text-align:center;padding:60px 20px;color:#6b7280"><div style="font-size:48px;margin-bottom:16px">📭</div><div style="font-size:16px">No conversations yet</div><div style="font-size:13px;margin-top:8px">Conversations will appear here as users chat with the bot</div></div>'
    : '';

  const selectedUserHeader = selectedUser
    ? `<div style="padding:20px;background:#16213e;border-radius:12px;margin-bottom:16px">
        <div style="font-size:18px;font-weight:700;color:#e5e7eb">${escapeHtml(selectedUser.userName)}</div>
        <div style="color:#6b7280;font-size:13px;margin-top:4px">
          ${escapeHtml(selectedUser.place)} | DOB: ${escapeHtml(selectedUser.birthDate)} | Time: ${escapeHtml(selectedUser.birthTime)}
        </div>
        <div style="color:#6b7280;font-size:12px;margin-top:4px">
          ${selectedUser.totalQuestions} questions | First seen: ${new Date(selectedUser.firstSeen).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} | Last: ${timeAgo(selectedUser.lastSeen)}
        </div>
      </div>`
    : '<div style="text-align:center;padding:80px 20px;color:#4b5563"><div style="font-size:40px;margin-bottom:12px">👈</div><div style="font-size:15px">Select a user to view their conversation</div></div>';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VedAstro Admin</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0f0f23; color: #e5e7eb; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    a:hover div { opacity: 0.9; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: #1a1a2e; }
    ::-webkit-scrollbar-thumb { background: #374151; border-radius: 3px; }
  </style>
</head>
<body>
  <!-- Header -->
  <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:20px 24px;border-bottom:1px solid #1e3a5f;display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="font-size:22px;font-weight:800;background:linear-gradient(135deg,#a78bfa,#60a5fa);-webkit-background-clip:text;-webkit-text-fill-color:transparent">VedAstro Admin</div>
      <div style="color:#6b7280;font-size:13px;margin-top:2px">Conversation Dashboard</div>
    </div>
    <div style="display:flex;gap:20px">
      <div style="text-align:center">
        <div style="font-size:24px;font-weight:700;color:#a78bfa">${totalUsers}</div>
        <div style="font-size:11px;color:#6b7280">Users</div>
      </div>
      <div style="text-align:center">
        <div style="font-size:24px;font-weight:700;color:#60a5fa">${totalMessages}</div>
        <div style="font-size:11px;color:#6b7280">Messages</div>
      </div>
    </div>
  </div>

  <!-- Main Layout -->
  <div style="display:flex;height:calc(100vh - 73px)">
    <!-- User List (sidebar) -->
    <div style="width:340px;border-right:1px solid #1e3a5f;overflow-y:auto;padding:12px;background:#0f0f23;flex-shrink:0">
      <div style="padding:8px 6px;color:#9ca3af;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px">Users (${totalUsers})</div>
      ${noUsersHtml}
      ${userListHtml}
    </div>

    <!-- Conversation Panel -->
    <div style="flex:1;overflow-y:auto;padding:20px;background:#0a0a1a">
      ${selectedUserHeader}
      ${conversationHtml}
    </div>
  </div>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  return res.send(html);
});

// GET /admin/api — JSON API. Requires Firebase admin token.
app.get('/admin/api', async (req, res) => {
  if (!await requireAdmin(req, res)) return;

  const users = Array.from(conversationStore.entries()).map(([key, data]) => ({
    key,
    userName: data.userName,
    place: data.place,
    birthDate: data.birthDate,
    totalQuestions: data.totalQuestions,
    messageCount: data.messages.length,
    firstSeen: data.firstSeen,
    lastSeen: data.lastSeen,
    messages: data.messages,
  }));

  return res.json({
    totalUsers: users.length,
    totalMessages: users.reduce((sum, u) => sum + u.messages.length, 0),
    users,
  });
});

// GET /admin/export — Export all conversations as downloadable JSON
app.get('/admin/export', async (req, res) => {
  if (!await requireAdmin(req, res)) return;

  const data = Array.from(conversationStore.entries()).map(([key, d]) => ({
    userName: d.userName,
    place: d.place,
    birthDate: d.birthDate,
    birthTime: d.birthTime,
    totalQuestions: d.totalQuestions,
    firstSeen: d.firstSeen,
    lastSeen: d.lastSeen,
    messages: d.messages,
  }));

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=vedastro-conversations-${new Date().toISOString().split('T')[0]}.json`);
  return res.send(JSON.stringify(data, null, 2));
});

// =========================================
// PRE-GENERATED HOROSCOPE SYSTEM
// =========================================

function getHoroscopeCacheKey(sign, period, language) {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // 2026-04-15
  const langTag = String(language || 'hinglish').toLowerCase();
  // Weekly/monthly only change once per week/month
  if (period === 'weekly') {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    return `${sign.toLowerCase()}_${period}_${langTag}_${weekStart.toISOString().split('T')[0]}`;
  }
  if (period === 'monthly') {
    return `${sign.toLowerCase()}_${period}_${langTag}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  if (period === 'tomorrow') {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    return `${sign.toLowerCase()}_${period}_${langTag}_${tomorrow.toISOString().split('T')[0]}`;
  }
  return `${sign.toLowerCase()}_${period}_${langTag}_${dateStr}`;
}

// Languages we pre-generate horoscopes for. Keep in sync with what the
// Flutter app sends in the request body's `language` field.
const HOROSCOPE_LANGUAGES = ['hinglish', 'english'];

async function generateSingleHoroscope(sign, period, language) {
  try {
    const chunks = loadKnowledgeBase();
    const query = `${sign} horoscope ${period} predictions career love health transits`;
    const queryEmbedding = await getQueryEmbedding(query);
    const relevant = findRelevantChunks(queryEmbedding, chunks, 6);
    const prompt = buildHoroscopePrompt(relevant, null, sign, period, null, language);
    const responseText = await generateResponse(prompt);

    let horoscope;
    try {
      const clean = responseText.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
      horoscope = JSON.parse(clean);
    } catch (e) {
      horoscope = {
        overall: responseText,
        love: '', career: '', health: '',
        luckyNumber: 7, luckyColor: 'Yellow', luckyDay: 'Thursday', rating: 4,
      };
    }
    return horoscope;
  } catch (err) {
    console.error(`Failed to generate ${sign} ${period} ${language}:`, err.message);
    return null;
  }
}

// Pre-generate horoscopes for the specified periods, across every sign
// × every language. Called by three IST-midnight cron jobs:
//   daily 00:00 IST every day -> ['daily', 'tomorrow']  (48 items, ~2 min)
//   weekly 00:00 IST Sundays  -> ['weekly']             (24 items, ~1 min)
//   monthly 00:00 IST on 1st  -> ['monthly']            (24 items, ~1 min)
//
// 2.5s spacing stays under Gemini's free-tier RPM cap. Already-cached
// entries are skipped so a mid-day restart resumes cheaply instead of
// burning quota re-doing yesterday's work.
async function preGenerateHoroscopes(periods) {
  const targetPeriods = Array.isArray(periods) && periods.length > 0
    ? periods
    : HOROSCOPE_PERIODS;
  const label = `[CRON ${targetPeriods.join('+')}]`;
  const total = ZODIAC_SIGNS.length * targetPeriods.length * HOROSCOPE_LANGUAGES.length;
  console.log(`${label} Starting pre-generation: signs=${ZODIAC_SIGNS.length} periods=${targetPeriods.length} langs=${HOROSCOPE_LANGUAGES.length} total=${total}`);
  const startTime = Date.now();
  let generated = 0, failed = 0, skipped = 0;

  for (const sign of ZODIAC_SIGNS) {
    for (const period of targetPeriods) {
      for (const language of HOROSCOPE_LANGUAGES) {
        const cacheKey = getHoroscopeCacheKey(sign, period, language);

        if (horoscopeCache.has(cacheKey)) {
          skipped++;
          continue;
        }

        const horoscope = await generateSingleHoroscope(sign, period, language);
        if (horoscope) {
          horoscopeCache.set(cacheKey, {
            data: horoscope,
            sign, period, language,
            generatedAt: new Date().toISOString(),
          });
          generated++;
          console.log(`${label} ✓ ${sign} ${period} ${language}`);
        } else {
          failed++;
        }

        await new Promise(r => setTimeout(r, 2500));
      }
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`${label} Done. generated=${generated} failed=${failed} skipped=${skipped} elapsed=${elapsed}s cache.size=${horoscopeCache.size}`);
}

// Back-compat: existing admin /horoscope/generate endpoint calls this.
async function preGenerateAllHoroscopes() {
  return preGenerateHoroscopes(HOROSCOPE_PERIODS);
}

// Clean expired cache entries daily
function cleanExpiredCache() {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  let removed = 0;

  for (const [key, value] of horoscopeCache) {
    // Remove entries older than 2 days
    const genDate = new Date(value.generatedAt);
    const ageHours = (now - genDate) / (1000 * 60 * 60);
    if (ageHours > 48) {
      horoscopeCache.delete(key);
      removed++;
    }
  }
  if (removed > 0) console.log(`[CACHE] Cleaned ${removed} expired entries`);
}

// GET /horoscope/cached — serve pre-generated horoscopes (ZERO AI cost)
app.get('/horoscope/cached', (req, res) => {
  const { sign: rawSign = 'Aries', period = 'daily' } = req.query;
  const language = String(req.query.language || 'hinglish').toLowerCase();

  // Accept both English ("Aries") and Sanskrit ("Mesha (Aries)") forms
  const sign = normalizeSign(rawSign);
  if (!sign) {
    return res.status(400).json({ error: `Invalid zodiac sign: "${rawSign}"` });
  }
  if (!HOROSCOPE_PERIODS.includes(period)) {
    return res.status(400).json({ error: 'period must be daily, tomorrow, weekly, or monthly' });
  }
  if (!HOROSCOPE_LANGUAGES.includes(language)) {
    return res.status(400).json({ error: `language must be one of ${HOROSCOPE_LANGUAGES.join(', ')}` });
  }

  const cacheKey = getHoroscopeCacheKey(sign, period, language);
  const cached = horoscopeCache.get(cacheKey);

  if (cached) {
    return res.json({
      ...cached.data,
      _cached: true,
      _generatedAt: cached.generatedAt,
    });
  }

  // Cache miss — return a holding response, don't call AI
  return res.status(202).json({
    overall: 'Aapka horoscope abhi generate ho raha hai. Kuch der mein try karein.',
    love: '', career: '', health: '',
    luckyNumber: 7, luckyColor: 'Yellow', luckyDay: 'Thursday', rating: 4,
    _cached: false,
    _message: 'Horoscope is being generated. Please retry in a few minutes.',
  });
});

// GET /horoscope/status — check cache stats
app.get('/horoscope/status', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  const entries = Array.from(horoscopeCache.entries()).map(([key, val]) => ({
    key,
    sign: val.sign,
    period: val.period,
    language: val.language || null,
    generatedAt: val.generatedAt,
  }));
  return res.json({
    totalCached: horoscopeCache.size,
    maxPossible: ZODIAC_SIGNS.length * HOROSCOPE_PERIODS.length * HOROSCOPE_LANGUAGES.length,
    languages: HOROSCOPE_LANGUAGES,
    entries,
  });
});

// POST /horoscope/generate — manually trigger pre-generation (admin)
app.post('/horoscope/generate', async (req, res) => {
  if (!await requireAdmin(req, res)) return;
  res.json({ message: 'Pre-generation started in background', currentCache: horoscopeCache.size });
  preGenerateAllHoroscopes().catch(err => console.error('[CRON] Error:', err));
});

// Schedule: pre-generate horoscopes at 00:00 IST per period type.
//
// node-cron 'timezone' option pins everything to Asia/Kolkata so the
// jobs fire at midnight IST regardless of where the Render container
// is physically running.
//
// Schedule layout:
//   0 0 * * *   -> 00:00 every day      -> daily + tomorrow (48 items)
//   0 0 * * 0   -> 00:00 every Sunday   -> weekly           (24 items)
//   0 0 1 * *   -> 00:00 on the 1st     -> monthly          (24 items)
//
// On server boot we also kick off a one-time fill so a fresh deploy
// during the day doesn't leave users staring at empty cache until the
// next midnight tick. The initial fill skips anything already cached.
function startHoroscopeCron() {
  const cron = require('node-cron');
  const tz = 'Asia/Kolkata';

  // Initial warmup: 30s after boot, generate whatever's missing.
  setTimeout(() => {
    console.log('[CRON] Initial post-boot fill — generating missing entries');
    preGenerateAllHoroscopes().catch(err =>
      console.error('[CRON] Initial generation error:', err));
  }, 30000);

  // Daily 00:00 IST — refresh daily + tomorrow for all 12 signs × 2 langs.
  cron.schedule('0 0 * * *', () => {
    console.log('[CRON] 00:00 IST — daily + tomorrow refresh');
    cleanExpiredCache();
    preGenerateHoroscopes(['daily', 'tomorrow']).catch(err =>
      console.error('[CRON] daily error:', err));
  }, { timezone: tz });

  // Sunday 00:00 IST — refresh weekly horoscopes.
  cron.schedule('0 0 * * 0', () => {
    console.log('[CRON] Sunday 00:00 IST — weekly refresh');
    preGenerateHoroscopes(['weekly']).catch(err =>
      console.error('[CRON] weekly error:', err));
  }, { timezone: tz });

  // 1st of month 00:00 IST — refresh monthly horoscopes.
  cron.schedule('0 0 1 * *', () => {
    console.log('[CRON] 1st-of-month 00:00 IST — monthly refresh');
    preGenerateHoroscopes(['monthly']).catch(err =>
      console.error('[CRON] monthly error:', err));
  }, { timezone: tz });

  console.log('[CRON] Horoscope pre-generation scheduled (IST midnight)');
}

// --- KEEP ALIVE (prevents Render free tier from sleeping) ---
function keepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL || 'https://vedastro-rag-server.onrender.com';
  const https = require('https');
  const http = require('http');
  const client = url.startsWith('https') ? https : http;

  setInterval(() => {
    client.get(`${url}/`, (res) => {
      console.log(`Keep-alive ping: ${res.statusCode}`);
    }).on('error', (err) => {
      console.log('Keep-alive ping failed:', err.message);
    });
  }, 14 * 60 * 1000);
}

// --- START ---
app.listen(PORT, () => {
  console.log(`VedAstro AI server v3.0 running on port ${PORT}`);
  loadKnowledgeBase();
  keepAlive();
  startHoroscopeCron(); // Pre-generate horoscopes for all 12 signs
  console.log('[CRON] Horoscope pre-generation cron started (every 6 hours)');
});
