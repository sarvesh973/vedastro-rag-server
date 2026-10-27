// Server-controlled policy for the launch promo banner.
//
// WHY THIS IS NOT IN THE APP. Every knob used to be a compile-time const
// in the Flutter client, which meant changing any of them required a
// build, a Play review, and then waiting for users to update. For a
// time-boxed festive campaign that carries a price claim in the artwork,
// three of those are unacceptable:
//
//   - no kill switch. If the banner starts costing reviews you cannot
//     stop it today, and users who do not update keep seeing it for
//     weeks.
//   - no end date. Diwali passes and the festive creative keeps showing
//     to everyone on the old build.
//   - the price claim cannot be corrected. The flag that says "₹99 is
//     live in Razorpay" has to move in lockstep with Razorpay itself,
//     and a client const never will be.
//
// Frequency bookkeeping deliberately stays on the device: slots used,
// dismissal counts and the pause are per-device, must work offline, and
// nobody needs to change them remotely. Policy here, bookkeeping there.
//
// The document lives at app_config/promo in Firestore so it can be
// edited from the Firebase console — or later from the admin dashboard —
// with no deploy and no restart.

/** Shipped if Firestore has no document, or cannot be read. */
const DEFAULTS = Object.freeze({
  // Off by default. A missing or unreadable config must never be the
  // reason a campaign starts.
  enabled: false,
  // The flag that must match Razorpay. Both creatives show ₹99 struck
  // through, so this being wrong is a false price claim, not a cosmetic
  // bug.
  pricingIntroLive: false,
  // ISO date. After this the promo stops by itself — the festive creative
  // does not need anyone to remember to turn it off.
  validUntil: null,
  maxDismissals: 4,
  pauseDays: 7,
  // Relative weights per creative id. Equal means a 50/50 split; setting
  // a losing variant to 0 retires it without a release.
  variantWeights: { a: 50, b: 50 },
});

function _int(value, fallback, { min, max }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * Validates and clamps a raw config document.
 *
 * Everything is bounded, because this document is hand-edited in a
 * console and a typo should degrade rather than escape. `maxDismissals:
 * 400` would make the pause unreachable; `pauseDays: 0` would make the
 * cap meaningless. A malformed value falls back to its default rather
 * than propagating to the client, where it would be baked into on-device
 * state that outlives the fix.
 */
function normalisePromoConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};

  let validUntil = null;
  if (typeof r.validUntil === 'string' && r.validUntil.trim()) {
    const d = new Date(r.validUntil);
    // An unparseable date must not read as "no expiry" — that is the
    // failure mode where a festive banner runs into December.
    validUntil = Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  const weights = {};
  const rawWeights =
    r.variantWeights && typeof r.variantWeights === 'object'
      ? r.variantWeights
      : DEFAULTS.variantWeights;
  for (const [id, w] of Object.entries(rawWeights)) {
    if (!/^[a-z0-9_-]{1,16}$/.test(id)) continue;
    weights[id] = _int(w, 0, { min: 0, max: 1000 });
  }
  // All-zero weights would leave the client unable to pick anything.
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const variantWeights =
    total > 0 ? weights : { ...DEFAULTS.variantWeights };

  return {
    enabled: r.enabled === true,
    pricingIntroLive: r.pricingIntroLive === true,
    validUntil,
    maxDismissals: _int(r.maxDismissals, DEFAULTS.maxDismissals, {
      min: 1,
      max: 20,
    }),
    pauseDays: _int(r.pauseDays, DEFAULTS.pauseDays, { min: 1, max: 60 }),
    variantWeights,
  };
}

/** True when [nowIso] is past the campaign's end date. */
function isExpired(config, nowIso) {
  if (!config || !config.validUntil) return false;
  return new Date(nowIso).getTime() > new Date(config.validUntil).getTime();
}

/**
 * The payload sent to the app. Expiry is resolved HERE rather than left
 * to the client, so a device with a wrong clock cannot extend a campaign
 * past its end date — and so turning one off takes effect everywhere at
 * once rather than per-device.
 */
function publicPromoConfig(raw, nowIso = new Date().toISOString()) {
  const config = normalisePromoConfig(raw);
  const expired = isExpired(config, nowIso);
  return {
    ...config,
    enabled: config.enabled && !expired,
    expired,
    serverTime: nowIso,
  };
}

module.exports = {
  DEFAULTS,
  normalisePromoConfig,
  isExpired,
  publicPromoConfig,
};
