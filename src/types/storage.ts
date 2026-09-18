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
