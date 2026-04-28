const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getKundli, Observer } = require('@prisri/jyotish');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

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

async function generateResponse(prompt) {
  const genAI = getGenAI();
  // Pinned to explicit 2.5 versions. Do NOT use 'gemini-flash-latest' —
  // that alias silently routes to gemini-3-flash which has only 20 requests/day
  // on the free tier and will burn the key instantly.
  const models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

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

    // Convert IST to UTC (subtract 5:30)
    let utcHours = hours - 5;
    let utcMinutes = minutes - 30;
    if (utcMinutes < 0) { utcMinutes += 60; utcHours--; }
    if (utcHours < 0) { utcHours += 24; day--; }

    const dob = new Date(Date.UTC(year, month - 1, day, utcHours, utcMinutes, 0));
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

async function geocodePlace(placeName) {
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
  };

  const key = placeName.toLowerCase().trim();
  if (cities[key]) return cities[key];

  // Try online geocoding via Nominatim (free, no key needed)
  try {
    const https = require('https');
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(placeName + ', India')}&format=json&limit=1`;
    const data = await new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'VedAstro-AI/1.0' } }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve(JSON.parse(body)));
      }).on('error', reject);
    });

    if (data.length > 0) {
      return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
  } catch (e) {
    console.log('Geocoding failed:', e.message);
  }

  return null;
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
function buildChatPrompt(question, relevantChunks, userProfile, chatHistory, chartData) {
  const versesContext = relevantChunks
    .map((c, i) => `[Source ${i + 1}: ${c.book} Ch.${c.chapter} "${c.chapter_name}", Verses ${c.verse_range}]\n${c.text}`)
    .join('\n\n---\n\n');

  const profileContext = userProfile
    ? `USER'S BIRTH DETAILS:\n${userProfile}`
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

CITATION RULES — STRICT, READ CAREFULLY:
- DO NOT include any inline citations in the body of your reply.
  No "(BPHS Ch.7)", no "(Phaladeepika Ch.26 Sloka 18)", no "Sources:" at
  the end. The app shows references in a separate UI section automatically.
- DO NOT name the books in the body either ("BPHS says...", "Phaladeepika
  ke anusaar..."). Speak with quiet authority instead — "shastras say...",
  "classical texts indicate...", or just state the prediction directly.
- The reading should read like a calm conversation with a family
  astrologer, NOT a research paper. Sources/citations are noise here.
- The references will be displayed by the app from the chunks it sends
  you — you just need to give the user a clean, readable reply.

CONVERSATION RULES:
- This is an ONGOING CONVERSATION. Read the chat history below and continue naturally. Do not re-introduce yourself.
- Use the USER'S ACTUAL BIRTH CHART for personalized predictions. Reference specific planets, houses, and current dasha.
- Keep responses 150-250 words.
- Never predict death, severe illness, or create fear.
- End with ONE practical remedy (mantra / daan / gem / ritual) — not a list.
- Do not use em dashes, use commas or periods.
- No forced emoji section headers — clean prose.
- Match the user's language (English / Hindi / Hinglish).
- Career questions → reference D10 (Dasamsa) if available.
- Marriage/relationship questions → reference D9 (Navamsha).
- Spirituality questions → reference D20 (Vimshamsha).

${profileContext}
${chartContext}

${historyContext}

REFERENCE VERSES (use these for accuracy — DO NOT cite them by name in your reply):
${versesContext}

USER'S LATEST MESSAGE: ${question}

Reply as Jyotishi continuing the conversation. Natural tone, formal "aap", first name only, NO citations or book names in the body — the app handles references separately.`;
}

function buildHoroscopePrompt(relevantChunks, userProfile, sign, period, chartData) {
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
- Warm Hinglish with formal "aap" form. Never "tum" or "tu".
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
  "sources": "BPHS Ch.X; Phaladeepika Ch.Y Sloka Z"
}

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
  try {
    const { plan, userEmail, userId } = req.body || {};

    if (isAdminEmail(userEmail)) {
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
  try {
    const { subscriptionId, userEmail, cancelAtCycleEnd } = req.body || {};

    if (isAdminEmail(userEmail)) {
      return res.json({ admin: true, message: 'Admins have no subscription to cancel.' });
    }

    if (!subscriptionId) {
      return res.status(400).json({ error: 'subscriptionId required' });
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
    // cancelAtCycleEnd=true means user keeps access until current period ends.
    // false = immediate cancel, no further access (rare; used for refunds).
    const result = await rzp.subscriptions.cancel(subscriptionId, cancelAtCycleEnd !== false);

    return res.json({
      cancelled: true,
      status: result.status,
      endsAt: result.current_end ? new Date(result.current_end * 1000).toISOString() : null,
    });
  } catch (e) {
    console.error('[subscription/cancel] Error:', e.message);
    return res.status(500).json({ error: e.message || 'Cancellation failed' });
  }
});

// POST /subscription/webhook — Razorpay calls this on every subscription event.
// Configure on dashboard with the same secret as RAZORPAY_WEBHOOK_SECRET.
// Subscribe to: subscription.activated, subscription.charged,
// subscription.cancelled, subscription.completed, subscription.halted,
// subscription.pending, subscription.paused, payment.failed
app.post('/subscription/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
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
    case 'subscription.activated': {
      // First successful charge OR trial e-mandate accepted.
      const update = {
        plan,
        state: 'active',
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
      console.log(`[webhook] Activated ${plan} for user ${userId}`);
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

    default:
      console.log(`[webhook] Unhandled event type: ${event.event}`);
  }
}

// POST /chart - Calculate birth chart
app.post('/chart', async (req, res) => {
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
  try {
    const { question, userProfile, chatHistory, birthDate, birthTime, place, lat, lon, userEmail } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'question is required' });
    }

    // Mark admin requests so they bypass any future quota enforcement.
    // Once Firebase ID-token verification is added, this will be derived
    // from the verified token's email claim instead of the request body.
    const _isAdmin = isAdminEmail(userEmail);
    if (_isAdmin) {
      console.log(`[chat] Admin request from ${userEmail} — quota bypassed`);
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

    // Smart query: include chart context for better RAG search
    let searchQuery = question;
    if (chartData) {
      // Enhance search with relevant planetary info
      const planets = Object.entries(chartData.planets)
        .map(([name, data]) => `${name} in ${data.sign} house ${data.house}`)
        .join(', ');
      searchQuery = `${question} ${chartData.ascendant.sign} lagna ${chartData.dasha.mahadasha} dasha ${planets}`;
    }

    const queryEmbedding = await getQueryEmbedding(searchQuery.substring(0, 500));
    const relevant = findRelevantChunks(queryEmbedding, chunks, 8);
    const prompt = buildChatPrompt(question, relevant, userProfile, chatHistory, chartData);
    const answer = await generateResponse(prompt);

    const sources = relevant.slice(0, 5).map(c => ({
      book: c.book,
      chapter: c.chapter,
      chapter_name: c.chapter_name,
      verse_range: c.verse_range,
      similarity: Math.round(c.score * 100) / 100,
    }));

    // Log conversation for admin dashboard
    try {
      storeConversation(userProfile, birthDate, birthTime, place, question, answer, !!chartData, sources);
    } catch (logErr) {
      console.log('Conv log error:', logErr.message);
    }

    return res.json({
      answer,
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
  try {
    const { userProfile, sign: rawSign = 'Aries', period = 'daily', birthDate, birthTime, place, lat, lon } = req.body;

    if (!['daily', 'tomorrow', 'weekly', 'monthly'].includes(period)) {
      return res.status(400).json({ error: 'period must be daily, tomorrow, weekly, or monthly' });
    }

    // Accept Sanskrit form from the app ("Mesha (Aries)") — normalize to English
    const sign = normalizeSign(rawSign) || 'Aries';

    // Calculate chart if birth details provided
    let chartData = null;
    if (birthDate && birthTime) {
      let coords = { lat, lon };
      if (!lat || !lon && place) coords = await geocodePlace(place);
      if (coords) chartData = calculateChart(birthDate, birthTime, coords.lat, coords.lon);
    } else if (userProfile) {
      const parsed = parseBirthDetails(userProfile);
      if (parsed) {
        const coords = await geocodePlace(parsed.place);
        if (coords) chartData = calculateChart(parsed.date, parsed.time, coords.lat, coords.lon);
      }
    }

    const chunks = loadKnowledgeBase();
    const query = `${sign} horoscope ${period} predictions career love health transits effects`;
    const queryEmbedding = await getQueryEmbedding(query);
    const relevant = findRelevantChunks(queryEmbedding, chunks, 10);
    const prompt = buildHoroscopePrompt(relevant, userProfile, sign, period, chartData);
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

    return res.json(horoscope);
  } catch (err) {
    console.error('Horoscope error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /search (debug endpoint)
app.post('/search', async (req, res) => {
  try {
    const { query, topK = 5 } = req.body;
    if (!query) return res.status(400).json({ error: 'query is required' });

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
// ADMIN DASHBOARD
// =========================================

// GET /admin?key=SECRET — view all conversations
app.get('/admin', (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(403).send('<h1 style="color:#fff;background:#1a1a2e;margin:0;padding:40vh 0;text-align:center;height:100vh;font-family:sans-serif">Access Denied</h1>');
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

    return `<a href="/admin?key=${ADMIN_KEY}&user=${encodeURIComponent(u.key)}" style="text-decoration:none;display:block;padding:14px;margin:8px 0;background:${bg};${border};border-radius:12px;transition:all 0.2s">
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

// GET /admin/api?key=SECRET — JSON API for all conversations
app.get('/admin/api', (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

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

// GET /admin/export?key=SECRET — Export all conversations as downloadable JSON
app.get('/admin/export', (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

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

function getHoroscopeCacheKey(sign, period) {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0]; // 2026-04-15
  // Weekly/monthly only change once per week/month
  if (period === 'weekly') {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    return `${sign.toLowerCase()}_${period}_${weekStart.toISOString().split('T')[0]}`;
  }
  if (period === 'monthly') {
    return `${sign.toLowerCase()}_${period}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  if (period === 'tomorrow') {
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    return `${sign.toLowerCase()}_${period}_${tomorrow.toISOString().split('T')[0]}`;
  }
  return `${sign.toLowerCase()}_${period}_${dateStr}`;
}

async function generateSingleHoroscope(sign, period) {
  try {
    const chunks = loadKnowledgeBase();
    const query = `${sign} horoscope ${period} predictions career love health transits`;
    const queryEmbedding = await getQueryEmbedding(query);
    const relevant = findRelevantChunks(queryEmbedding, chunks, 6);
    const prompt = buildHoroscopePrompt(relevant, null, sign, period, null);
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
    console.error(`Failed to generate ${sign} ${period}:`, err.message);
    return null;
  }
}

async function preGenerateAllHoroscopes() {
  console.log('[CRON] Starting horoscope pre-generation...');
  const startTime = Date.now();
  let generated = 0, failed = 0;

  for (const sign of ZODIAC_SIGNS) {
    for (const period of HOROSCOPE_PERIODS) {
      const cacheKey = getHoroscopeCacheKey(sign, period);

      // Skip if already cached for this period
      if (horoscopeCache.has(cacheKey)) {
        continue;
      }

      const horoscope = await generateSingleHoroscope(sign, period);
      if (horoscope) {
        horoscopeCache.set(cacheKey, {
          data: horoscope,
          sign,
          period,
          generatedAt: new Date().toISOString(),
        });
        generated++;
        console.log(`[CRON] Generated: ${sign} ${period}`);
      } else {
        failed++;
      }

      // Small delay to respect rate limits (30 RPM for free tier)
      await new Promise(r => setTimeout(r, 2500));
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`[CRON] Done! Generated: ${generated}, Failed: ${failed}, Time: ${elapsed}s, Cache size: ${horoscopeCache.size}`);
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

  // Accept both English ("Aries") and Sanskrit ("Mesha (Aries)") forms
  const sign = normalizeSign(rawSign);
  if (!sign) {
    return res.status(400).json({ error: `Invalid zodiac sign: "${rawSign}"` });
  }
  if (!HOROSCOPE_PERIODS.includes(period)) {
    return res.status(400).json({ error: 'period must be daily, tomorrow, weekly, or monthly' });
  }

  const cacheKey = getHoroscopeCacheKey(sign, period);
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
app.get('/horoscope/status', (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const entries = Array.from(horoscopeCache.entries()).map(([key, val]) => ({
    key,
    sign: val.sign,
    period: val.period,
    generatedAt: val.generatedAt,
  }));
  return res.json({
    totalCached: horoscopeCache.size,
    maxPossible: ZODIAC_SIGNS.length * HOROSCOPE_PERIODS.length,
    entries,
  });
});

// POST /horoscope/generate — manually trigger pre-generation (admin)
app.post('/horoscope/generate', async (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  res.json({ message: 'Pre-generation started in background', currentCache: horoscopeCache.size });
  preGenerateAllHoroscopes().catch(err => console.error('[CRON] Error:', err));
});

// Schedule: generate horoscopes every 6 hours
function startHoroscopeCron() {
  // Generate immediately on server start (with 30s delay to let server warm up)
  setTimeout(() => {
    preGenerateAllHoroscopes().catch(err => console.error('[CRON] Initial generation error:', err));
  }, 30000);

  // Then every 6 hours
  setInterval(() => {
    cleanExpiredCache();
    preGenerateAllHoroscopes().catch(err => console.error('[CRON] Scheduled generation error:', err));
  }, 6 * 60 * 60 * 1000);
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
