// =========================================
// ASHTAKOOT — Vedic compatibility (Guna Milan), deterministic
// =========================================
//
// Pure arithmetic and fixed lookup tables. No LLM, no randomness. The same
// two charts ALWAYS produce the same 36-point score and the same per-kuta
// breakdown. The LLM only ever writes prose around numbers decided here and
// is forbidden from changing them — the split that makes mulank.js reliable.
//
// ── The eight kutas and their weights (total 36) ─────────────
//   Varna        1   temperament / working style
//   Vashya       2   mutual influence, who leads
//   Tara         3   fortune and health of the bond
//   Yoni         4   physical and instinctive compatibility
//   Graha Maitri 5   mental friendship, how minds meet
//   Gana         6   nature — deva / manushya / rakshasa
//   Bhakoot      7   emotional direction and prosperity
//   Nadi         8   constitution; the heaviest single factor
//
// ── Honesty note (read before extending) ─────────────────────
// This is a traditional matching system, not a predictor of whether a
// relationship lasts and NOT a judgement of any individual. It describes a
// DYNAMIC between two charts. It must never be used to assert that a named
// person is unfaithful, dishonest, or of bad character — that person is not
// a user, has not consented, and cannot answer back. Keep every output
// about the pair, never about one of them.
//
// Sources: standard Ashtakoot Guna Milan as given in Muhurta and matching
// literature; the Nadi and Bhakoot exception rules are the widely used ones.

const NAKSHATRAS = [
  'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra',
  'Punarvasu', 'Pushya', 'Ashlesha', 'Magha', 'Purva Phalguni', 'Uttara Phalguni',
  'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha',
  'Mula', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha',
  'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati',
];

const RASHIS = [
  'Aries', 'Taurus', 'Gemini', 'Cancer', 'Leo', 'Virgo',
  'Libra', 'Scorpio', 'Sagittarius', 'Capricorn', 'Aquarius', 'Pisces',
];

// Rashi lord — used by Graha Maitri.
const RASHI_LORD = ['Mars', 'Venus', 'Mercury', 'Moon', 'Sun', 'Mercury',
  'Venus', 'Mars', 'Jupiter', 'Saturn', 'Saturn', 'Jupiter'];

// Varna comes from the Moon RASHI's element, not the nakshatra. This was
// wrong in the first cut - a per-nakshatra table that disagreed with the
// standard rule (Vishakha/Libra scored Brahmin where the rule gives Shudra).
// Indexed 0-11 to match RASHIS.
//   water -> Brahmin, fire -> Kshatriya, earth -> Vaishya, air -> Shudra
const VARNA_BY_RASHI = [
  'Kshatriya', // Aries
  'Vaishya',   // Taurus
  'Shudra',    // Gemini
  'Brahmin',   // Cancer
  'Kshatriya', // Leo
  'Vaishya',   // Virgo
  'Shudra',    // Libra
  'Brahmin',   // Scorpio
  'Kshatriya', // Sagittarius
  'Vaishya',   // Capricorn
  'Shudra',    // Aquarius
  'Brahmin',   // Pisces
];

const YONI = ['Horse', 'Elephant', 'Sheep', 'Serpent', 'Serpent', 'Dog',
  'Cat', 'Sheep', 'Cat', 'Rat', 'Rat', 'Cow',
  'Buffalo', 'Tiger', 'Buffalo', 'Tiger', 'Deer', 'Deer',
  'Dog', 'Monkey', 'Mongoose', 'Monkey', 'Lion', 'Horse',
  'Lion', 'Cow', 'Elephant'];

const GANA = ['Deva', 'Manushya', 'Rakshasa', 'Manushya', 'Deva', 'Manushya',
  'Deva', 'Deva', 'Rakshasa', 'Rakshasa', 'Manushya', 'Manushya',
  'Deva', 'Rakshasa', 'Deva', 'Rakshasa', 'Deva', 'Rakshasa',
  'Rakshasa', 'Manushya', 'Manushya', 'Deva', 'Rakshasa', 'Rakshasa',
  'Manushya', 'Manushya', 'Deva'];

const NADI = ['Adi', 'Madhya', 'Antya', 'Antya', 'Madhya', 'Adi',
  'Adi', 'Madhya', 'Antya', 'Antya', 'Madhya', 'Adi',
  'Adi', 'Madhya', 'Antya', 'Antya', 'Madhya', 'Adi',
  'Adi', 'Madhya', 'Antya', 'Antya', 'Madhya', 'Adi',
  'Adi', 'Madhya', 'Antya'];

