// Self-test for the admin dashboard read cache and recompute budget.
// Run: `node lib/admin-cache.test.js`
//
// This layer exists so the dashboard can be refreshed without limit while
// staying inside Firestore's free 50k reads/day, and its first version
// failed at that while looking correct. The behaviours worth testing are
// therefore the awkward ones: a cold process still getting a hit, the
// budget surviving a spin-down, stale data being served in preference to
// becoming unavailable, and failures reading as misses rather than 500s.

const {
  createAdminCache, docId, pacificDay, MAX_BYTES,
} = require('./admin-cache');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`✗ ${label}\n    expected ${e}\n    got      ${a}`); }
}
function ok(cond, label) {
  if (cond) pass++; else { fail++; console.error(`✗ ${label}`); }
}

const quiet = { warn() {}, error() {}, log() {} };

/** Minimal Firestore stand-in that counts reads and writes. */
function fakeDb() {
  const docs = new Map();
  const stats = { reads: 0, writes: 0 };
  return {
    stats,
    docs,
    collection(name) {
      return {
        doc(id) {
          const key = `${name}/${id}`;
          return {
            async get() {
              stats.reads++;
              const d = docs.get(key);
              return { exists: d !== undefined, data: () => d };
            },
            async set(value) { stats.writes++; docs.set(key, value); },
          };
        },
      };
    },
  };
}

// ── doc id sanitising ──
eq(docId('top-users:30:20'), 'top-users_30_20', 'colons fold to underscore');
eq(docId('a/b'), 'a_b', 'slash folds');
ok(docId('.') !== '.', 'bare dot is escaped');
ok(docId('..') !== '..', 'double dot is escaped');
ok(!/^__.*__$/.test(docId('__proto__')), 'reserved pattern is escaped');
ok(docId('').length > 0, 'empty key still yields a usable id');

// ── the budget day follows Firestore's quota reset, not local midnight ──
// 2026-03-02T01:00Z is still 2026-03-01 in US/Pacific.
eq(pacificDay(Date.parse('2026-03-02T01:00:00Z')), '2026-03-01',
  'budget day is US/Pacific, where the Firestore quota resets');
eq(pacificDay(Date.parse('2026-03-02T09:00:00Z')), '2026-03-02',
  'and rolls over at Pacific midnight');

