const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getKundli, Observer } = require('@prisri/jyotish');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ADMIN_KEY = process.env.ADMIN_KEY || 'vedastro2024';

// =========================================
// CONVERSATION STORE (in-memory admin log)
// =========================================
const conversationStore = new Map();
// Key: userIdentifier (name+place), Value: { profile, messages[], firstSeen, lastSeen }

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
  const models = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];

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

  return `You are Jyotishi, a wise and compassionate Vedic astrologer trained in the traditions of Brihat Parashara Hora Shastra and Phaladeepika. You speak warmly, like a trusted family pandit.

IMPORTANT RULES:
- This is an ONGOING CONVERSATION. Read the chat history below and continue naturally. Do not introduce yourself again or repeat previous answers.
- If the user refers to something from earlier in the conversation, acknowledge it and build on it.
- Use the USER'S ACTUAL BIRTH CHART data provided below to give PERSONALIZED predictions
- Reference their specific planetary positions, house placements, and current dasha period
- Cite the specific source (book, chapter, verse) when referencing sacred texts
- Keep responses between 150-300 words
- Write naturally, avoid jargon unless explaining it
- Never predict death, severe illness, or create fear
- Always end with one practical, positive remedy or suggestion
- Do not use em dashes, use commas or periods instead
- Do not use forced emoji section headers
- Match the user's language (English, Hindi, or Hinglish)
- When discussing career, reference D10 (Dasamsa) chart
- When discussing marriage/relationships, reference D9 (Navamsha) chart
- When discussing spirituality/ishta devta, reference D20 (Vimshamsha) chart
- Always mention relevant dasha period and its effects

${profileContext}
${chartContext}

${historyContext}

RELEVANT VERSES FROM SACRED TEXTS:
${versesContext}

USER'S LATEST MESSAGE: ${question}

Respond as Jyotishi continuing the conversation naturally. Use BOTH the user's calculated birth chart AND the sacred verses. Cite sources naturally. Be warm, specific, and helpful.`;
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

IMPORTANT: The content MUST be specific to the ${period} timeframe. Daily = just today. Weekly = the full week pattern. Monthly = the big picture for the month. Each period must feel DIFFERENT and cover DIFFERENT timeframes with DIFFERENT levels of detail.

${chartContext}

VERSES:
${versesContext}

Generate a JSON response with EXACTLY this format:
{
  "overall": "...",
  "love": "...",
  "career": "...",
  "health": "...",
  "luckyNumber": number,
  "luckyColor": "...",
  "luckyDay": "...",
  "rating": number
}

Keep it warm, Hinglish, reference specific planetary positions from their chart. Return ONLY valid JSON, no markdown.`;
}

// =========================================
// ENDPOINTS
// =========================================

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'VedAstro AI RAG Server',
    version: '2.1.0',
    features: ['rag', 'chart-calculation', 'dasha', 'divisional-charts', 'admin-dashboard'],
    chunks: loadKnowledgeBase().length,
  });
});

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
    const { question, userProfile, chatHistory, birthDate, birthTime, place, lat, lon } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'question is required' });
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
    const { userProfile, sign = 'Aries', period = 'daily', birthDate, birthTime, place, lat, lon } = req.body;

    if (!['daily', 'weekly', 'monthly'].includes(period)) {
      return res.status(400).json({ error: 'period must be daily, weekly, or monthly' });
    }

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
  console.log(`VedAstro AI server v2.1 running on port ${PORT}`);
  loadKnowledgeBase();
  keepAlive();
});
