// CarryBee Check Entry — background
//
// UI = Chrome SIDE PANEL (docked, never closes, never resets, always
// visible beside the Sheet). The side panel can never take keyboard
// focus, so nothing here requires it:
//   • Toolbar icon click   → panel opens (openPanelOnActionClick)
//   • Alt+Q                → open panel + fill Business Name (clipboard)
//   • Alt+W                → open panel + fill Phone + auto-run the check
//
// Clipboard read order (the Sheet document holds focus, the panel does
// not): 1. panel itself (some builds allow it with clipboardRead) →
// 2. active tab executeScript (the focused doc — Google Sheet) →
// 3. offscreen textarea + execCommand('paste').

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dbgBg = (...args) => console.debug('[CE bg]', ...args);

// Icon click opens the panel natively (no onClicked handler needed).
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.error('[CE bg] panel behavior failed:', String(e)));

// ── Side panel helpers ──
async function openSidePanel() {
  // Allowed from user gestures: toolbar click OR keyboard shortcuts.
  try {
    const w = await chrome.windows.getLastFocused();
    await chrome.sidePanel.open({ windowId: w.id });
    dbgBg('side panel opened (window', w.id, ')');
    return true;
  } catch (e) {
    console.error('[CE bg] sidePanel.open failed:', String((e && e.message) || e));
    return false;
  }
}

// ── Clipboard readers ──
async function readClipboardFromActiveTab() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab || !tab.id) return null;
    // chrome:// and other special pages cannot be scripted
    if (/^(chrome|edge|about|chrome-extension|devtools):/i.test(tab.url || '')) {
      dbgBg('active tab not scriptable:', tab.url);
      return null;
    }
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (navigator.clipboard ? navigator.clipboard.readText() : null),
    });
    const text = results && results[0] && results[0].result;
    dbgBg(
      'active-tab clipboard read: got',
      typeof text === 'string' ? text.length : 'null',
      'chars'
    );
    return typeof text === 'string' ? { ok: true, text } : null;
  } catch (e) {
    dbgBg('active-tab read failed:', String((e && e.message) || e));
    return null;
  }
}

async function ensureOffscreenDoc() {
  if (!chrome.offscreen) {
    dbgBg('chrome.offscreen unavailable on this Chrome');
    return false;
  }
  try {
    if (chrome.offscreen.hasDocument && (await chrome.offscreen.hasDocument())) {
      return true;
    }
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['CLIPBOARD'],
      justification:
        'Read the copied business name / phone number to auto-fill the Check Entry panel',
    });
    dbgBg('offscreen document created');
    return true;
  } catch (e) {
    dbgBg('offscreen create failed:', String((e && e.message) || e));
    return !!(chrome.offscreen.hasDocument && (await chrome.offscreen.hasDocument()));
  }
}

async function readClipboardOffscreen() {
  try {
    if (!(await ensureOffscreenDoc())) return null;
    for (let i = 0; i < 5; i++) {
      const response = await new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage({ type: 'CE_REQUEST_CLIPBOARD' }, (resp) => {
            if (chrome.runtime.lastError) resolve(null);
            else resolve(resp);
          });
        } catch {
          resolve(null);
        }
      });
      if (response && typeof response === 'object' && 'ok' in response) {
        dbgBg('clipboard read via offscreen:', response.ok, response.error || '');
        return response;
      }
      await sleep(150); // offscreen doc may still be booting
    }
    dbgBg('offscreen reader never responded');
    return null;
  } catch {
    return null;
  }
}

// ── Panel messaging ──
// Ask the panel to read the clipboard + fill Business Name itself.
// Some Chrome builds allow extension-page clipboard reads without focus.
async function fillPanelDirect() {
  for (let i = 0; i < 10; i++) {
    const response = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: 'CE_FOCUS_INPUT' }, (resp) => {
          if (chrome.runtime.lastError) resolve(undefined);
          else resolve(resp);
        });
      } catch {
        resolve(undefined);
      }
    });

    if (response === undefined) {
      await sleep(200); // panel not ready yet
      continue;
    }
    dbgBg('panel ack:', response);
    return response === true;
  }
  return false;
}

// Tell the panel to fill Business Name with text we read elsewhere.
async function sendFillToPanel(text) {
  for (let i = 0; i < 10; i++) {
    const acked = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'CE_FILL_BUSINESS', text },
          (response) => {
            if (chrome.runtime.lastError) resolve(false);
            else resolve(!!response);
          }
        );
      } catch {
        resolve(false);
      }
    });
    if (acked) return true;
    await sleep(200);
  }
  return false;
}

// Tell the panel to fill the Phone field and auto-run the check.
async function sendPhoneToPanel(text) {
  for (let i = 0; i < 10; i++) {
    const acked = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'CE_FILL_PHONE', text },
          (response) => {
            if (chrome.runtime.lastError) resolve(false);
            else resolve(!!response);
          }
        );
      } catch {
        resolve(false);
      }
    });
    if (acked) return true;
    await sleep(200);
  }
  return false;
}

// Shared clipboard acquisition for text fields:
// 1) panel direct (rare), 2) focused active tab, 3) offscreen.
async function readClipboardEverywhere() {
  // The Sheet page is nearly always the focused document on Alt+Q/Alt+W.
  const fromTab = await readClipboardFromActiveTab();
  if (fromTab && fromTab.ok && fromTab.text && fromTab.text.trim()) {
    return fromTab.text;
  }
  const clip = await readClipboardOffscreen();
  if (clip && clip.ok && clip.text && clip.text.trim()) return clip.text;
  return '';
}

// ── Alt+Q: open panel + fill Business Name ──
async function openPanelAndFill() {
  let filled = false;
  try {
    await openSidePanel();

    // 1) fast path — panel may read the clipboard itself
    for (let attempt = 0; attempt < 2 && !filled; attempt++) {
      if (await fillPanelDirect()) filled = true;
      else await sleep(200);
    }

    // 2) fill with text read from the active tab / offscreen
    if (!filled) {
      const text = await readClipboardEverywhere();
      dbgBg('filling panel from external clipboard');
      filled = await sendFillToPanel(text);
    }
  } catch (e) {
    console.error('[CE bg] openPanelAndFill failed:', String((e && e.message) || e));
  }

  if (!filled) dbgBg('fill skipped: no clipboard source available');
  return filled;
}

// ── Alt+W: open panel + fill Phone + auto-run the check ──
async function openPanelAndSearch() {
  let filled = false;
  try {
    await openSidePanel();
    const text = await readClipboardEverywhere();
    dbgBg('filling phone + auto-check from clipboard');
    filled = await sendPhoneToPanel(text);
  } catch (e) {
    console.error('[CE bg] openPanelAndSearch failed:', String((e && e.message) || e));
  }
  if (!filled) dbgBg('phone fill skipped: no clipboard source available');
  return filled;
}

// Alt+Q — Business Name
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'focus-entry') await openPanelAndFill();
  if (command === 'fill-phone') await openPanelAndSearch();
});
