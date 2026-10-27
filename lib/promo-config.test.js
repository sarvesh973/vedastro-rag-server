// Self-test for the server-controlled promo policy.
// Run: `node lib/promo-config.test.js`
//
// This document is hand-edited in a Firebase console, so every failure
// mode here starts as a typo and ends as something users see. The two
// that matter most:
//
//   - an unparseable validUntil must NOT read as "no expiry", or a
//     festive banner runs into December
//   - a missing or unreadable document must NOT start a campaign
//
// Both are asserted below, along with clamping, because a stray zero in
// maxDismissals would make the dismissal cap unreachable and a stray
// zero in every variant weight would leave the client unable to pick a
// creative at all.

const {
  DEFAULTS, normalisePromoConfig, isExpired, publicPromoConfig,
} = require('./promo-config');

let pass = 0, fail = 0;
function eq(actual, expected, label) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; }
  else { fail++; console.error(`✗ ${label}\n    expected ${e}\n    got      ${a}`); }
}
function ok(cond, label) {
  if (cond) pass++; else { fail++; console.error(`✗ ${label}`); }
}

// ── nothing starts a campaign by accident ──
eq(DEFAULTS.enabled, false, 'defaults are OFF');
eq(DEFAULTS.pricingIntroLive, false, 'pricing flag defaults OFF');
eq(normalisePromoConfig(null).enabled, false, 'null config is off');
eq(normalisePromoConfig(undefined).enabled, false, 'undefined config is off');
eq(normalisePromoConfig({}).enabled, false, 'empty config is off');
eq(normalisePromoConfig('nonsense').enabled, false, 'garbage config is off');
eq(normalisePromoConfig({ enabled: 'true' }).enabled, false,
  'a STRING "true" does not enable — only a real boolean');
eq(normalisePromoConfig({ enabled: 1 }).enabled, false,
  'a truthy number does not enable either');
eq(normalisePromoConfig({ enabled: true }).enabled, true, 'explicit true works');

// ── validUntil ──
{
  const c = normalisePromoConfig({ validUntil: '2026-11-15T00:00:00Z' });
  ok(c.validUntil.startsWith('2026-11-15'), 'a valid date survives');
}
eq(normalisePromoConfig({ validUntil: 'next tuesday' }).validUntil, null,
  'an unparseable date becomes null, not a silent "never expires"');
eq(normalisePromoConfig({ validUntil: '' }).validUntil, null, 'empty string');
eq(normalisePromoConfig({ validUntil: 12345 }).validUntil, null, 'wrong type');

// ── clamping ──
eq(normalisePromoConfig({ maxDismissals: 0 }).maxDismissals, 1,
  'zero dismissals clamps to 1 — zero would make the cap unreachable');
eq(normalisePromoConfig({ maxDismissals: 9999 }).maxDismissals, 20, 'upper clamp');
eq(normalisePromoConfig({ maxDismissals: 'four' }).maxDismissals,
  DEFAULTS.maxDismissals, 'non-numeric falls back');
eq(normalisePromoConfig({ pauseDays: 0 }).pauseDays, 1, 'pause lower clamp');
eq(normalisePromoConfig({ pauseDays: 500 }).pauseDays, 60, 'pause upper clamp');
eq(normalisePromoConfig({ maxDismissals: 4.7 }).maxDismissals, 5, 'rounds');

