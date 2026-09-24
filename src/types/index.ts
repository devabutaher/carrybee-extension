export type Mode = 'merchant' | 'phone' | 'consignment' | 'cod';

export type AutomationState =
  | 'IDLE'
  | 'WAITING_ROWS'
  | 'PHONE_CONFIRM'
  | 'WEIGHT_EDIT'
  | 'WEIGHT_ENTRY'
  | 'PRINTING'
  | 'SORTING'
  | 'PROCESSING';

export interface Settings {
  showMainBadge: boolean;
  showProgressBadge: boolean;
  resetAtMinutes: number;
  dailyResetEnabled: boolean;
  skipWeight: boolean;
}

export interface ConsignmentRecord {
  id: string;
  at: number;
}

export interface ConsignmentData {
  version: 2;
  lastReset: number;
  businesses: Record<string, ConsignmentRecord[]>;
}

export interface BadgeMode {
  info: 'info';
  working: 'working';
  waitInput: 'wait-input';
  success: 'success';
  error: 'error';
  off: 'off';
}

export const DEFAULT_SETTINGS: Settings = {
  showMainBadge: true,
  showProgressBadge: true,
  resetAtMinutes: 19 * 60,
  dailyResetEnabled: true,
  skipWeight: false,
};

export const DEFAULT_CONSIGNMENT_DATA: ConsignmentData = {
  version: 2,
  lastReset: 0,
  businesses: {},
};

export interface PrintThenSortResult {
  ok: boolean;
  reason?: string;
  unverified?: boolean;
}

export interface RuntimeMessage {
  type: string;
  [key: string]: unknown;
}
