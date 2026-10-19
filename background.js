// CarryBee Check Entry — background
//
// Opens ONE fixed-size popup window pinned above other windows
// (alwaysOnTop). Icon click / Alt+Q → open-or-focus the window, then fill
// the Business Name field from the clipboard. Keyboard focus is fully
// controlled here: a fresh popup window takes OS focus on creation, and
// windows.update({focused:true}) re-claims it for an existing one.
//
// Clipboard read order (the panel document may or may not be focused):
//   1. panel itself (works when the popup holds focus)
//   2. active tab executeScript (the focused doc — Google Sheet)
//   3. offscreen textarea + execCommand('paste')

const PANEL_URL = 'chrome-extension://' + chrome.runtime.id + '/popup/index.html';
const PANEL_WIDTH = 340; // outer incl. frames; content column is 320px
const PANEL_HEIGHT = 660;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dbgBg = (...args) => console.debug('[CE bg]', ...args);

// ── Panel window helpers ──
function findPanelTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: PANEL_URL }, (tabs) => {
      if (chrome.runtime.lastError) return resolve(null);
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

async function focusPanelWindow(windowId) {
  // IMPORTANT: never combine alwaysOnTop + focused in one update call.
  // Pinning internally moves the window without activation; combining both
  // makes Chrome drop the focus request. Pin FIRST, then focus separately.
  try {
    await chrome.windows.update(windowId, { alwaysOnTop: true });
  } catch (e) {
    console.error('[CE bg] pin failed:', String((e && e.message) || e));
    return false;
  }
  try {
    await chrome.windows.update(windowId, { focused: true });
    return true;
  } catch (e) {
    console.error('[CE bg] focus failed:', String((e && e.message) || e));
    return false;
  }
}

async function createPanelWindow() {
  // Anchor at the top-right of the currently focused normal window
  let anchor = null;
  try {
    anchor = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  } catch {
    anchor = null;
  }

  const left = anchor
    ? Math.max(0, anchor.left + anchor.width - PANEL_WIDTH - 8)
    : undefined;
  const top = anchor ? Math.max(0, anchor.top + 80) : undefined;

  return new Promise((resolve) => {
    chrome.windows.create(
      {
        url: PANEL_URL,
        type: 'popup',
        width: PANEL_WIDTH,
        height: PANEL_HEIGHT,
        left,
        top,
        // NOTE: alwaysOnTop is NOT valid in createData (schema throws
        // "Unexpected property" → no window, error swallowed). It gets
        // applied via windows.update right after creation.
      },
      async (w) => {
        if (chrome.runtime.lastError || !w) {
          console.error('[CE bg] window create failed:', chrome.runtime.lastError);
          resolve(null);
          return;
        }
    // Pin AFTER creation, then focus (order matters — see focusPanelWindow)
    try {
      await chrome.windows.update(w.id, { alwaysOnTop: true });
      dbgBg('window pinned on top');
    } catch (e) {
      console.error('[CE bg] pin after create failed:', String((e && e.message) || e));
    }
    try {
      await chrome.windows.update(w.id, { focused: true });
      dbgBg('window focused after create');
    } catch (e) {
      console.error('[CE bg] focus after create failed:', String((e && e.message) || e));
    }
    resolve(w);
      }
    );
  });
}

// ── Clipboard readers (see header) ──
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
        'Read the copied business name to auto-fill the Check Entry panel',
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
// In a popup window holding focus this is the fast path.
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
    return response === true; // panel read the clipboard + filled + focused phone
  }
  return false;
}

// Tell the panel to fill with text we already read elsewhere.
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

// ── Main: open-or-focus the panel window, then fill Business Name ──
async function openPanelAndFill() {
  let filled = false;

  try {
    const existing = await findPanelTab();
    let panelTab = existing;

    if (existing && existing.windowId != null) {
      await focusPanelWindow(existing.windowId); // existing window → re-claim focus
      dbgBg('raising existing panel window');
    } else {
      const created = await createPanelWindow();
      if (created) {
        await sleep(100);
        panelTab = await findPanelTab();
        dbgBg('created panel window', created.id);
      }
    }
    if (!panelTab) return false;

    // 1) fast path — popup window owns OS focus, so the panel reads itself
    for (let attempt = 0; attempt < 2 && !filled; attempt++) {
      if (await fillPanelDirect()) filled = true;
      else await sleep(200);
    }

    // 2) fill with text read from the focused active tab (e.g. Google Sheet)
    if (!filled) {
      const fromTab = await readClipboardFromActiveTab();
      if (fromTab && fromTab.ok && fromTab.text && fromTab.text.trim()) {
        dbgBg('filling panel from active-tab clipboard');
        filled = await sendFillToPanel(fromTab.text);
      }
    }

    // 3) last resort — offscreen textarea + execCommand('paste')
    if (!filled) {
      const clip = await readClipboardOffscreen();
      if (clip && clip.ok && clip.text && clip.text.trim()) {
        dbgBg('filling panel from offscreen clipboard');
        filled = await sendFillToPanel(clip.text);
      } else {
        dbgBg('fill skipped: no clipboard source available (clip =', clip, ')');
      }
    }

    // Extra nudge — some builds drop key focus after cross-context messaging
    await focusPanelWindow(panelTab.windowId);
  } catch (e) {
    console.error('[CE bg] openPanelAndFill failed:', String((e && e.message) || e));
  }

  return filled;
}

// Toolbar icon click → open/focus + fill
chrome.action.onClicked.addListener(openPanelAndFill);

// Alt+Q — open the ACTION popup (anchored to the toolbar; Chrome itself
// gives it keyboard focus by design). Fall back to the standalone window
// flow only on Chrome builds without action.openPopup (< 127).
chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'focus-entry') return;
  if (chrome.action.openPopup) {
    try {
      await chrome.action.openPopup();
      return;
    } catch (e) {
      console.error('[CE bg] openPopup failed, falling back to window:', String((e && e.message) || e));
    }
  }
  await openPanelAndFill();
});
