/**
 * CarryBee Auto-Flow — Shared Utilities
 *
 * Plain globals (not a module). Loaded by:
 *   1. Content script — manifest content_scripts.js order: ["shared.js", "content.js"]
 *   2. Background SW   — importScripts('shared.js')
 *
 * Single source of truth for daily-reset math (BDT = UTC+6).
 */

/** Default daily reset: 7:00 PM BDT (minutes since midnight). */
const CB_DEFAULT_RESET_MINUTES = 19 * 60;

/**
 * Resolve configured reset time → minutes since midnight (0–1439).
 * Reads resetAtMinutes; falls back to legacy resetHour (0–23) if present.
 *
 * @param {object} [settings] - Stored cbSettings object
 * @returns {number} Normalized minutes 0–1439
 */
function cbResolveResetMinutes(settings) {
  let m = typeof settings?.resetAtMinutes === 'number'
    ? settings.resetAtMinutes
    : (typeof settings?.resetHour === 'number' ? settings.resetHour * 60 : CB_DEFAULT_RESET_MINUTES);
  return ((m % 1440) + 1440) % 1440;
}

/**
 * Today's reset instant as epoch-ms (BDT / UTC+6).
 * Pure UTC math — independent of the machine's timezone.
 *
 * @param {number} minutes - Minutes since midnight BDT (0–1439)
 * @returns {number} Epoch-ms threshold; pass when Date.now() >= threshold
 */
function cbTodayResetMs(minutes) {
  const d = new Date(Date.now() + 6 * 3600000);
  return Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(),
    Math.floor(minutes / 60), minutes % 60, 0
  ) - 6 * 3600000;
}
