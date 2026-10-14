// =========================================
// LAHIRI AYANAMSA CORRECTION
// =========================================
//
// @prisri/jyotish computes Lahiri from a J2000 anchor of 23°51'25.532".
// That anchor does not satisfy Lahiri's definition: Lahiri (Chitrapaksha)
// is fixed at 23°15'00" on JD 2435553.5 (21 March 1956, 0h), and the
// library's own polynomial, evaluated there, returns 23°14'43.889" —
// 16.111 arcsec low. Every sidereal longitude it produces carries that.
//
// WHY IT MATTERS HERE, AND IT IS NOT SUBTLE
//
// 16 arcsec never moves a planet across a house. But Vimshottari dasha
// balance is the fraction of the Moon's nakshatra remaining at birth,
// multiplied by a dasha length of up to 20 years — so a few arcsec of
// Moon longitude becomes DAYS of dasha boundary. Measured against a real
// chart, every mahadasha, antardasha and pratyantar boundary sat about
// two days off. Those dates are the most checkable thing we print.
//
// UPSTREAM
//
// Fixed properly in prisriorg/jyotish#1, which moves the anchor to
// 23°51'41.643" so the series reproduces the definition. This module is
// the interim: it applies the identical constant offset at runtime so
// production is correct before that lands.
//
// SELF-DISABLING
//
// apply() measures the library at the defining epoch and only patches if
// it is actually wrong. When the upstream fix ships and the dependency is
// bumped, this becomes a no-op automatically rather than double-applying
// the correction — the failure mode that would otherwise be invisible.
// Delete the module and its call in index.js at that point.

const JD_UNIX_EPOCH = 2440587.5;
const LAHIRI_EPOCH_JD = 2435553.5;        // 21 March 1956, 0h
const LAHIRI_EPOCH_DEG = 23 + 15 / 60;    // 23°15'00" exactly
// Comfortably tighter than the 16" error, comfortably looser than any
// floating-point noise, so the decision is never marginal.
const TOLERANCE_ARCSEC = 1.0;

function jdToDate(jd) {
  return new Date((jd - JD_UNIX_EPOCH) * 86400000);
}

/**
 * Patch @prisri/jyotish's Lahiri ayanamsa in place.
 *
 * Safe to call once at startup, before any chart is computed.
 * calculations.js holds the module object and reads `.getAyanamsa` at
 * call time, so replacing the export takes effect for every later call.
 *
 * @returns {{applied: boolean, reason: string, errorArcsec: number|null}}
 */
function applyAyanamsaCorrection() {
  let mod;
  try {
    mod = require('@prisri/jyotish/dist/core/ayanamsa');
  } catch (e) {
    return { applied: false, reason: `module not found: ${e.message}`, errorArcsec: null };
  }

  const original = mod.getAyanamsa;
  if (typeof original !== 'function') {
    return { applied: false, reason: 'getAyanamsa export missing', errorArcsec: null };
  }

  let atEpoch;
  try {
    atEpoch = original(jdToDate(LAHIRI_EPOCH_JD), 'lahiri');
  } catch (e) {
    return { applied: false, reason: `probe threw: ${e.message}`, errorArcsec: null };
  }
  if (typeof atEpoch !== 'number' || !isFinite(atEpoch)) {
    return { applied: false, reason: 'probe returned non-finite', errorArcsec: null };
  }

  const errorDeg = atEpoch - LAHIRI_EPOCH_DEG;
  const errorArcsec = errorDeg * 3600;

  if (Math.abs(errorArcsec) <= TOLERANCE_ARCSEC) {
    return { applied: false, reason: 'library already matches the definition', errorArcsec };
  }

  // Shifting the J2000 anchor by a constant shifts the whole series by
  // that constant, so correcting the epoch error is exactly a constant
  // subtraction — identical in effect to the upstream PR. KP and Raman
  // are derived from the same lahiriSeconds inside the original function,
  // so they are corrected consistently and need no separate handling.
  mod.getAyanamsa = function correctedGetAyanamsa(date, type) {
    return original(date, type) - errorDeg;
  };

  return { applied: true, reason: 'corrected to the defining epoch', errorArcsec };
}

module.exports = {
  applyAyanamsaCorrection,
  LAHIRI_EPOCH_JD,
  LAHIRI_EPOCH_DEG,
};
