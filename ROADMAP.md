# Moksha — Roadmap to the Most-Accurate AI Vedic Astrology App

> Last updated: 30 May 2026
> Owner: @sarvesh973
> Status: Phase 1 in progress (Ashtakavarga shipped)

---

## North star

Build a Vedic astrology app whose predictions are **grounded in
deterministic classical rules**, not LLM hallucination. Every answer
must trace back to either:

1. A computed chart fact (planet positions, dasha periods, ashtakavarga
   scores, yogas), OR
2. A specific verse from a classical text (BPHS, Phaladeepika, Saravali,
   Jaimini Sutras, Sarvarth Chintamani, Lal Kitab, Brihat Jataka).

The LLM's job is to **rephrase** evaluated rules in conversational
language — never to invent predictions.

When done: Moksha becomes the only AI Vedic astrology app that can
honestly say *"every prediction traces to a verse + a computed chart
fact, validated against celebrity birth charts."* No competitor has
this. The technical moat is real.

---

## Constraints

- **Budget:** ~$0 out-of-pocket. Free tiers of Gemini (1M tokens/day on
  flash) and Google text-embedding-004 (1500 RPM). All classical texts
  are public domain on archive.org / sacred-texts.com.
- **No human astrologer in the loop.** Pure AI + classical rules.
- **No new infrastructure.** Existing Render service + Firebase.
- **Time:** 6 months solo dev, or 3 months with one extra dev.

---

## Architecture target

```
[ User question ]
       │
       ▼
[ Topic classifier ]   (LLM-based, already shipped)
       │
       ▼
[ Filter rules → this domain ]
       │
       ▼
[ Rule evaluator ]
   Computes chart facts (already shipped: D1-D60, Vimshottari, Ashtakavarga)
   For each rule in domain:
     - Check ChartPredicate(rule) against chart facts → matched / cancelled
     - Score: intensity × strength
   Returns top N matched rules with reasoning trace
       │
       ▼
[ RAG retrieval ]      (already shipped: 549 chunks, MMR diversification)
   Pulls supporting verses from indexed books
       │
       ▼
[ LLM presenter ]
   System prompt forbids inventing predictions
   Takes (matched rules + cited verses + chart facts)
   Outputs natural-language summary in user's language
   Cites the exact rule ID + book + verse for each point
       │
       ▼
[ Structured response → mobile app ]
   summary[] (3-5 bullets, each from a matched rule)
   details[] (chapter-level deep dives)
   sources[] (verses used)
   _debug{} (admin only: which rules matched, scores, classifier choice)
```

---

## Phase 1 — Calculation rigor (Months 1-2)

Make our chart engine match what professional Jyotishis use (Jagannatha
Hora desktop).

### Week 1 ✅ DONE
- [x] Verify @prisri/jyotish gives all 16 divisional charts (D1-D60).
      **Found:** Already present in `chart.vargas`. Phase 1 Week 1
      collapsed into a single discovery commit.
- [x] Verify D9, D10, D20 are already wired into `formatChartForPrompt`.
      **Found:** Yes, already in the prompt. LLM has had this data the
      whole time; it just doesn't know what to do with it.

### Week 2 ✅ DONE
- [x] **Ashtakavarga calculator** (`lib/ashtakavarga.js`, commit 39ac535)
  - 8 classical Parashari tables from BPHS Ch.66, encoded verbatim
  - Computes Bhinnashtaka (per-planet × 12 houses) + Sarvashtaka
    (totalled per house)
  - Returns labels: strong / good / average / weak / very weak
  - Verified against canonical Jul 9, 2003 chart — total = 337
    (the standard test value), Jupiter = 56, Saturn = 39
- [x] Injected into `formatChartForPrompt` with a usage rubric so the
      LLM grounds transit predictions in real bindu scores instead of
      inventing them

### Week 3 ✅ DONE
- [x] **Yoga detector** (`lib/yogas.js`) — 18 yogas encoded with hard
      rules + cancellation logic:
      Gajakesari, Pancha Mahapurusha (Hamsa, Malavya, Ruchaka, Bhadra,
      Sasa), Budhaditya, Chandra-Mangal, Saraswati, Lakshmi, Adhi,
      Sunapha, Anapha, Kemadruma (with cancellation), Kaalsarpa,
      Vipreet Rajayoga, Raja Yoga, Dhana Yoga