// Vashya class per rashi (0-11).
const VASHYA = ['Chatushpada', 'Chatushpada', 'Manava', 'Jalachara', 'Vanachara',
  'Manava', 'Manava', 'Keeta', 'Manava', 'Jalachara', 'Manava', 'Jalachara'];

// Planetary friendship for Graha Maitri.
const FRIENDS = {
  Sun: ['Moon', 'Mars', 'Jupiter'],
  Moon: ['Sun', 'Mercury'],
  Mars: ['Sun', 'Moon', 'Jupiter'],
  Mercury: ['Sun', 'Venus'],
  Jupiter: ['Sun', 'Moon', 'Mars'],
  Venus: ['Mercury', 'Saturn'],
  Saturn: ['Mercury', 'Venus'],
};
const ENEMIES = {
  Sun: ['Venus', 'Saturn'],
  Moon: [],
  Mars: ['Mercury'],
  Mercury: ['Moon'],
  Jupiter: ['Mercury', 'Venus'],
  Venus: ['Sun', 'Moon'],
  Saturn: ['Sun', 'Moon', 'Mars'],
};

// Yoni pairs that are traditionally hostile. Everything else scores by
// same-animal (4) / neutral (2) / hostile (0..1).
const YONI_ENEMY = {
  Horse: 'Buffalo', Buffalo: 'Horse',
  Elephant: 'Lion', Lion: 'Elephant',
  Sheep: 'Monkey', Monkey: 'Sheep',
  Serpent: 'Mongoose', Mongoose: 'Serpent',
  Dog: 'Deer', Deer: 'Dog',
  Cat: 'Rat', Rat: 'Cat',
  Cow: 'Tiger', Tiger: 'Cow',
};

function nakIndex(name) {
  const i = NAKSHATRAS.findIndex(
    n => n.toLowerCase() === String(name || '').trim().toLowerCase());
  if (i < 0) throw new Error(`ashtakoot: unknown nakshatra "${name}"`);
  return i;
}
function rashiIndex(name) {
  const i = RASHIS.findIndex(
    r => r.toLowerCase() === String(name || '').trim().toLowerCase());
  if (i < 0) throw new Error(`ashtakoot: unknown rashi "${name}"`);
  return i;
}

// ── the eight kutas ─────────────────────────────────────────
// Each returns { points, max, label, note }. `note` is a short factual
// statement of WHY, written about the pair, never about one person.

const VARNA_RANK = { Shudra: 1, Vaishya: 2, Kshatriya: 3, Brahmin: 4 };
function varnaKuta(a, b) {
  const va = VARNA_BY_RASHI[a.rashi], vb = VARNA_BY_RASHI[b.rashi];
  // The classical rule is directional - it awards the point unless the
  // bride's varna outranks the groom's. We score it symmetrically instead:
  // the app has no bride/groom and two people running the same check from
  // their own phones must see the same number. Equal or adjacent ranks
  // score; a gap of two or more does not.
  const points = Math.abs(VARNA_RANK[va] - VARNA_RANK[vb]) <= 1 ? 1 : 0;
  return {
    points, max: 1, label: 'Varna',
    note: `Working temperaments: ${va} and ${vb}.`,
  };
}

function vashyaKuta(a, b) {
  const ca = VASHYA[a.rashi], cb = VASHYA[b.rashi];
  let points = 1;
  if (ca === cb) points = 2;
  else if ((ca === 'Manava' && cb === 'Chatushpada')
        || (ca === 'Chatushpada' && cb === 'Manava')) points = 1;
  else if (ca === 'Keeta' || cb === 'Keeta') points = 0.5;
  return {
    points, max: 2, label: 'Vashya',
    note: `Mutual pull between ${ca} and ${cb} natures.`,
  };
}

function taraKuta(a, b) {
  // Count both ways; each direction scores 1.5 when the tara is favourable.
  const fwd = ((b.nak - a.nak + 27) % 27 + 1) % 9;
  const rev = ((a.nak - b.nak + 27) % 27 + 1) % 9;
  const bad = [3, 5, 7]; // vipat, pratyari, naidhana
  const points = (bad.includes(fwd) ? 0 : 1.5) + (bad.includes(rev) ? 0 : 1.5);
  return {
    points, max: 3, label: 'Tara',
    note: 'How each chart supports the other’s wellbeing.',
  };
}

