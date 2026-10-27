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
  // The creatives themselves, so adding, changing or retiring one is a
  // Firestore edit rather than a Play release.
  //
  // imageUrl is optional: omitted, the app falls back to the creative
  // bundled under that id. That fallback is not a nicety — a first
  // launch, an offline launch or a 404 must still produce a usable
  // banner or none at all, never a broken one.
  //
  // dismissTop is per-creative because it depends on the ARTWORK: it is
  // the fraction below which taps dismiss rather than open the paywall,
  // and it has to sit under whatever "Not now" the image draws. Ship a
  // creative with its button somewhere else and this moves with it.
  variants: [
    { id: 'a', weight: 50, imageUrl: null, dismissTop: 0.93, closeOnLeft: true },
    { id: 'b', weight: 50, imageUrl: null, dismissTop: 0.93, closeOnLeft: false },
  ],
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

  const variants = _variants(r.variants);

  return {
    enabled: r.enabled === true,
    pricingIntroLive: r.pricingIntroLive === true,
    validUntil,
    maxDismissals: _int(r.maxDismissals, DEFAULTS.maxDismissals, {
      min: 1,
      max: 20,
    }),
    pauseDays: _int(r.pauseDays, DEFAULTS.pauseDays, { min: 1, max: 60 }),
    variants,
  };
}

/** https only, bounded length. Anything else becomes null — no image. */
function _imageUrl(value) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (!url || url.length > 500) return null;
  // http:// would be blocked by the app's network security config anyway,
  // and a non-https creative URL on a billing screen is not acceptable
  // regardless.
  if (!/^https:\/\/[^\s]+$/i.test(url)) return null;
  return url;
}

/**
 * Validates the creative list.
 *
 * Every field is bounded because this is hand-edited in a console and now
 * carries a URL the app will fetch and render full-screen. A malformed
 * entry is DROPPED rather than repaired: a creative whose dismissTop is
 * wrong would put the dismiss strip over its own call to action, which is
 * worse than that variant simply not running.
 */
function _variants(raw) {
  if (!Array.isArray(raw)) return DEFAULTS.variants.map((v) => ({ ...v }));

  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    // Ids become analytics trigger suffixes and local storage keys, so
    // they have to be safe and stable.
    if (!/^[a-z0-9_-]{1,16}$/.test(id) || seen.has(id)) continue;
    seen.add(id);

    const dismissTop = Number(entry.dismissTop);
    out.push({
      id,
      weight: _int(entry.weight, 0, { min: 0, max: 1000 }),
      imageUrl: _imageUrl(entry.imageUrl),
      // 0.5 floor: a dismiss strip covering more than half the creative
      // would mean most taps close it, which is not a promo. 0.99 ceiling
      // leaves room for the strip to be reachable at all.
      dismissTop:
        Number.isFinite(dismissTop) && dismissTop >= 0.5 && dismissTop <= 0.99
          ? Math.round(dismissTop * 1000) / 1000
          : 0.93,
      closeOnLeft: entry.closeOnLeft === true,
    });
  }

  // Nothing usable, or every weight zero, means the client has nothing to
  // pick — fall back rather than ship an empty campaign that silently
  // never shows.
  const total = out.reduce((a, v) => a + v.weight, 0);
  if (out.length === 0 || total === 0) {
    return DEFAULTS.variants.map((v) => ({ ...v }));
  }
  return out;
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