// ── variants ──
{
  const v = (raw) => normalisePromoConfig({ variants: raw }).variants;

  eq(v('nope'), DEFAULTS.variants, 'wrong type falls back');
  eq(v([]), DEFAULTS.variants, 'empty list falls back');
  eq(v([{ id: 'a', weight: 0 }, { id: 'b', weight: 0 }]), DEFAULTS.variants,
    'ALL-zero weights fall back — the client must have something to pick');

  // A weight of 0 on ONE variant is how a losing creative is retired.
  ok(v([{ id: 'a', weight: 100 }, { id: 'b', weight: 0 }])
      .find((x) => x.id === 'b').weight === 0,
    'a single variant can be retired with a zero weight');

  eq(v([{ id: 'BAD ID', weight: 10 }, { id: 'c', weight: 5 }])
      .map((x) => x.id),
    ['c'], 'unsafe ids are dropped — they become analytics keys');
  eq(v([{ id: 'a', weight: 5 }, { id: 'a', weight: 9 }]).length, 1,
    'duplicate ids are dropped');

  // imageUrl: https only. A non-https creative URL on a billing screen
  // is not acceptable, and http would be blocked by the app's network
  // config anyway — so it degrades to the bundled asset.
  eq(v([{ id: 'a', weight: 1, imageUrl: 'https://cdn.example/a.webp' }])[0]
      .imageUrl, 'https://cdn.example/a.webp', 'https url survives');
  eq(v([{ id: 'a', weight: 1, imageUrl: 'http://cdn.example/a.webp' }])[0]
      .imageUrl, null, 'http becomes null -> bundled fallback');
  eq(v([{ id: 'a', weight: 1, imageUrl: 'javascript:alert(1)' }])[0]
      .imageUrl, null, 'a non-url scheme is rejected');
  eq(v([{ id: 'a', weight: 1, imageUrl: 42 }])[0].imageUrl, null,
    'wrong type becomes null');
  eq(v([{ id: 'a', weight: 1, imageUrl: 'https://' + 'x'.repeat(600) }])[0]
      .imageUrl, null, 'absurdly long url is rejected');

  // dismissTop depends on the ARTWORK — it must sit below whatever
  // "Not now" the image draws. A wrong value would put the dismiss strip
  // over the creative's own call to action.
  eq(v([{ id: 'a', weight: 1, dismissTop: 0.88 }])[0].dismissTop, 0.88,
    'a valid dismissTop survives');
  eq(v([{ id: 'a', weight: 1, dismissTop: 0.2 }])[0].dismissTop, 0.93,
    'below 0.5 falls back — most taps would dismiss, which is not a promo');
  eq(v([{ id: 'a', weight: 1, dismissTop: 1.4 }])[0].dismissTop, 0.93,
    'above 0.99 falls back — the strip would be unreachable');
  eq(v([{ id: 'a', weight: 1, dismissTop: 'low' }])[0].dismissTop, 0.93,
    'non-numeric falls back');

  eq(v([{ id: 'a', weight: 1, closeOnLeft: true }])[0].closeOnLeft, true,
    'closeOnLeft passes through');
  eq(v([{ id: 'a', weight: 1, closeOnLeft: 'yes' }])[0].closeOnLeft, false,
    'a string does not set closeOnLeft');
}

// ── expiry ──
{
  const c = normalisePromoConfig({
    enabled: true, validUntil: '2026-11-15T00:00:00Z',
  });
  ok(!isExpired(c, '2026-11-14T23:00:00Z'), 'not expired an hour before');
  ok(isExpired(c, '2026-11-15T01:00:00Z'), 'expired an hour after');
  ok(!isExpired(normalisePromoConfig({ enabled: true }), '2030-01-01T00:00:00Z'),
    'no validUntil means no expiry');
}

// ── the public payload ──
{
  const live = publicPromoConfig(
    { enabled: true, validUntil: '2026-11-15T00:00:00Z' },
    '2026-11-10T00:00:00Z',
  );
  eq(live.enabled, true, 'inside the window it is enabled');
  eq(live.expired, false, 'and not expired');

  const done = publicPromoConfig(
    { enabled: true, validUntil: '2026-11-15T00:00:00Z' },
    '2026-11-20T00:00:00Z',
  );
  eq(done.enabled, false,
    'past the end date enabled is forced FALSE server-side');
  eq(done.expired, true, 'and the client is told why');
  ok(typeof done.serverTime === 'string',
    'server time is included so a wrong device clock cannot extend a campaign');
}

console.log(`\npromo-config: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
