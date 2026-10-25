// Read cache + recompute policy for the admin dashboard.
//
//   L1 = an in-process Map        — free, but dies with the process
//   L2 = Firestore admin_cache/*  — ONE document read serves a whole panel
//
// WHY L2 EXISTS. An L1-only version was added to stop the dashboard
// exhausting Firestore's free 50k reads/day, and it did almost nothing,
// because Render's free tier spins the instance down after ~15 minutes of
// inactivity. Nearly every visit therefore began on a cold process with an
// empty Map and paid the full scan cost.
//
// WHY THE BUDGET EXISTS. Caching alone still cannot give unlimited
// refreshes, because a cache MISS recomputes, and a recompute costs
// thousands of document reads (one panel scans up to 5,000 chat docs). As
// long as viewing the dashboard can trigger a recompute, enough viewing
// will exhaust the quota. The fix is to stop conflating the two actions:
//
//   viewing the dashboard  -> always served from cache, ANY age, ~1 read
//   recomputing the numbers -> capped per key per day
//
// So a stale answer is served in preference to a fresh one once the day's
// budget is spent. That is the whole trick: the dashboard can no longer
// make itself unavailable, it can only go out of date, and it says so.
// `?fresh=1` still forces a recompute while budget remains.
//
// The budget day is aligned to US/Pacific because that is when Firestore's
// own daily free quota resets — a budget on any other day boundary would
// drift against the limit it exists to respect.
//
// Lives in lib/ rather than index.js so it can be tested: index.js is a
// single 250KB module with an unconditional app.listen(), so nothing in it
// is reachable from a test.

/** Firestore caps a document at 1MiB; stay well clear of the edge. */
const MAX_BYTES = 900 * 1024;

const COLLECTION = 'admin_cache';

/** Per key, per day. 5 x ~8k reads leaves headroom under the 50k cap. */
const DEFAULT_MAX_RECOMPUTES = 5;

/**
 * Cache keys look like `top-users:30:20`. Firestore document IDs may not
 * contain '/', may not be '.' or '..', and may not match __.*__.
 */
function docId(key) {
  const safe = String(key).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 1400);
  if (safe === '.' || safe === '..' || /^__.*__$/.test(safe)) return `k_${safe}`;
  return safe || 'k_empty';
}

/** yyyy-mm-dd in US/Pacific — the boundary Firestore's quota resets on. */
function pacificDay(ms) {
  return new Date(ms).toLocaleDateString('en-CA', {
    timeZone: 'America/Los_Angeles',
  });
}

/**
 * @param {object} opts
 * @param {() => object|null} opts.getDb  Thunk: index.js assigns firestoreDb
 *   during startup, so capturing the value here would pin null forever.
 * @param {number} opts.ttlMs             Below this age, serve without
 *   considering a recompute at all.
 * @param {number} [opts.maxRecomputesPerDay]
 * @param {() => number} [opts.now]       Injectable clock, for tests.
 * @param {object} [opts.logger]
 */
function createAdminCache({
  getDb,
  ttlMs,
  maxRecomputesPerDay = DEFAULT_MAX_RECOMPUTES,
  now = Date.now,
  logger = console,
}) {
  const l1 = new Map(); // key -> { at, value, day, recomputes }

  async function readEntry(key) {
    const hit = l1.get(key);
    if (hit) return hit;

    const db = getDb();
    if (!db) return null;
    try {
      const doc = await db.collection(COLLECTION).doc(docId(key)).get();
      if (!doc.exists) return null;
      const d = doc.data() || {};
      if (!d.json || typeof d.at !== 'number') return null;
      const entry = {
        at: d.at,
        value: JSON.parse(d.json),
        day: d.day || null,
        recomputes: typeof d.recomputes === 'number' ? d.recomputes : 0,
      };
      l1.set(key, entry); // warm L1 for the rest of this process
      return entry;
    } catch (e) {
      // A cache miss must never become an error the dashboard renders.
      logger.warn('[admin/cache] L2 read failed for', key, e && e.message);
      return null;
    }
  }

  function budgetLeft(entry, nowMs) {
    if (!entry) return true;                       // nothing cached yet
    if (entry.day !== pacificDay(nowMs)) return true; // new day, reset
    return entry.recomputes < maxRecomputesPerDay;
  }

  /**
   * Returns `{ value, at, stale }`, or null when the caller should
   * recompute and then call set().
   *
   * Null means "recompute": either the entry is missing, or it is past the
   * TTL and the day's budget allows one. Anything else is served, and
   * `stale` says whether it is past the TTL — which the dashboard surfaces
   * as "Updated Xh ago" rather than pretending it is current.
   */
  async function get(req, key) {
    const nowMs = now();
    const entry = await readEntry(key);
    const forced = !!(req && req.query && req.query.fresh);

    if (forced) {
      // An explicit refresh outranks the TTL but not the budget — otherwise
      // holding down the button is still a way to exhaust the quota.
      if (budgetLeft(entry, nowMs)) return null;
      logger.warn('[admin/cache] forced refresh denied, budget spent:', key);
      return entry ? { value: entry.value, at: entry.at, stale: true } : null;
    }

    if (!entry) return null;
    if (nowMs - entry.at <= ttlMs) {
      return { value: entry.value, at: entry.at, stale: false };
    }
    if (budgetLeft(entry, nowMs)) return null;

    // Past the TTL with no budget left: serve what we have. This is the
    // branch that makes viewing the dashboard unlimited.
    return { value: entry.value, at: entry.at, stale: true };
  }

  /**
   * Stores the recomputed payload and charges one unit of the day's budget.
   *
   * The payload is stored as a JSON STRING, not a nested object. Firestore
   * rejects nested arrays and caps a document at 20k fields, but the real
   * reason is losslessness: a Firestore Timestamp written as an object
   * comes back without .toDate(), which the dashboard's date helpers test
   * for, so dates would silently become null on a cache HIT and only on a
   * hit — a bug that reads as bad data rather than bad caching.
   */
  async function set(key, value) {
    const at = now();
    const day = pacificDay(at);

    // Previous count, so a cold process does not reset the day's budget to
    // zero and hand out unlimited recomputes after every spin-down.
    const prev = await readEntry(key);
    const recomputes = (prev && prev.day === day ? prev.recomputes : 0) + 1;

    const entry = { at, value, day, recomputes };
    l1.set(key, entry);

    const db = getDb();
    if (db) {
      try {
        const json = JSON.stringify(value);
        if (Buffer.byteLength(json, 'utf8') <= MAX_BYTES) {
          await db.collection(COLLECTION).doc(docId(key))
            .set({ at, json, day, recomputes });
        } else {
          // Too large to persist. L1 still holds it, so this one key
          // degrades to in-process-only instead of failing the request.
          logger.warn('[admin/cache] skipping L2 write, payload too large:', key);
        }
      } catch (e) {
        logger.warn('[admin/cache] L2 write failed for', key, e && e.message);
      }
    }
    return value;
  }

  return { get, set, docId, pacificDay, _l1: l1 };
}

module.exports = {
  createAdminCache,
  docId,
  pacificDay,
  MAX_BYTES,
  COLLECTION,
  DEFAULT_MAX_RECOMPUTES,
};
