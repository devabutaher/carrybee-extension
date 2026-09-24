/**
 * BDT (Bangladesh Time, UTC+6) timezone utilities.
 * Pure UTC math — independent of the machine's timezone.
 */

const BDT_OFFSET_MS = 6 * 60 * 60 * 1000;

/** Default daily reset: 7:00 PM BDT (minutes since midnight). */
const DEFAULT_RESET_MINUTES = 19 * 60;

/**
 * Get current time in BDT.
 */
export function nowBDT(): Date {
  return new Date(Date.now() + BDT_OFFSET_MS);
}

/**
 * Resolve stored settings → reset minutes since midnight BDT (0–1439).
 * Reads resetAtMinutes; falls back to legacy resetHour (0–23) if present.
 */
export function resolveResetMinutes(settings: {
  resetAtMinutes?: number | null;
  resetHour?: number | null;
}): number {
  const m =
    typeof settings?.resetAtMinutes === "number"
      ? settings.resetAtMinutes
      : typeof settings?.resetHour === "number"
        ? settings.resetHour * 60
        : DEFAULT_RESET_MINUTES;
  return ((m % 1440) + 1440) % 1440;
}

/**
 * Today's reset instant as epoch-ms (BDT / UTC+6).
 * @param minutes - Minutes since midnight BDT (0–1439)
 * @returns Epoch-ms threshold; pass when Date.now() >= threshold
 */
export function todayResetMs(minutes: number): number {
  const d = new Date(Date.now() + BDT_OFFSET_MS);
  return (
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate(),
      Math.floor(minutes / 60),
      minutes % 60,
      0,
    ) - BDT_OFFSET_MS
  );
}

/**
 * Check if daily reset threshold has been crossed.
 * @param lastResetTimestamp - Timestamp of last reset
 * @param resetMinutes - Configured reset minutes since midnight BDT
 * @returns true if reset is needed
 */
export function shouldDailyReset(
  lastResetTimestamp: number,
  resetMinutes: number,
): boolean {
  const resetMs = todayResetMs(resetMinutes);
  return Date.now() >= resetMs && lastResetTimestamp < resetMs;
}

/**
 * Format a timestamp to BDT time string.
 */
export function formatTimeBDT(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Dhaka",
  });
}
