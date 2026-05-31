// =========================================
// MARRIAGE RULES — 20 classical rules
// =========================================
//
// Encoded from:
//   - Brihat Parashara Hora Shastra (BPHS) Ch.80 (Kalatra Bhava)
//   - Phaladeepika Ch.19 (Effects of the 7th House)
//   - Saravali Ch.34 (Marriage and Spouse)
//
// Each rule is a deterministic predicate. The LLM presenter receives
// only matched rules — it cannot invent marriage predictions outside
// these rules + the chart facts.
//
// Intensity scale:
//   1-3: subtle background influence
//   4-6: noticeable trend
//   7-8: strong indicator
//   9-10: defining feature of marriage chart

const {
  planetSign, planetHouse, lordOfHouse, planetsInHouse,
  isOwnSign, isExalted, isDebilitated, aspectsHouse,
  MALEFICS, dashaActive, dashaIntensity,
} = require('./schema');

module.exports = [
  // ============== POSITIVE INDICATORS ==============

  {
    id: 'venus_in_7th',
    domain: 'marriage',
    source: { book: 'Phaladeepika', chapter: 19, verse: '5' },
    note: 'Venus is the universal karaka for marriage and partnership.',
    prediction: {
      polarity: 'positive',
      text: 'Attractive spouse, romantic and affectionate marriage. Strong physical and emotional bond.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      if (planetHouse(c, 'Venus') !== 7) return { matched: false };
      const debil = isDebilitated(c, 'Venus');
      return {
        matched: true,
        intensity: debil ? 4 : 8,
        evidence: `Venus in 7th house${debil ? ' (debilitated — strength reduced)' : ''}`,
      };
    },
  },

  {
    id: 'jupiter_aspects_7th',
    domain: 'marriage',
    source: { book: 'BPHS', chapter: 80, verse: '12' },
    prediction: {
      polarity: 'positive',
      text: 'Marriage is harmonious and dharmic. Spouse is virtuous, supportive, and morally aligned.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      if (!aspectsHouse(c, 'Jupiter', 7)) return { matched: false };
      // Stronger if Jupiter is dignified
      const dignified = isOwnSign(c, 'Jupiter') || isExalted(c, 'Jupiter');
      return {
        matched: true,
        intensity: dignified ? 9 : 7,
        evidence: `Jupiter aspects/occupies 7th house${dignified ? ' (dignified)' : ''}`,
      };
    },
  },

  {
    id: 'seventh_lord_in_kendra',
    domain: 'marriage',
    source: { book: 'BPHS', chapter: 80, verse: '15' },
    prediction: {
      polarity: 'positive',
      text: 'Strong marital prospects. Marriage manifests at appropriate time without major struggle.',
      timeframe: 'currentDasha',
    },
    predicate: (c) => {
      const l7 = lordOfHouse(c, 7);
      if (!l7) return { matched: false };
      const h = planetHouse(c, l7);
      if (![1, 4, 7, 10].includes(h)) return { matched: false };
      return {
        matched: true,
        intensity: 7,
        evidence: `7th lord ${l7} placed in kendra (house ${h})`,
      };
    },
  },

  {
    id: 'seventh_lord_own_or_exalted',
    domain: 'marriage',
    source: { book: 'Phaladeepika', chapter: 19, verse: '3' },
    prediction: {
      polarity: 'positive',
      text: 'Marriage to a person from a good family. Stable, long-lasting partnership.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      const l7 = lordOfHouse(c, 7);
      if (!l7) return { matched: false };
      if (!isOwnSign(c, l7) && !isExalted(c, l7)) return { matched: false };
      return {
        matched: true,
        intensity: 8,
        evidence: `7th lord ${l7} ${isExalted(c, l7) ? 'exalted' : 'in own sign'} (${planetSign(c, l7)})`,
      };
    },
  },

  {
    id: 'venus_jupiter_conjunction',
    domain: 'marriage',
    source: { book: 'Saravali', chapter: 34, verse: '11' },
    prediction: {
      polarity: 'positive',
      text: 'Refined, mutually respectful partnership. Marriage brings spiritual + material growth together.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      const vSign = planetSign(c, 'Venus');
      const jSign = planetSign(c, 'Jupiter');
      if (!vSign || !jSign || vSign !== jSign) return { matched: false };
      return {
        matched: true,
        intensity: 7,
        evidence: `Venus + Jupiter conjunct in ${vSign}`,
      };
    },
  },

  // ============== TIMING / DASHA INDICATORS ==============

  {
    id: 'currently_in_venus_dasha',
    domain: 'marriage',
    source: { book: 'BPHS', chapter: 80, verse: '20' },
    prediction: {
      polarity: 'positive',
      text: 'Venus active in dasha — period naturally favourable for marriage proposals, partnerships, romantic events.',
      timeframe: 'currentDasha',
    },
    predicate: (c) => {
      const layer = dashaActive(c, 'Venus');
      if (!layer) return { matched: false };
      return {
        matched: true,
        intensity: dashaIntensity(layer),
        evidence: `Venus active at ${layer} level (${c.dasha.mahadasha}/${c.dasha.antardasha}/${c.dasha.pratyantar || '-'})`,
      };
    },
  },

  {
    id: 'seventh_lord_dasha_active',
    domain: 'marriage',
    source: { book: 'BPHS', chapter: 80, verse: '21' },
    prediction: {
      polarity: 'positive',
      text: 'Dasha/bhukti/pratyantar of 7th-house lord active — classical primary trigger for marriage event.',
      timeframe: '7thLordDasha',
    },
    predicate: (c) => {
      const l7 = lordOfHouse(c, 7);
      if (!l7) return { matched: false };
      const layer = dashaActive(c, l7);
      if (!layer) return { matched: false };
      return {
        matched: true,
        intensity: dashaIntensity(layer) + 1, // +1 because 7L is the master trigger
        evidence: `7th lord ${l7} active at ${layer} level`,
      };
    },
  },

  // NEW: Jupiter dasha — women's universal marriage karaka
  {
    id: 'jupiter_dasha_marriage',
    domain: 'marriage',
    source: { book: 'Phaladeepika', chapter: 19, verse: '22' },
    note: 'Jupiter is the universal marriage karaka for women (Venus for men, but Jupiter still active for both).',
    prediction: {
      polarity: 'positive',
      text: 'Jupiter active in dasha — favourable for marriage event, especially for women. Period of expansion in relationships.',
      timeframe: 'currentDasha',
    },
    predicate: (c) => {
      const layer = dashaActive(c, 'Jupiter');
      if (!layer) return { matched: false };
      return {
        matched: true,
        intensity: dashaIntensity(layer) - 1,
        evidence: `Jupiter active at ${layer} level`,
      };
    },
  },

  // NEW: dasha of 7th-lord's dispositor (where 7L sits' lord)
  {
    id: 'seventh_lord_dispositor_dasha',
    domain: 'marriage',
    source: { book: 'BPHS', chapter: 80, verse: '24' },
    prediction: {
      polarity: 'positive',
      text: 'Dasha of 7th-lord\'s dispositor active — secondary classical marriage timing window.',
      timeframe: 'currentDasha',
    },
    predicate: (c) => {
      const l7 = lordOfHouse(c, 7); if (!l7) return { matched: false };
      const l7sign = planetSign(c, l7); if (!l7sign) return { matched: false };
      const SIGN_LORD = require('./schema').SIGN_LORD;
      const dispositor = SIGN_LORD[l7sign];
      if (!dispositor || dispositor === l7) return { matched: false };
      const layer = dashaActive(c, dispositor);
      if (!layer) return { matched: false };
      return {
        matched: true,
        intensity: dashaIntensity(layer) - 1,
        evidence: `7th-lord ${l7} dispositor ${dispositor} active at ${layer} level`,
      };
    },
  },

  // NEW: Jupiter transit through 7th from natal Moon (classical
  // event-trigger for marriage; Phaladeepika Ch.26)
  {
    id: 'jupiter_transit_seventh_from_moon',
    domain: 'marriage',
    source: { book: 'Phaladeepika', chapter: 26, verse: '8' },
    prediction: { polarity: 'positive', text: 'Jupiter currently transits the 7th-from-natal-Moon — classical marriage-trigger window.', timeframe: 'transit' },
    predicate: (c) => {
      if (!c.transits || !c.transits.jupiter) return { matched: false };
      if (c.transits.jupiter.houseFromMoon !== 7) return { matched: false };
      return { matched: true, intensity: 8, evidence: `Jupiter transiting 7th from Moon (event-date)` };
    },
  },

  // NEW: Double transit on 7th house
  {
    id: 'double_transit_seventh',
    domain: 'marriage',
    source: { book: 'BPHS', chapter: 45, verse: '21' },
    note: 'Strongest classical single trigger — Saturn AND Jupiter both aspecting/occupying same house.',
    prediction: { polarity: 'positive', text: 'Double transit (Saturn + Jupiter) on the 7th house — classical strongest marriage-event trigger.', timeframe: 'transit' },
    predicate: (c) => {
      if (!c.transits || !c.transits.doubleTransits) return { matched: false };
      const dt7 = c.transits.doubleTransits.find(d => d.house === 7);
      if (!dt7) return { matched: false };
      return { matched: true, intensity: 10, evidence: 'Saturn + Jupiter double transit on 7th' };
    },
  },

  // NEW: D9 ascendant lord in dasha
  {
    id: 'd9_lagna_lord_dasha',
    domain: 'marriage',
    source: { book: 'BPHS', chapter: 80, verse: '34' },
    note: 'D9 (Navamsha) lagna lord is the inner-marriage signator.',
    prediction: {
      polarity: 'positive',
      text: 'Dasha of D9 ascendant lord — inner-marriage signator active. Often when courtship deepens or commitment is made.',
      timeframe: 'currentDasha',
    },
    predicate: (c) => {
      if (!c.d9Navamsha || !c.d9Navamsha.Ascendant) return { matched: false };
      const d9Asc = String(c.d9Navamsha.Ascendant).replace(/\(.*\)/, '').trim();
      const SIGN_LORD = require('./schema').SIGN_LORD;
      const d9Lord = SIGN_LORD[d9Asc];
      if (!d9Lord) return { matched: false };
      const layer = dashaActive(c, d9Lord);
      if (!layer) return { matched: false };
      return {
        matched: true,
        intensity: dashaIntensity(layer) - 1,
        evidence: `D9 lagna lord ${d9Lord} (D9 asc ${d9Asc}) active at ${layer} level`,
      };
    },
  },

  // ============== NEGATIVE INDICATORS ==============

  {
    id: 'seventh_lord_in_dusthana',
    domain: 'marriage',
    source: { book: 'Phaladeepika', chapter: 19, verse: '7' },
    prediction: {
      polarity: 'negative',
      text: 'Marriage faces delays, complications, or unconventional path. May marry late, or partner from distant place / different background.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      const l7 = lordOfHouse(c, 7);
      if (!l7) return { matched: false };
      const h = planetHouse(c, l7);
      if (![6, 8, 12].includes(h)) return { matched: false };
      return {
        matched: true,
        intensity: 7,
        evidence: `7th lord ${l7} placed in dusthana (house ${h})`,
      };
    },
  },

  {
    id: 'seventh_lord_debilitated',
    domain: 'marriage',
    source: { book: 'Phaladeepika', chapter: 19, verse: '9' },
    prediction: {
      polarity: 'negative',
      text: 'Marital disagreements, lack of comfort from spouse. Effort needed to maintain harmony.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      const l7 = lordOfHouse(c, 7);
      if (!l7) return { matched: false };
      if (!isDebilitated(c, l7)) return { matched: false };
      return {
        matched: true,
        intensity: 6,
        evidence: `7th lord ${l7} debilitated in ${planetSign(c, l7)}`,
      };
    },
  },

  {
    id: 'venus_debilitated',
    domain: 'marriage',
    source: { book: 'Saravali', chapter: 34, verse: '18' },
    prediction: {
      polarity: 'negative',
      text: 'Lower sensual / romantic fulfillment in marriage. Spouse may seem distant in physical affection.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      if (!isDebilitated(c, 'Venus')) return { matched: false };
      return { matched: true, intensity: 5, evidence: 'Venus debilitated in Virgo' };
    },
  },

  {
    id: 'saturn_in_7th',
    domain: 'marriage',
    source: { book: 'BPHS', chapter: 80, verse: '17' },
    prediction: {
      polarity: 'mixed',
      text: 'Late marriage, often with an older or more mature partner. Slow to commit but very stable once formed.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      if (planetHouse(c, 'Saturn') !== 7) return { matched: false };
      const dignified = isOwnSign(c, 'Saturn') || isExalted(c, 'Saturn');
      return {
        matched: true,
        intensity: dignified ? 6 : 7,
        evidence: `Saturn in 7th house${dignified ? ' (dignified — stable)' : ''}`,
      };
    },
  },

  {
    id: 'sun_in_7th',
    domain: 'marriage',
    source: { book: 'Phaladeepika', chapter: 19, verse: '11' },
    prediction: {
      polarity: 'mixed',
      text: 'Strong-willed, authoritative spouse. Possible ego clashes — partnership requires deliberate humility.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      if (planetHouse(c, 'Sun') !== 7) return { matched: false };
      return { matched: true, intensity: 6, evidence: 'Sun in 7th house' };
    },
  },

  {
    id: 'rahu_in_7th',
    domain: 'marriage',
    source: { book: 'BPHS', chapter: 80, verse: '23' },
    prediction: {
      polarity: 'mixed',
      text: 'Unconventional partnership — spouse from different culture, region, religion, or background. Strong attraction but unconventional dynamic.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      if (planetHouse(c, 'Rahu') !== 7) return { matched: false };
      return { matched: true, intensity: 7, evidence: 'Rahu in 7th house' };
    },
  },

  {
    id: 'ketu_in_7th',
    domain: 'marriage',
    source: { book: 'BPHS', chapter: 80, verse: '24' },
    prediction: {
      polarity: 'mixed',
      text: 'Spiritual or detached approach to partnership. May feel emotionally distant in marriage, or partner is spiritually inclined.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      if (planetHouse(c, 'Ketu') !== 7) return { matched: false };
      return { matched: true, intensity: 6, evidence: 'Ketu in 7th house' };
    },
  },

  // ============== MANGAL DOSHA (with cancellations) ==============

  {
    id: 'mangal_dosha',
    domain: 'marriage',
    source: { book: 'Phaladeepika', chapter: 19, verse: '14' },
    note: 'Mangal Dosha — Mars in 1/2/4/7/8/12 from Lagna, Moon, OR Venus. Famous match-making concern. Many cancellations exist in classical literature.',
    prediction: {
      polarity: 'negative',
      text: 'Mangal Dosha present — classical concern about marital harmony, possible conflicts. Mitigated by partner with similar dosha, or by aspects of benefics on Mars.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      const dosha_houses = [1, 2, 4, 7, 8, 12];
      const marsHouseLagna = planetHouse(c, 'Mars');
      if (marsHouseLagna < 0) return { matched: false };
      const fromLagna = dosha_houses.includes(marsHouseLagna);
      // From Moon
      const moonH = planetHouse(c, 'Moon');
      const marsFromMoon = moonH > 0 ? ((marsHouseLagna - moonH + 12) % 12) + 1 : -1;
      const fromMoon = dosha_houses.includes(marsFromMoon);
      // From Venus
      const venusH = planetHouse(c, 'Venus');
      const marsFromVenus = venusH > 0 ? ((marsHouseLagna - venusH + 12) % 12) + 1 : -1;
      const fromVenus = dosha_houses.includes(marsFromVenus);
      if (!fromLagna && !fromMoon && !fromVenus) return { matched: false };

      // Cancellations
      if (isOwnSign(c, 'Mars') || isExalted(c, 'Mars')) {
        return { matched: true, cancelled: 'Mars in own/exalted sign — dosha nullified' };
      }
      if (aspectsHouse(c, 'Jupiter', marsHouseLagna)) {
        return { matched: true, cancelled: 'Jupiter aspects Mars — dosha mitigated' };
      }
      if (aspectsHouse(c, 'Saturn', marsHouseLagna)) {
        return { matched: true, cancelled: 'Saturn aspects Mars — dosha mitigated' };
      }

      const sources = [];
      if (fromLagna) sources.push(`${marsHouseLagna} from Lagna`);
      if (fromMoon) sources.push(`${marsFromMoon} from Moon`);
      if (fromVenus) sources.push(`${marsFromVenus} from Venus`);
      return {
        matched: true,
        intensity: sources.length >= 2 ? 8 : 6,
        evidence: `Mars in dosha house — ${sources.join(', ')}`,
      };
    },
  },

  // ============== MISC / STRUCTURAL ==============

  {
    id: 'malefics_2nd_and_7th',
    domain: 'marriage',
    source: { book: 'BPHS', chapter: 80, verse: '29' },
    prediction: {
      polarity: 'negative',
      text: 'Concerns about marriage stability and family harmony together. Consider remedies for the involved malefics.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      const h2 = planetsInHouse(c, 2).filter(p => MALEFICS.includes(p));
      const h7 = planetsInHouse(c, 7).filter(p => MALEFICS.includes(p));
      if (h2.length === 0 || h7.length === 0) return { matched: false };
      return {
        matched: true,
        intensity: 6,
        evidence: `Malefics in 2nd (${h2.join(', ')}) and 7th (${h7.join(', ')})`,
      };
    },
  },

  {
    id: 'multiple_planets_in_7th',
    domain: 'marriage',
    source: { book: 'Phaladeepika', chapter: 19, verse: '21' },
    prediction: {
      polarity: 'mixed',
      text: 'Multiple planets in 7th — complex marital life. Possibility of multiple significant relationships, or marriage involving multiple parties (joint family complexity, etc.).',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      const planets = planetsInHouse(c, 7);
      if (planets.length < 3) return { matched: false };
      return {
        matched: true,
        intensity: 5,
        evidence: `${planets.length} planets in 7th: ${planets.join(', ')}`,
      };
    },
  },

  {
    id: 'd9_seventh_lord_debilitated',
    domain: 'marriage',
    source: { book: 'BPHS', chapter: 80, verse: '32' },
    note: 'D9 (Navamsha) is the divisional chart specifically for marriage — inner reality of partnership.',
    prediction: {
      polarity: 'negative',
      text: 'Outer marriage may seem fine but inner tension or dissatisfaction may exist. D9 reveals what surface chart hides.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      // Use d9Navamsha map already in chart output
      const d9 = c.d9Navamsha;
      if (!d9 || !d9.Ascendant) return { matched: false };
      // Find 7th sign from D9 ascendant
      const SIGN_ORDER = require('./schema').SIGN_ORDER;
      const d9LagIdx = SIGN_ORDER.findIndex(
        s => s.toLowerCase() === String(d9.Ascendant).toLowerCase().replace(/\(.*\)/, '').trim());
      if (d9LagIdx < 0) return { matched: false };
      const d9SeventhSign = SIGN_ORDER[(d9LagIdx + 6) % 12];
      const SIGN_LORD = require('./schema').SIGN_LORD;
      const d9L7 = SIGN_LORD[d9SeventhSign];
      // Where is d9L7 in D9?
      const d9Pos = d9[d9L7];
      if (!d9Pos) return { matched: false };
      const debilSign = require('./schema').DEBIL_SIGN[d9L7];
      if (String(d9Pos).toLowerCase().includes(String(debilSign).toLowerCase())) {
        return {
          matched: true,
          intensity: 6,
          evidence: `D9 7th lord ${d9L7} debilitated in D9`,
        };
      }
      return { matched: false };
    },
  },

  {
    id: 'darakaraka_strong_d9',
    domain: 'marriage',
    source: { book: 'Jaimini Sutras', chapter: 1, verse: '36' },
    note: 'Darakaraka (DK) = the planet that signifies the spouse per Jaimini.',
    prediction: {
      polarity: 'positive',
      text: 'Darakaraka well-placed in D9 chart — indicates a spouse aligned with your soul-purpose. Marriage feels destined.',
      timeframe: 'lifetime',
    },
    predicate: (c) => {
      if (!c.karakas || !c.karakas.Darakaraka) return { matched: false };
      const dk = c.karakas.Darakaraka.planet;
      const d9Sign = c.d9Navamsha && c.d9Navamsha[dk];
      if (!d9Sign) return { matched: false };
      const ownSigns = require('./schema').OWN_SIGNS[dk] || [];
      const exaltSign = require('./schema').EXALT_SIGN[dk];
      const signName = String(d9Sign).replace(/\(.*\)/, '').trim();
      if (ownSigns.includes(signName) || signName === exaltSign) {
        return {
          matched: true,
          intensity: 7,
          evidence: `Darakaraka ${dk} in own/exalted sign in D9 (${signName})`,
        };
      }
      return { matched: false };
    },
  },
];
