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

    // Valid commands from manifest.json
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
