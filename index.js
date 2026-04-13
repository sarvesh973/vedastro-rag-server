const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

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
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

// --- BUILD PROMPTS ---
function buildChatPrompt(question, relevantChunks, userProfile, chatHistory) {
  const versesContext = relevantChunks
    .map((c, i) => `[Source ${i + 1}: ${c.book} Ch.${c.chapter} "${c.chapter_name}", Verses ${c.verse_range}]\n${c.text}`)
    .join('\n\n---\n\n');

  const profileContext = userProfile
    ? `USER'S BIRTH DETAILS:\n${userProfile}`
    : 'No birth details available.';

  const historyContext = chatHistory && chatHistory.length > 0
    ? 'RECENT CONVERSATION:\n' + chatHistory.join('\n')
    : '';

  return `You are Jyotishi, a wise and compassionate Vedic astrologer trained in the traditions of Brihat Parashara Hora Shastra and Phaladeepika. You speak warmly, like a trusted family pandit.

IMPORTANT RULES:
- Answer ONLY using information from the sacred verses provided below
- Cite the specific source (book, chapter, verse) for every claim you make
- Keep responses between 150-300 words
- Write naturally in simple English, avoid jargon unless explaining it
- Never predict death, severe illness, or create fear
- Always end with one practical, positive remedy or suggestion
- If the question is outside Vedic astrology, politely redirect
- Do not use em dashes, use commas or periods instead
- Do not use forced emoji section headers
- Match the user's language (English, Hindi, or Hinglish)

${profileContext}

${historyContext}

RELEVANT VERSES FROM SACRED TEXTS:
${versesContext}

USER QUESTION: ${question}

Respond as Jyotishi, citing sources naturally within your answer (e.g., "According to BPHS Chapter 18..."). Be warm, specific, and helpful.`;
}

function buildHoroscopePrompt(relevantChunks, userProfile, sign, period) {
  const versesContext = relevantChunks
    .map(c => `[${c.book} Ch.${c.chapter}, Verses ${c.verse_range}]\n${c.text}`)
    .join('\n\n---\n\n');

  const periodLabel = period === 'daily' ? 'today' : period === 'weekly' ? 'this week' : 'this month';

  return `You are a Vedic astrologer creating a ${period} horoscope for ${sign} sign.

Using ONLY the following Vedic texts as your source, generate a horoscope for ${periodLabel}.

VERSES:
${versesContext}

Generate a JSON response with this exact format:
{
  "overall": "2-3 sentence overall prediction",
  "love": "1-2 sentence love prediction",
  "career": "1-2 sentence career prediction",
  "health": "1-2 sentence health prediction",
  "luckyNumber": a number between 1 and 27,
  "luckyColor": "one color",
  "luckyDay": "one day of the week",
  "rating": a number 1-5
}

Keep it warm, Hinglish, reference Vedic concepts. Return ONLY valid JSON, no markdown.`;
}

// =========================================
// ENDPOINTS
// =========================================

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'VedAstro AI RAG Server', chunks: loadKnowledgeBase().length });
});

// POST /chat
app.post('/chat', async (req, res) => {
  try {
    const { question, userProfile, chatHistory } = req.body;

    if (!question || typeof question !== 'string') {
      return res.status(400).json({ error: 'question is required' });
    }

    const chunks = loadKnowledgeBase();
    const queryEmbedding = await getQueryEmbedding(question);
    const relevant = findRelevantChunks(queryEmbedding, chunks, 8);
    const prompt = buildChatPrompt(question, relevant, userProfile, chatHistory);
    const answer = await generateResponse(prompt);

    const sources = relevant.slice(0, 5).map(c => ({
      book: c.book,
      chapter: c.chapter,
      chapter_name: c.chapter_name,
      verse_range: c.verse_range,
      similarity: Math.round(c.score * 100) / 100,
    }));

    return res.json({ answer, sources });
  } catch (err) {
    console.error('Chat error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// POST /horoscope
app.post('/horoscope', async (req, res) => {
  try {
    const { userProfile, sign = 'Aries', period = 'daily' } = req.body;

    if (!['daily', 'weekly', 'monthly'].includes(period)) {
      return res.status(400).json({ error: 'period must be daily, weekly, or monthly' });
    }

    const chunks = loadKnowledgeBase();
    const query = `${sign} horoscope ${period} predictions career love health transits effects`;
    const queryEmbedding = await getQueryEmbedding(query);
    const relevant = findRelevantChunks(queryEmbedding, chunks, 10);
    const prompt = buildHoroscopePrompt(relevant, userProfile, sign, period);
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

// --- KEEP ALIVE (prevents Render free tier from sleeping) ---
function keepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
  const https = require('https');
  const http = require('http');
  const client = url.startsWith('https') ? https : http;

  setInterval(() => {
    client.get(`${url}/`, (res) => {
      console.log(`Keep-alive ping: ${res.statusCode}`);
    }).on('error', (err) => {
      console.log('Keep-alive ping failed:', err.message);
    });
  }, 14 * 60 * 1000); // every 14 minutes (Render sleeps after 15)
}

// --- START ---
app.listen(PORT, () => {
  console.log(`VedAstro AI server running on port ${PORT}`);
  loadKnowledgeBase(); // preload
  keepAlive(); // prevent sleep
});
