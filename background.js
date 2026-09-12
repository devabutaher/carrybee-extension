/**
 * CarryBee Auto-Flow — Background Service Worker
 *
 * Handles keyboard shortcuts defined in manifest.json (chrome.commands).
 * Forwards commands to the active tab's content script.
 *
 * Shortcuts:
 *   Ctrl+Shift+1 → Consignment ID mode
 *   Ctrl+Shift+2 → Customer Phone mode
 *   Ctrl+Shift+3 → Merchant Order ID mode
 *   Ctrl+Shift+4 → COD Quantity mode
 */

chrome.commands.onCommand.addListener((command) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs?.[0];
    if (!tab?.id) return;

    const validCommands = new Set([
      'set-consignment-mode',
      'set-phone-mode',
      'set-merchant-mode',
      'set-cod-mode',
    ]);

    if (!validCommands.has(command)) return;

    chrome.tabs.sendMessage(tab.id, {
      type: 'CB_COMMAND',
      command,
    }, () => {
      void chrome.runtime.lastError;
    });
  });
});

// ============ DAILY RESET (7 PM BDT) ============

const STORAGE_KEY = 'cbConsignments_v2';
const RESET_HOUR_BDT = 19;

async function checkDailyReset() {
  const { [STORAGE_KEY]: data } = await chrome.storage.local.get(STORAGE_KEY);
  if (!data) return false;

  const now = new Date();
  const bdtNow = new Date(now.getTime() + 6 * 3600000);
  const todayResetBDT = new Date(bdtNow);
  todayResetBDT.setHours(RESET_HOUR_BDT, 0, 0, 0);
  const todayResetUTC = new Date(todayResetBDT.getTime() - 6 * 3600000);

  if (now >= todayResetUTC && data.lastReset < todayResetUTC.getTime()) {
    data.businesses = {};
    data.lastReset = todayResetUTC.getTime();
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

// Handle popup request
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'CB_CHECK_DAILY_RESET') {
    checkDailyReset().then((wasReset) => {
      sendResponse({ reset: wasReset });
    });
    return true; // async response
  }
});
