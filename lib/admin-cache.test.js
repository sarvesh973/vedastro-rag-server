// Self-test for the admin dashboard read cache.
// Run: `node lib/admin-cache.test.js`
//
// This layer exists to keep the dashboard inside Firestore's free 50k
// reads/day, and its previous version failed at exactly that while looking
// correct. The behaviours that matter are therefore the awkward ones: that
// a cold process still gets a hit, that ?fresh=1 really bypasses both
// levels, that a too-large payload degrades instead of throwing, and that
// a Firestore outage reads as a miss rather than an error.

const { createAdminCache, docId, MAX_BYTES } = require('./admin-cache');

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
            async set(value) {
              stats.writes++;
              docs.set(key, value);
            },
          };
        },
      };
    },
  };
}

// ── doc id sanitising ──
// Cache keys carry colons; Firestore ids may not carry '/', and '.' / '..'
// and __x__ are reserved.
eq(docId('top-users:30:20'), 'top-users_30_20', 'colons fold to underscore');
eq(docId('a/b'), 'a_b', 'slash folds');
ok(docId('.') !== '.', 'bare dot is escaped');
ok(docId('..') !== '..', 'double dot is escaped');
ok(!/^__.*__$/.test(docId('__proto__')), 'reserved pattern is escaped');
ok(docId('').length > 0, 'empty key still yields a usable id');

(async () => {
  // ── L1 hit ──
  {
    const db = fakeDb();
    const c = createAdminCache({ getDb: () => db, ttlMs: 1000, logger: quiet });
    await c.set('overview', { total: 7 });
    const got = await c.get({}, 'overview');
    eq(got, { total: 7 }, 'L1 returns the stored value');
    eq(db.stats.reads, 0, 'an L1 hit costs zero Firestore reads');
  }

  // ── L2 survives a dead process ──
  // The whole reason this module exists: Render spins the instance down,
  // so the Map is empty on nearly every visit.
  {
    const db = fakeDb();
    const first = createAdminCache({ getDb: () => db, ttlMs: 1000, logger: quiet });
    await first.set('subs-raw', { rows: [{ uid: 'u1' }] });

    const reborn = createAdminCache({ getDb: () => db, ttlMs: 1000, logger: quiet });
    const got = await reborn.get({}, 'subs-raw');
    eq(got, { rows: [{ uid: 'u1' }] }, 'a fresh process still gets a hit');
    eq(db.stats.reads, 1, 'and it costs exactly ONE read, not a rescan');

    const again = await reborn.get({}, 'subs-raw');
    eq(again, { rows: [{ uid: 'u1' }] }, 'second call hits the warmed L1');
    eq(db.stats.reads, 1, 'warming L1 means no further reads');
  }

  // ── expiry, on both levels ──
  {
    const db = fakeDb();
    let t = 1_000_000;
    const c = createAdminCache({
      getDb: () => db, ttlMs: 1000, now: () => t, logger: quiet,
    });
    await c.set('k', { v: 1 });
    t += 1001;
    eq(await c.get({}, 'k'), null, 'an expired entry is a miss');
    // L2 held a value but it was too old — it must not be served.
    ok(db.docs.size === 1, 'the stale doc is still there, just not served');
  }

  // ── ?fresh=1 bypasses BOTH levels ──
  {
    const db = fakeDb();
    const c = createAdminCache({ getDb: () => db, ttlMs: 10_000, logger: quiet });
    await c.set('k', { v: 1 });
    eq(await c.get({ query: { fresh: '1' } }, 'k'), null, 'fresh=1 is a miss');
    eq(db.stats.reads, 0, 'and it does not even read L2');
    eq(await c.get({}, 'k'), { v: 1 }, 'a normal get still hits afterwards');
  }

  // ── oversized payloads degrade, never throw ──
  {
    const db = fakeDb();
    const c = createAdminCache({ getDb: () => db, ttlMs: 10_000, logger: quiet });
    const huge = { blob: 'x'.repeat(MAX_BYTES + 1) };
    const returned = await c.set('big', huge);
    eq(returned, huge, 'set still returns the value');
    eq(db.stats.writes, 0, 'oversized payload is not written to L2');
    eq(await c.get({}, 'big'), huge, 'but L1 still serves it this process');
  }

  // ── a broken Firestore is a miss, not a 500 ──
  {
    const exploding = {
      collection() {
        return { doc() { return {
          async get() { throw new Error('UNAVAILABLE'); },
          async set() { throw new Error('UNAVAILABLE'); },
        }; } };
      },
    };
    const c = createAdminCache({ getDb: () => exploding, ttlMs: 1000, logger: quiet });
    let threw = false;
    try {
      await c.set('k', { v: 1 });          // write fails internally
      const reborn = createAdminCache({ getDb: () => exploding, ttlMs: 1000, logger: quiet });
      eq(await reborn.get({}, 'k'), null, 'a failed L2 read is a miss');
    } catch (_) { threw = true; }
    ok(!threw, 'Firestore failures never surface to the caller');
  }

  // ── no Firestore configured at all ──
  {
    const c = createAdminCache({ getDb: () => null, ttlMs: 1000, logger: quiet });
    await c.set('k', { v: 2 });
    eq(await c.get({}, 'k'), { v: 2 }, 'works L1-only when there is no db');
  }

  // ── the lossless round trip ──
  // Timestamps are flattened to ISO strings by the callers precisely
  // because JSON cannot carry .toDate(). Confirm a realistic payload
  // survives byte-identically.
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
    eq(await reborn.get({}, 'subscriptions:2000'), payload,
      'nested rows, nulls and ISO dates all survive L2');
  }

  console.log(`\nadmin-cache: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