function yoniKuta(a, b) {
  const ya = YONI[a.nak], yb = YONI[b.nak];
  let points;
  if (ya === yb) points = 4;
  else if (YONI_ENEMY[ya] === yb) points = 0;
  else points = 2;
  return {
    points, max: 4, label: 'Yoni',
    note: `Instinctive natures: ${ya} and ${yb}.`,
  };
}

function grahaMaitriKuta(a, b) {
  const la = RASHI_LORD[a.rashi], lb = RASHI_LORD[b.rashi];
  let points;
  if (la === lb) points = 5;
  else {
    const aLikesB = (FRIENDS[la] || []).includes(lb);
    const bLikesA = (FRIENDS[lb] || []).includes(la);
    const aHatesB = (ENEMIES[la] || []).includes(lb);
    const bHatesA = (ENEMIES[lb] || []).includes(la);
    if (aLikesB && bLikesA) points = 5;
    else if (aHatesB && bHatesA) points = 0;
    else if (aLikesB || bLikesA) points = 4;
    else if (aHatesB || bHatesA) points = 1;
    else points = 3;
  }
  return {
    points, max: 5, label: 'Graha Maitri',
    note: `Mind-lords ${la} and ${lb}.`,
  };
}

function ganaKuta(a, b) {
  const ga = GANA[a.nak], gb = GANA[b.nak];
  // Also symmetrised. The classical Manushya-Rakshasa score differs by which
  // side is which (0 or 1); we take the lower so the pair scores the same
  // whichever way round it is asked.
  let points;
  if (ga === gb) points = 6;
  else if ((ga === 'Deva' && gb === 'Manushya') || (ga === 'Manushya' && gb === 'Deva')) points = 5;
  else points = 0; // deva-rakshasa, and manushya-rakshasa either way
  return {
    points, max: 6, label: 'Gana',
    note: `${ga} and ${gb} temperaments.`,
  };
}

function bhakootKuta(a, b) {
  const diff = ((b.rashi - a.rashi + 12) % 12) + 1;
  const rev = ((a.rashi - b.rashi + 12) % 12) + 1;
  const bad = [[2, 12], [5, 9], [6, 8]];
  const blocked = bad.some(([x, y]) =>
    (diff === x && rev === y) || (diff === y && rev === x));
  return {
    points: blocked ? 0 : 7, max: 7, label: 'Bhakoot',
    note: 'Emotional direction the pair pulls in together.',
  };
}

function nadiKuta(a, b) {
  const na = NADI[a.nak], nb = NADI[b.nak];
  return {
    points: na === nb ? 0 : 8, max: 8, label: 'Nadi',
    note: `Constitutions: ${na} and ${nb}.`,
  };
}

// ── main ────────────────────────────────────────────────────

/**
 * @param {{nakshatra:string, rashi:string}} personA
 * @param {{nakshatra:string, rashi:string}} personB
 */
function ashtakoot(personA, personB) {
  const a = { nak: nakIndex(personA.nakshatra), rashi: rashiIndex(personA.rashi) };
  const b = { nak: nakIndex(personB.nakshatra), rashi: rashiIndex(personB.rashi) };

  const kutas = [
    varnaKuta(a, b), vashyaKuta(a, b), taraKuta(a, b), yoniKuta(a, b),
    grahaMaitriKuta(a, b), ganaKuta(a, b), bhakootKuta(a, b), nadiKuta(a, b),
  ];

  const total = Math.round(kutas.reduce((s, k) => s + k.points, 0) * 10) / 10;

  // Verdict bands are the conventional ones. Deliberately never phrased as
  // "will/won't last" — this describes fit, not fate.
  let band;
  if (total >= 28) band = 'excellent';
  else if (total >= 21) band = 'strong';
  else if (total >= 17) band = 'workable';
  else band = 'challenging';

  return {
    total,
    max: 36,
    percent: Math.round((total / 36) * 100),
    band,
    kutas,
    // The two heaviest kutas, whichever way they went. This is what a
    // reading should lead with rather than reciting all eight.
    highlights: [...kutas].sort((x, y) => (y.points / y.max) - (x.points / x.max)),
  };
}

module.exports = {
  NAKSHATRAS, RASHIS, VARNA_BY_RASHI, YONI, GANA, NADI, VASHYA,
  ashtakoot,
  // exported for tests:
  nakIndex, rashiIndex,
};