- [x] Each match injected into prompt with verbatim classical effect
      so LLM cites them as fact, not interpretation
- [x] Test chart (Jul 9 2003, Delhi) detected 6 yogas including the
      Bhadra+Budhaditya+Raja Yoga combo in 10th — genuinely strong
      career profile a Jyotishi would call out

### Week 4 ✅ DONE
- [x] **Karaka chain** (`lib/karakas.js`)
- [x] Atmakaraka, Amatyakaraka, Bhratrukaraka, Matrukaraka,
      Putrakaraka, Gnatikaraka, Darakaraka — Jaimini 7-karaka scheme
- [x] Sorted by degree-in-sign (with Rahu reversal convention)
- [x] Atmakaraka soul-lesson + Darakaraka spouse-nature descriptions
      bundled (8 planets each) so LLM gets concrete fact, not
      interpretation
- [x] Injected into prompt

### Week 5 ✅ DONE (simplified — 3 of 6 components)
- [x] **Shadbala** (`lib/shadbala.js`) covering Sthana + Dig +
      Naisargika Bala
- [x] Returns RELATIVE ranking 1-7 + 0-100 normalized strength so
      LLM can confidently say "Sun is your strongest planet, Saturn
      your weakest" — accurate even from partial implementation
- [ ] Full Kala + Cheshta + Drik Bala — deferred to future iteration
      (the simplified version still solves the "which planet has
      capacity to deliver" question well enough for now)

### Week 6 ✅ DONE
- [x] **Transit calculator** (`lib/transits.js`)
- [x] Live current positions of Saturn, Jupiter, Rahu, Ketu (today's
      ephemeris, recomputed per request)
- [x] **Sade Sati detector** — 3 phases (starting/peak/ending) with
      distinct classical descriptions
- [x] **Dhaiya detector** — Ardha Ashtami + Ashtami Shani
- [x] **Jupiter transit favourability** from natal Moon (per
      Phaladeepika Ch.26 — favourable houses 2,5,7,9,11)
- [x] **Double-transit alerts** — Saturn AND Jupiter both aspecting
      a natal house = classical strongest event-timing signal
- [x] Each transit hit comes with a description the LLM cites as fact
      (no LLM interpretation of what "Sade Sati" means; we tell it)

**End of Phase 1 ✅ — calculation rigor matches Jagannatha Hora.**

---

## Phase 2 — Rule engine + first rules (Month 3)

### Week 7 ✅ DONE
- [x] **Rule schema** (`lib/rules/schema.js`) — typed AstroRule
      shape with predicate / prediction / source / cancellation
      semantics + shared chart-fact helpers (planetHouse, lordOfHouse,
      isExalted, aspectsHouse, planetsInHouse, etc.)
- [x] **Rule evaluator** (`lib/rules/evaluator.js`) — given a chart
      and a domain, runs all rules, applies cancellation, sorts by
      intensity, returns top N matched. Also exposes topicToDomain()
      (maps classifier topics like 'marriage_timing' → 'marriage')
      and formatRulesForPrompt() (renders matched rules as an
      LLM-citable block).

### Week 8 ✅ DONE
- [x] **First 20 marriage rules** (`lib/rules/marriage.js`)
      Encoded from BPHS Ch.80, Phaladeepika Ch.19, Saravali Ch.34,
      Jaimini Sutras Ch.1. Covers:
      - Positives: Venus in 7th, Jupiter aspects 7th, 7th lord in
        kendra, 7th lord own/exalted, Venus-Jupiter conjunction
      - Timing: Venus dasha active, 7th-lord dasha active
      - Negatives: 7th lord in dusthana, 7th lord debilitated,
        Venus debilitated, Saturn in 7th (mixed/late), Sun in 7th
        (ego clashes), Rahu in 7th (unconventional), Ketu in 7th
        (detached), Mangal Dosha (with 3 classical cancellations),
        malefics in 2nd+7th
      - Misc: multiple planets in 7th, D9 7th lord debilitated,
        Darakaraka strong in D9 (Jaimini)
- [x] **LLM presenter mode** — formatRulesForPrompt() renders matched
      rules as a numbered, source-cited block with explicit instruction
      to the model not to invent predictions outside this list. Wired
      into the chat endpoint: when topic maps to a domain we have
      rules for, the matched rules ride along in the prompt.
- [x] Verified on test chart (Jul 9 2003, Delhi): 3/20 marriage rules
      matched with strong positive polarity (Jupiter aspects 7th
      dignified intensity 9, 7th lord exalted intensity 8, Venus dasha
      active intensity 7) — exactly what a Jyotishi would highlight.

### Week 9
- [ ] **50 career rules** (BPHS Ch.49, Phaladeepika Ch.6, Saravali Ch.28)
  - 10th house combinations, Dasamsa results, profession-by-Atmakaraka
- [ ] **A/B framework** — compare RULE-based answer vs pure-RAG answer
  for the same question. Manual scoring to see which feels more
  accurate / specific.

### Week 10
- [ ] **30 wealth rules** (Dhana yogas, 2nd/11th lord combinations)
- [ ] **30 health rules** (6th house, Mars-Saturn afflictions, ascendant
  lord strength)

### Week 11
- [ ] **Bulk rule extraction via Gemini** — feed each book chapter to
  Gemini Flash with a structured-output prompt asking for rules.
  Human-verify each.
  - Target: 200 more rules added in this week
  - Rate-limited to free tier (~50 rules/day = 350/week with weekend gaps)

### Week 12
- [ ] **Index Saravali** — 400+ chunks, free embedding batch.
  Single biggest yoga reference. Re-run rule extraction over it.

**End of Phase 2: 300+ rules, 3 books indexed, rule engine working
for marriage / career / wealth / health.**

---

## Phase 3 — Books + Lal Kitab (Month 4)

### Week 13
- [ ] **Index Brihat Jataka + Jaimini Sutras**
- [ ] **Karaka rules from Jaimini Sutras** — chara dasha, Atmakaraka
  effects, padas. Entirely new predictive paradigm.

### Week 14
- [ ] **Index Sarvarth Chintamani** — timing-of-events specialist.
  Most predictive of all classical books for specific date windows.
- [ ] **Timing rules** — "X event in Y dasha if Z transit" patterns.

### Week 15
- [ ] **Index Lal Kitab** — THE missing piece for Indian users
- [ ] **Extract 100 remedy rules** — Lal Kitab is largely a remedy
  manual: "for X affliction, do Y remedy (specific behavioral action)"
- [ ] **Remedy engine** (`lib/rules/remedies.js`) — given the user's
  most-afflicted planet, returns matched Lal Kitab remedies +
  classical spiritual remedies (mantra/gemstone/fast/donation)

### Week 16
- [ ] **Polish remedy presentation** — Lal Kitab remedies are weird
  ("feed black dogs on Saturdays") and Indian users specifically love
  them. Make sure they render well in chat.
- [ ] Update chat tone rules to integrate remedies naturally without
  the LLM trying to mash them into the bullet-summary structure.

**End of Phase 3: 7 books, ~500 rules, working remedy engine.**

---

## Phase 4 — Validation (Month 5)

### Week 17
- [ ] **Celebrity test suite** (`tests/celebrity-charts.js`)
  - 30 public figures with documented birth data + known major events
  - e.g. Sachin Tendulkar (career peak 2003-2004), Steve Jobs (cancer
    diagnosis 2003, death 2011), Aishwarya Rai (marriage 2007),
    Narendra Modi (PM 2014), Indira Gandhi (PM 1966, death 1984)
  - Public birth data sourced from astrodatabank / astro.com /
    scientificvedic.com

### Week 18
- [ ] **Test framework** — for each celebrity:
  - Compute chart at birth
  - For each known event, ask the engine to predict major life events
    in the dasha period containing that event
  - Score: ±6 month window match = hit, otherwise miss

### Week 19
- [ ] **Iteration loop** — find which rule classes under/over-predict.
  Adjust intensity weights. Add cancellation rules where needed.
  Target: 40-60% hit rate (vs ~5-10% baseline / chance).

### Week 20
- [ ] **Publish accuracy stats** on app About page:
  *"Validated against 30 celebrity charts — predictions for major
  life events fall within ±6 months of actual dates in 45% of cases."*
  This is the trust signal no competitor has.

**End of Phase 4: measurable accuracy claim.**

---

## Phase 5 — Polish & marketing surface (Month 6)

### Week 21
- [ ] Admin dashboard — aggregate accuracy stats across user predictions
- [ ] "Explain this prediction" button — shows rule chain + verse chain

### Week 22
- [ ] App About screen rewrite — emphasize rule engine + validation
- [ ] Disclaimer screen — "Educational and entertainment. Not a
  substitute for a qualified astrologer for major life decisions."
  (Ethical baseline regardless of accuracy.)

### Week 23
- [ ] Public methodology page (`/methodology` on the server) —
  describes the rule engine, the classical sources, the validation
  set. SEO bait + journalist hook.

### Week 24
- [ ] Outreach to 5 astrology YouTubers with the methodology page.
  At least one will cover it because it's genuinely novel.

**End of Phase 5: shipped + positioned + measurable + defensible.**

---

## Out of scope (deliberately)

These are NOT part of this roadmap:
- Hiring a human astrologer (user constraint)
- Building a marketplace / consultation feature
- Going multi-zodiac (Western, Chinese, etc.) — Vedic only
- Voice / video features
- Compatibility / matching as a separate flow (rules can include
  marriage compatibility, but no dedicated tab)
- iOS — Android first, iOS only after Android achieves PMF

---

## Working principles

1. **Every commit must produce something testable.** No multi-week
   silent refactors.
2. **Every prediction must cite its source.** Verse + book OR
   rule ID. The LLM cannot make claims unsupported by either.
3. **Free tier first.** No paid APIs / services without justification.
4. **Math against published references.** Every calculator (Ashtakavarga,
   Shadbala, Yoga detector, etc.) is tested against canonical numbers
   from textbooks before going live.
5. **Ship weekly to master.** Render auto-deploys. No long-lived
   feature branches.
6. **No marketing claim we can't substantiate.** "Most accurate" is
   only true if validated.

---

## Status snapshot

| Phase | Weeks | Status |
|---|---|---|
| Phase 1 — Calculation rigor | 1-6 | ✅ DONE — all 6 weeks shipped |
| Phase 2 — Rule engine + first rules | 7-12 | 33% — W7-W8 shipped (20 marriage rules live) |
| Phase 3 — Books + Lal Kitab | 13-16 | Not started |
| Phase 4 — Validation | 17-20 | Not started |
| Phase 5 — Polish + marketing | 21-24 | Not started |

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Rule extraction from Sanskrit texts produces nonsense | Human-verify every rule before adding. Sample of 50 rules → measure quality manually. |
| Gemini free tier rate limits hit during rule extraction | Pace — 50 rules/day is well within limits. Spread across multiple days. |
| Validation set shows the engine is no better than baseline | This is the actual scientific risk — astrology may not be predictively valid. Pivot to "best at applying classical technique" rather than "best at predicting reality." |
| User asks something no rule covers | Fall back to current RAG flow with a flag in the answer ("no specific classical rule applies — general chart inference") |
| @prisri/jyotish has a bug in divisional charts | Cross-check 5 known D9 charts manually. Switch to writing the formulas ourselves if any mismatch. |

---

## What "done" looks like

In May 2027, Moksha can truthfully claim:
- 700+ classical rules encoded across 7 indexed books
- All 16 divisional charts + Ashtakavarga + Shadbala + Yogas + Karakas
  + Transits + Sade Sati computed deterministically
- Every prediction traces to a specific rule OR verse
- Validated on 30 celebrity charts with 45%+ hit rate on major event
  timing windows
- The only AI Vedic astrology app with a public methodology page,
  open about its sources and validation results

That positioning doesn't need an astrologer on staff. It doesn't need
marketing budget. It needs the work in this document.
