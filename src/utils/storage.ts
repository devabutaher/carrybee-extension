import Dexie, { type EntityTable } from 'dexie';
import type { ConsignmentRecord, Settings } from '~/types';
import { DEFAULT_SETTINGS } from '~/types';
import { resolveResetMinutes, shouldDailyReset } from '~/utils/date';

interface SettingsRow {
  key: string;
  value: Settings;
}

interface ConsignmentRow {
  id: string;
  business: string;
  consignmentId: string;
  at: number;
}

/** Parcel received a print click; `confirmed` only after a print toast was verified. */
interface PrintLockRow {
  id: string; // consignment ID
  at: number;
  confirmed: 0 | 1;
}

const db = new Dexie('CarryBeeDB') as Dexie & {
  consignments: EntityTable<ConsignmentRow, 'id'>;
  settings: EntityTable<SettingsRow, 'key'>;
  printLocks: EntityTable<PrintLockRow, 'id'>;
};

db.version(1).stores({
  consignments: '++id, business, consignmentId, at, [business+consignmentId]',
  settings: 'key',
});

db.version(2).stores({
  consignments: '++id, business, consignmentId, at, [business+consignmentId]',
  settings: 'key',
  printLocks: 'id, at',
});

export const storageDB = db;

// ============ Settings ============

/** Stored rows written by v2.0.0 (legacy resetHour field). */
type LegacySettings = Partial<Settings> & { resetHour?: number };

export async function getSettings(): Promise<Settings> {
  const row = await db.settings.get('main');
  if (!row) return DEFAULT_SETTINGS;
  const { resetHour, ...rest } = row.value as LegacySettings;
  let settings: Settings = { ...DEFAULT_SETTINGS, ...rest };
  if (rest.resetAtMinutes == null && typeof resetHour === 'number') {
    settings = { ...settings, resetAtMinutes: resetHour * 60 };
  }
  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await db.settings.put({ key: 'main', value: settings });
  // Mirror to chrome.storage.local so the content script's onChanged listener
  // fires and refetches fresh settings from the background (Dexie).
  try {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      chrome.storage.local.set({ cbSettings: settings });
    }
  } catch {
    /* storage unavailable outside extension context */
  }
}

// ============ Consignments ============

const MAX_CONSIGNMENTS_PER_BUSINESS = 1000;

/**
 * Get all consignments grouped by business name.
 */
export async function getAllConsignments(): Promise<
  Record<string, ConsignmentRecord[]>
> {
  const rows = await db.consignments.orderBy('at').reverse().toArray();
  const result: Record<string, ConsignmentRecord[]> = {};

  for (const row of rows) {
    if (!result[row.business]) {
      result[row.business] = [];
    }
    result[row.business].push({ id: row.consignmentId, at: row.at });
  }

  return result;
}

/**
 * Get consignments for a specific business.
 */
export async function getConsignmentsByBusiness(
  business: string
): Promise<ConsignmentRecord[]> {
  const rows = await db.consignments
    .where('business')
    .equals(business)
    .reverse()
    .sortBy('at');
  return rows.map((r) => ({ id: r.consignmentId, at: r.at }));
}

/**
 * Add a consignment record. Moves duplicates to front (most recent first).
 * Enforces MAX_CONSIGNMENTS_PER_BUSINESS limit.
 */
export async function addConsignment(
  business: string,
  consignmentId: string,
  timestamp: number = Date.now()
): Promise<void> {
  // Remove existing duplicate
  const existing = await db.consignments
    .where('[business+consignmentId]')
    .equals([business, consignmentId])
    .first();
  if (existing) {
    await db.consignments.delete(existing.id);
  }

  // Add new record
  await db.consignments.add({
    business,
    consignmentId,
    at: timestamp,
  });

  // Enforce limit: keep only the most recent MAX_CONSIGNMENTS_PER_BUSINESS
  const allForBusiness = await db.consignments
    .where('business')
    .equals(business)
    .reverse()
    .sortBy('at');

  if (allForBusiness.length > MAX_CONSIGNMENTS_PER_BUSINESS) {
    const toDelete = allForBusiness
      .slice(MAX_CONSIGNMENTS_PER_BUSINESS)
      .map((r) => r.id);
    await db.consignments.bulkDelete(toDelete);
  }
}

/**
 * Add multiple consignments in a batch.
 */
export async function addConsignmentBatch(
  records: Array<{ business: string; consignmentId: string }>
): Promise<void> {
  const timestamp = Date.now();
  for (const { business, consignmentId } of records) {
    await addConsignment(business, consignmentId, timestamp);
  }
}

/**
 * Clear all consignments for a specific business.
 */
export async function clearConsignmentsByBusiness(
  business: string
): Promise<void> {
  await db.consignments.where('business').equals(business).delete();
}

/**
 * Clear ALL consignments.
 */
export async function clearAllConsignments(): Promise<void> {
  await db.consignments.clear();
}

// ============ Print Locks ============
// Anti-double-print guard: once a print click happens for a consignment the
// extension must never click print on it again. Locks survive Stop, page
// reload and browser restart. Expire after 3 days (auto-pruned), NOT cleared
// by the daily reset.

const PRINT_LOCK_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** Prune print locks older than the TTL (3 days). */
export async function prunePrintLocks(now: number = Date.now()): Promise<void> {
  await db.printLocks.where('at').below(now - PRINT_LOCK_TTL_MS).delete();
}

/**
 * Record a print lock for a consignment. Never downgrades a confirmed lock to
 * pending, and never overwrites an existing confirmed lock.
 */
export async function addPrintLock(
  consignmentId: string,
  confirmed: boolean,
  timestamp: number = Date.now()
): Promise<void> {
  const existing = await db.printLocks.get(consignmentId);
  if (existing) {
    if (existing.confirmed === 1 || !confirmed) return; // confirmed stays, never downgrade
    await db.printLocks.update(consignmentId, { confirmed: 1, at: timestamp });
    return;
  }
  await db.printLocks.add({
    id: consignmentId,
    at: timestamp,
    confirmed: confirmed ? 1 : 0,
  });
}

/** { consignmentId: printWasToastConfirmed } — prunes expired locks first. */
export async function getPrintLocks(): Promise<Record<string, boolean>> {
  await prunePrintLocks();
  const rows = await db.printLocks.toArray();
  const locks: Record<string, boolean> = {};
  for (const row of rows) locks[row.id] = row.confirmed === 1;
  return locks;
}

/**
 * Check and perform daily reset based on BDT timezone.
 * Guards: dailyResetEnabled false → skip.
 */
export async function checkDailyReset(): Promise<boolean> {
  const settings = await getSettings();
  if (settings.dailyResetEnabled === false) return false;

  const resetTimestamp = (await db.settings.get('lastReset')) as unknown as {
    key: string;
    value: number;
  } | undefined;

  const lastReset = resetTimestamp?.value ?? 0;

  if (shouldDailyReset(lastReset, resolveResetMinutes(settings))) {
    await clearAllConsignments();
    await db.settings.put({
      key: 'lastReset',
      value: Date.now(),
    } as unknown as SettingsRow);
    return true;
  }

  return false;
}

/**
 * Get the count of consignments for a business.
 */
export async function getConsignmentCount(business: string): Promise<number> {
  return await db.consignments.where('business').equals(business).count();
}

/**
 * Get all unique business names.
 */
export async function getBusinessNames(): Promise<string[]> {
  const rows = await db.consignments.orderBy('business').uniqueKeys();
  return rows as string[];
}
