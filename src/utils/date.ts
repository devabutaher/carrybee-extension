/**
 * BDT (Bangladesh Time, UTC+6) timezone utilities.
 */

const BDT_OFFSET_MS = 6 * 60 * 60 * 1000;

/**
 * Get current time in BDT.
 */
export function nowBDT(): Date {
  return new Date(Date.now() + BDT_OFFSET_MS);
}

/**
 * Get today's reset time in UTC for the given BDT reset hour.
 * @param resetHourBDT - Hour in BDT (0-23)
 * @returns Date in UTC when reset should happen today
 */
export function getTodayResetUTC(resetHourBDT: number): Date {
  const bdtNow = nowBDT();
  const todayResetBDT = new Date(bdtNow);
  todayResetBDT.setHours(resetHourBDT, 0, 0, 0);
  return new Date(todayResetBDT.getTime() - BDT_OFFSET_MS);
}

/**
 * Check if daily reset threshold has been crossed.
 * @param lastResetTimestamp - Timestamp of last reset
 * @param resetHourBDT - Configured reset hour in BDT
 * @returns true if reset is needed
 */
export function shouldDailyReset(lastResetTimestamp: number, resetHourBDT: number): boolean {
  const now = new Date();
  const todayResetUTC = getTodayResetUTC(resetHourBDT);
  return now >= todayResetUTC && lastResetTimestamp < todayResetUTC.getTime();
}

/**
 * Format a timestamp to BDT time string.
 */
export function formatTimeBDT(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Dhaka',
  });
}