(async () => {
  // ── L1 hit ──
  {
    const db = fakeDb();
    const c = createAdminCache({ getDb: () => db, ttlMs: 1000, logger: quiet });
    await c.set('overview', { total: 7 });
    // set() reads the doc once to recover the day's recompute count, so
    // measure the GET in isolation — that is the path the dashboard takes.
    db.stats.reads = 0;
    const got = await c.get({}, 'overview');
    eq(got && got.value, { total: 7 }, 'L1 returns the stored value');
    eq(got && got.stale, false, 'and it is not stale');
    eq(db.stats.reads, 0, 'an L1 hit costs zero Firestore reads');
  }

  // ── L2 survives a dead process ──
  {
    const db = fakeDb();
    const first = createAdminCache({ getDb: () => db, ttlMs: 1000, logger: quiet });
    await first.set('subs-raw', { rows: [{ uid: 'u1' }] });
    db.stats.reads = 0;

    const reborn = createAdminCache({ getDb: () => db, ttlMs: 1000, logger: quiet });
    const got = await reborn.get({}, 'subs-raw');
    eq(got && got.value, { rows: [{ uid: 'u1' }] }, 'a fresh process still gets a hit');
    eq(db.stats.reads, 1, 'and it costs exactly ONE read, not a rescan');

    await reborn.get({}, 'subs-raw');
    eq(db.stats.reads, 1, 'warming L1 means no further reads');
  }

  // ── THE POINT: past the TTL with no budget, serve stale, never fail ──
  {
    const db = fakeDb();
    let t = Date.parse('2026-03-02T20:00:00Z');
    const c = createAdminCache({
      getDb: () => db, ttlMs: 1000, maxRecomputesPerDay: 2,
      now: () => t, logger: quiet,
    });

    await c.set('k', { v: 1 });                    // recomputes = 1
    t += 5000;
    eq(await c.get({}, 'k'), null, 'stale + budget left -> recompute');
    await c.set('k', { v: 2 });                    // recomputes = 2
    t += 5000;

    const got = await c.get({}, 'k');
    ok(got !== null, 'stale + budget SPENT -> still answers');
    eq(got && got.value, { v: 2 }, 'serves the last good value');
    eq(got && got.stale, true, 'and marks it stale so the UI can say so');

    // Unlimited viewing: hammer it and it keeps answering, never recomputes.
    for (let i = 0; i < 50; i++) {
      const r = await c.get({}, 'k');
      if (!r || r.stale !== true) { fail++; console.error('✗ view ' + i + ' did not serve stale'); break; }
    }
    pass++;
  }

  // ── the budget resets the next Pacific day ──
  {
    const db = fakeDb();
    let t = Date.parse('2026-03-02T20:00:00Z');
    const c = createAdminCache({
      getDb: () => db, ttlMs: 1, maxRecomputesPerDay: 1, now: () => t, logger: quiet,
    });
    await c.set('k', { v: 1 });
    t += 10_000;
    ok((await c.get({}, 'k')).stale === true, 'budget spent same day');
    t = Date.parse('2026-03-03T20:00:00Z');
    eq(await c.get({}, 'k'), null, 'next Pacific day the budget is back');
  }

  // ── a spin-down must not hand out a fresh budget ──
  // The count lives in the same document as the payload, so a new process
  // reads it back rather than starting from zero.
  {
    const db = fakeDb();
    const t = Date.parse('2026-03-02T20:00:00Z');
    let clock = t;
    const opts = {
      getDb: () => db, ttlMs: 1000, maxRecomputesPerDay: 1,
      now: () => clock, logger: quiet,
    };
    await createAdminCache(opts).set('k', { v: 1 });   // recomputes = 1
    clock += 5000;                                     // past the TTL
    const reborn = createAdminCache(opts);             // cold process
    const got = await reborn.get({}, 'k');
    ok(got !== null && got.stale === true,
      'a cold process still sees the budget as spent');
  }

  // ── ?fresh=1 outranks the TTL, but not the budget ──
  {
    const db = fakeDb();
    const t = Date.parse('2026-03-02T20:00:00Z');
    const c = createAdminCache({
      getDb: () => db, ttlMs: 10_000, maxRecomputesPerDay: 2,
      now: () => t, logger: quiet,
    });
    await c.set('k', { v: 1 });                       // recomputes = 1
    eq(await c.get({ query: { fresh: '1' } }, 'k'), null,
      'fresh=1 forces a recompute even inside the TTL');
    await c.set('k', { v: 2 });                       // recomputes = 2
    const denied = await c.get({ query: { fresh: '1' } }, 'k');
    ok(denied !== null, 'once the budget is spent fresh=1 is denied, not fatal');
    eq(denied && denied.value, { v: 2 }, 'and the last good value is served');
  }

  // ── oversized payloads degrade, never throw ──
  {
    const db = fakeDb();
    const c = createAdminCache({ getDb: () => db, ttlMs: 10_000, logger: quiet });
    const huge = { blob: 'x'.repeat(MAX_BYTES + 1) };
    eq(await c.set('big', huge), huge, 'set still returns the value');
    eq(db.stats.writes, 0, 'oversized payload is not written to L2');
    eq((await c.get({}, 'big')).value, huge, 'but L1 still serves it');
  }

  // ── a broken Firestore is a miss, not a 500 ──
  {
    const exploding = {
      collection() { return { doc() { return {
        async get() { throw new Error('UNAVAILABLE'); },
        async set() { throw new Error('UNAVAILABLE'); },
      }; } }; },
    };
    let threw = false;
    try {
      const c = createAdminCache({ getDb: () => exploding, ttlMs: 1000, logger: quiet });
      await c.set('k', { v: 1 });
      const reborn = createAdminCache({ getDb: () => exploding, ttlMs: 1000, logger: quiet });
      eq(await reborn.get({}, 'k'), null, 'a failed L2 read is a miss');
    } catch (_) { threw = true; }
    ok(!threw, 'Firestore failures never surface to the caller');
  }

  // ── no Firestore configured at all ──
  {
    const c = createAdminCache({ getDb: () => null, ttlMs: 1000, logger: quiet });
    await c.set('k', { v: 2 });
    eq((await c.get({}, 'k')).value, { v: 2 }, 'works L1-only with no db');
  }

  // ── the lossless round trip ──
  {
    const db = fakeDb();
    const c = createAdminCache({ getDb: () => db, ttlMs: 10_000, logger: quiet });
    const payload = {
      summary: { total: 2, active: 1 },
      items: [
        { uid: 'u1', plan: 'standard', subscribedAt: '2026-10-01T05:30:00.000Z' },
        { uid: 'u2', plan: null, subscribedAt: null, isOneTime: false },
      ],
      bySource: { instagram: { signups: 10, subscribers: 2, conversionPct: 20 } },
    };
    await c.set('subscriptions:2000', payload);
    const reborn = createAdminCache({ getDb: () => db, ttlMs: 10_000, logger: quiet });
    eq((await reborn.get({}, 'subscriptions:2000')).value, payload,
      'nested rows, nulls and ISO dates all survive L2');
  }

  console.log(`\nadmin-cache: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
