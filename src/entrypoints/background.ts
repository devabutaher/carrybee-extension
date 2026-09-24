/**
 * CarryBee Auto-Flow — Background Service Worker
 *
 * Handles keyboard shortcuts defined in manifest.json (chrome.commands).
 * Forwards commands to the active tab's content script.
 */

import { checkDailyReset, storageDB, addConsignment, getSettings } from '~/utils/storage';

export default defineBackground(() => {
  // ============ KEYBOARD SHORTCUTS ============

  browser.commands.onCommand.addListener((command) => {
    browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      if (!tab?.id) return;

      const validCommands = new Set([
        'set-consignment-mode',
        'set-phone-mode',
        'set-merchant-mode',
        'set-cod-mode',
      ]);

      if (!validCommands.has(command)) return;

      browser.tabs.sendMessage(
        tab.id,
        {
          type: 'CB_COMMAND',
          command,
        },
        () => {
          void browser.runtime.lastError;
        }
      );
    });
  });

  // ============ DAILY RESET (BDT, resetAtMinutes from settings) ============

  // Alarm: check every hour
  browser.alarms.create('dailyReset', { periodInMinutes: 60 });

  browser.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'dailyReset') {
      await checkDailyReset();
    }
  });

  // Also check on service worker startup
  checkDailyReset();

  // ============ MESSAGE HANDLING ============

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'CB_CHECK_DAILY_RESET') {
      checkDailyReset().then((wasReset) => {
        sendResponse({ reset: wasReset });
      });
      return true;
    }

    if (msg.type === 'CB_ADD_CONSIGNMENT') {
      addConsignment(msg.business, msg.consignmentId, msg.timestamp).then(() => {
        sendResponse({ ok: true });
      });
      return true;
    }

    if (msg.type === 'CB_GET_SETTINGS') {
      getSettings().then((s) => {
        sendResponse(s);
      });
      return true;
    }

    if (msg.type === 'CB_GET_CONSIGNMENTS') {
      storageDB.consignments
        .orderBy('at')
        .reverse()
        .toArray()
        .then((rows) => {
          const result: Record<string, Array<{ id: string; at: number }>> = {};
          for (const row of rows) {
            if (!result[row.business]) result[row.business] = [];
            result[row.business].push({ id: row.consignmentId, at: row.at });
          }
          sendResponse({ businesses: result });
        });
      return true;
    }

    if (msg.type === 'CB_GET_STATE') {
      browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs?.[0];
        if (!tab?.id) {
          sendResponse({ enabled: false, mode: null });
          return;
        }
        browser.tabs.sendMessage(
          tab.id,
          { type: 'CB_GET_STATE' },
          (response) => {
            if (browser.runtime.lastError || !response) {
              sendResponse({ enabled: false, mode: null });
            } else {
              sendResponse(response);
            }
          }
        );
      });
      return true;
    }

    if (msg.type === 'CB_SET_STATE') {
      browser.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs?.[0];
        if (!tab?.id) {
          sendResponse({ enabled: false, mode: null });
          return;
        }
        browser.tabs.sendMessage(tab.id, msg, (response) => {
          if (browser.runtime.lastError || !response) {
            sendResponse({ enabled: false, mode: null });
          } else {
            sendResponse(response);
          }
        });
      });
      return true;
    }
  });
});
