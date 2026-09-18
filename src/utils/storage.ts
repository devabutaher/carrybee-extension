import Dexie, { type EntityTable } from 'dexie';
import type { ConsignmentRecord, Settings } from '~/types';
import { DEFAULT_SETTINGS } from '~/types';
import { shouldDailyReset } from '~/utils/date';

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

const db = new Dexie('CarryBeeDB') as Dexie & {
  consignments: EntityTable<ConsignmentRow, 'id'>;
  settings: EntityTable<SettingsRow, 'key'>;
};

db.version(1).stores({
  consignments: '++id, business, consignmentId, at, [business+consignmentId]',
  settings: 'key',
});

export const storageDB = db;

// ============ Settings ============

export async function getSettings(): Promise<Settings> {
  const row = await db.settings.get('main');
  return row ? row.value : DEFAULT_SETTINGS;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await db.settings.put({ key: 'main', value: settings });
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

/**
 * Check and perform daily reset based on BDT timezone.
 */
export async function checkDailyReset(): Promise<boolean> {
  const settings = await getSettings();
  const resetTimestamp = (await db.settings.get('lastReset')) as unknown as {
    key: string;
    value: number;
  } | undefined;

  const lastReset = resetTimestamp?.value ?? 0;

  if (shouldDailyReset(lastReset, settings.resetHour)) {
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
