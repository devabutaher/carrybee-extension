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
  resetHour: number;
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
  resetHour: 19,
};

export const DEFAULT_CONSIGNMENT_DATA: ConsignmentData = {
  version: 2,
  lastReset: 0,
  businesses: {},
};

export interface PrintThenSortResult {
  ok: boolean;
  reason?: string;
}

export interface RuntimeMessage {
  type: string;
  [key: string]: unknown;
}
