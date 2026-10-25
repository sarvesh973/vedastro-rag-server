// Two-level read cache for the admin dashboard.
//
//   L1 = an in-process Map        — free, but dies with the process
//   L2 = Firestore admin_cache/*  — ONE document read serves a whole panel
//
// WHY L2 EXISTS. An L1-only version of this cache was added to fix the
// dashboard exhausting Firestore's free 50k reads/day, and it did almost
// nothing, because Render's free tier spins the instance down after ~15
// minutes of inactivity. Nearly every dashboard visit therefore began on a
// cold process with an empty Map and paid the full scan cost — a single
// tour of the dashboard runs several collection scans and costs thousands
// of document reads, so the quota only covered two or three tours a day.
//
// One read to serve a cached panel is the entire point: three orders of
// magnitude cheaper than recomputing, and it survives a cold start, a
// deploy, and a second admin opening the dashboard on another device.
//
// Lives in lib/ rather than index.js so it can be tested. index.js is a
// single 250KB module with an unconditional app.listen(), so nothing in it
// can be required from a test.

/** Firestore caps a document at 1MiB; stay well clear of the edge. */
const MAX_BYTES = 900 * 1024;

const COLLECTION = 'admin_cache';

/**
 * Cache keys look like `top-users:30:20`. Firestore document IDs may not
 * contain '/', may not be '.' or '..', and may not match __.*__, so fold
 * anything outside a safe charset down to '_'.
 */
function docId(key) {
  const safe = String(key).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 1400);
  // '.' and '..' are reserved, and a leading/trailing double underscore
  // collides with Firestore's reserved pattern.
  if (safe === '.' || safe === '..' || /^__.*__$/.test(safe)) return `k_${safe}`;
  return safe || 'k_empty';
}

/**
 * @param {object} opts
 * @param {() => object|null} opts.getDb  Thunk, because index.js assigns
 *   firestoreDb during startup — capturing the value here would pin null.
 * @param {number} opts.ttlMs
 * @param {() => number} [opts.now]       Injectable clock, for tests.
 * @param {object} [opts.logger]
 */
function createAdminCache({ getDb, ttlMs, now = Date.now, logger = console }) {
  const l1 = new Map();

  async function get(req, key) {
    // ?fresh=1 forces a recompute. Checked before L1 so the bypass is
    // total — a stale L1 entry must not satisfy an explicit refresh.
    if (req && req.query && req.query.fresh) return null;

    const hit = l1.get(key);
    if (hit && now() - hit.at <= ttlMs) return hit.value;
    if (hit) l1.delete(key);

    const db = getDb();
    if (!db) return null;
    try {
      const doc = await db.collection(COLLECTION).doc(docId(key)).get();
      if (!doc.exists) return null;
      const d = doc.data() || {};
      const at = typeof d.at === 'number' ? d.at : 0;
      if (!d.json || now() - at > ttlMs) return null;
      const value = JSON.parse(d.json);
      l1.set(key, { at, value }); // warm L1 for the rest of this process
      return value;
    } catch (e) {
      // A cache miss must never become an error the dashboard renders.
      logger.warn('[admin/cache] L2 read failed for', key, e && e.message);
      return null;
    }
  }

  /**
   * Writes both levels and returns `value`, so call sites stay one-liners.
   *
   * The payload is stored as a JSON STRING, not a nested object. Firestore
   * rejects nested arrays outright and caps a document at 20k fields, and
   * these payloads are arrays of row objects. More importantly, it makes
   * the round trip lossless: a Firestore Timestamp written as an object
   * comes back without .toDate(), which the dashboard's date helpers test
   * for, so dates would silently become null on a cache HIT and only on a
   * hit — a bug that reads as bad data rather than bad caching.
   */
  async function set(key, value) {
    const at = now();
    l1.set(key, { at, value });

    const db = getDb();
    if (db) {
      try {
        const json = JSON.stringify(value);
        if (Buffer.byteLength(json, 'utf8') <= MAX_BYTES) {
          await db.collection(COLLECTION).doc(docId(key)).set({ at, json });
        } else {
          // Too large to persist. L1 still holds it, so this one key
          // degrades to the old in-process behaviour instead of failing.
          logger.warn('[admin/cache] skipping L2 write, payload too large:', key);
        }
      } catch (e) {
        logger.warn('[admin/cache] L2 write failed for', key, e && e.message);
      }
    }
    return value;
  }

  return { get, set, docId, _l1: l1 };
}

module.exports = { createAdminCache, docId, MAX_BYTES, COLLECTION };
