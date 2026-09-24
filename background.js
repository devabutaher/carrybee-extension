/**
 * CarryBee Auto-Flow — Background Service Worker
 *
 * Duties:
 *   1. Keyboard shortcuts (chrome.commands) → forward to content script
 *   2. Daily consignment reset (BDT) — alarm + startup + popup request
 *
 * Loads shared.js (importScripts) for cbResolveResetMinutes / cbTodayResetMs.
 *
 * Shortcuts:
 *   Ctrl+Shift+1 → Consignment ID mode
 *   Ctrl+Shift+2 → Customer Phone mode
 *   Ctrl+Shift+3 → Merchant Order ID mode
 *   Ctrl+Shift+4 → COD Quantity mode
 */

importScripts('shared.js');

// ============ KEYBOARD SHORTCUTS ============

const VALID_COMMANDS = new Set([
  'set-consignment-mode',
  'set-phone-mode',
  'set-merchant-mode',
  'set-cod-mode',
]);

chrome.commands.onCommand.addListener((command) => {
  if (!VALID_COMMANDS.has(command)) return;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0];
    if (!tab?.id) return;

    chrome.tabs.sendMessage(tab.id, {
      type: 'CB_COMMAND',
      command,
    }, () => {
      void chrome.runtime.lastError;
    });
  });
});

// ============ DAILY RESET (BDT, resetAtMinutes from settings) ============

const STORAGE_KEY = 'cbConsignments_v2';
const SETTINGS_KEY = 'cbSettings';

/**
 * Clear today's consignments if past the BDT reset threshold.
 * Guards: no data → skip; dailyResetEnabled false → skip.
 *
 * @returns {Promise<boolean>} true if a reset actually ran
 */
async function checkDailyReset() {
  const { [STORAGE_KEY]: data, [SETTINGS_KEY]: settings } = await chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY]);
  if (!data) return false;
  if (settings?.dailyResetEnabled === false) return false;

  const resetMs = cbTodayResetMs(cbResolveResetMinutes(settings));

  if (Date.now() >= resetMs && data.lastReset < resetMs) {
    data.businesses = {};
    data.lastReset = resetMs;
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
    return true;
  }
  return false;
}

// Alarm: check every hour
chrome.alarms.create('dailyReset', { periodInMinutes: 60 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'dailyReset') {
    await checkDailyReset();
  }
});

// Also check on service worker startup
checkDailyReset();

// Handle popup request (popup sends CB_CHECK_DAILY_RESET on open)
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'CB_CHECK_DAILY_RESET') {
    checkDailyReset().then((wasReset) => {
      sendResponse({ reset: wasReset });
    });
    return true; // async response
  }
});
