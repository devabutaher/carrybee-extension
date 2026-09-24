/**
 * CarryBee Order Processing Auto-Flow — Content Script
 *
 * Injects into hive.carrybee.com/order-processing/* and /sub-sort/* (via
 * manifest). Loads after shared.js (cbResolveResetMinutes / cbTodayResetMs).
 *
 * Provides 4 automated processing modes:
 *   1. Merchant Order ID — scan → weight → print → sort
 *   2. Customer Phone — scan → confirm → weight → print → sort
 *   3. COD Quantity — batch loop: print → sort (no weight)
 *   4. Consignment ID — scan → weight → print → sort
 *
 * Tracks sorted consignment IDs per business in chrome.storage.
 * Communicates with popup via chrome.runtime messages.
 */

(() => {
  'use strict';

  // ============ CONFIGURATION ============
  /** Timing constants (ms) and limits used throughout the extension. */
  const CFG = {
    debounceMs: 200,
    rowPollIntervalMs: 50,
    rowStableMs: 200,
    rowPollHardMaxMs: 1000,
    weightInputWaitMs: 2000,
    weightToastTimeoutMs: 3000,
    printToastTimeoutMs: 12000,
    sortPollMs: 500,
    sortGraceTimeoutMs: 3000,
    sortDeadlineMs: 20000,
    badgeDisplayMs: 3000,
    mismatchBadgeMs: 2000,
    phoneSettleMs: 400,
    phoneSettleMaxMs: 2000,
    phoneEnterRememberMs: 1500,
  };

  // ============ SETTINGS ============
  const SETTINGS_KEY = 'cbSettings';
  let settings = {
    showMainBadge: true,
    showProgressBadge: true,
    resetAtMinutes: 19 * 60,
    dailyResetEnabled: true,
    skipWeight: false,
  };

  /** Load user settings from chrome.storage, merging with defaults. */
  async function loadSettings() {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) return resolve(settings);
      chrome.storage.local.get([SETTINGS_KEY], (res) => {
        if (chrome.runtime.lastError) {
          return resolve(settings);
        }
        const stored = res[SETTINGS_KEY] || {};
        settings = { ...settings, ...stored };
        // Legacy migration: stored resetHour (0-23) → resetAtMinutes
        if (stored.resetAtMinutes == null && stored.resetHour != null) {
          settings.resetAtMinutes = stored.resetHour * 60;
        }
        resolve(settings);
      });
    });
  }

  // ============ ROBUST SELECTORS ============
  /** Cache for findInputByLabel results. Invalidated on DOM mutations. */
  const inputCache = new Map();

  /** Drop input lookup cache (call after DOM remounts). */
  function clearInputCache() { inputCache.clear(); }

  /**
   * Find an input element using a fallback chain:
   *   1. aria-label attribute
   *   2. placeholder attribute
   *   3. XPath by associated <label> text
   *   4. DOM proximity to label text
   *
   * @param {string} labelText - The label text to search for
   * @param {string} [placeholderText] - Alternative placeholder text
   * @returns {HTMLInputElement|null}
   */
  function findInputByLabel(labelText, placeholderText) {
    const cached = inputCache.get(labelText);
    if (cached && document.body.contains(cached)) return cached;

    const ariaInput = document.querySelector(`input[aria-label="${labelText}"]`);
    if (ariaInput) { inputCache.set(labelText, ariaInput); return ariaInput; }

    if (placeholderText) {
      const phInput = document.querySelector(`input[placeholder="${placeholderText}"]`);
      if (phInput) { inputCache.set(labelText, phInput); return phInput; }
    }

    try {
      const xpath = `//label[contains(text(), "${labelText}")]//input | //label[contains(text(), "${labelText}")]/following-sibling::input`;
      const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      if (result.singleNodeValue) { inputCache.set(labelText, result.singleNodeValue); return result.singleNodeValue; }
    } catch (e) { /* XPath not supported or failed */ }

    const allInputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type])'));
    for (const input of allInputs) {
      const parent = input.closest('div, span, label');
      if (parent && parent.textContent.includes(labelText)) { inputCache.set(labelText, input); return input; }
    }

    return null;
  }

  /** DOM selectors for CarryBee page elements. */
  const SEL = {
    merchantOrderInput: () => findInputByLabel('Merchant Order ID', 'Search Merchant Order ID'),
    phoneInput: () => findInputByLabel('Customer Phone', 'Search Customer Phone'),
    codInput: () => findInputByLabel('COD', 'Search COD'),
    consignmentInput: () => findInputByLabel('Consignment ID', 'Search Consignment ID'),
    row: 'div[data-order-id]',
    weightIcon: 'svg.lucide-square-pen',
    weightInput: 'input[type="number"]',
    printBtn: 'svg.lucide-printer',
    sortBtn: 'svg.lucide-arrow-down-wide-narrow',
    toast: '[data-sonner-toast]',
  };

  // ============ STATE ============
  let enabled = false;
  let mode = null;
  let state = 'IDLE';
  let debounceTimer = null;
  let lastEnterAt = 0;
  let cycleToken = 0;
  let codQuantityCounter = 0;
  let codQuantityTarget = 0;
  let lastToastAt = 0;
  let lastToastEvents = [];
  let currentBusinessName = null;
  let confirmResolve = null;
  let confirmKeydownHandler = null;
  let currentAbortController = null;
  let pendingSortConsignmentId = null;
  let pendingBatchConsignments = [];
  let lastClickedRowId = null;

  // ============ BADGE ELEMENTS ============
  let badgeOuterEl = null;
  let badgeEl = null;
  let badgeContainerEl = null;
  let codProgressBadgeOuterEl = null;
  let codProgressBadgeEl = null;
  let codQuantityInputEl = null;
  let codStopButtonEl = null;

  // ============ BADGE FUNCTIONS ============

  /** Create or return the badge container element. Always appended to body for fixed positioning. */
  function badgeContainer() {
    if (badgeContainerEl && document.body.contains(badgeContainerEl)) return badgeContainerEl;

    badgeContainerEl = document.createElement('div');
    badgeContainerEl.id = 'cb-badge-container';
    document.body.appendChild(badgeContainerEl);
    return badgeContainerEl;
  }

  /** Create or return the main status badge element. */
  function badge() {
    if (badgeEl && document.body.contains(badgeEl)) return badgeEl;

    badgeOuterEl = document.createElement('div');
    badgeOuterEl.id = 'cb-auto-badge-outer';

    badgeEl = document.createElement('div');
    badgeEl.id = 'cb-auto-badge';

    badgeOuterEl.appendChild(badgeEl);
    badgeContainer().appendChild(badgeOuterEl);
    return badgeEl;
  }

  /** Create or return the COD progress badge element. */
  function codProgressBadge() {
    if (codProgressBadgeEl && document.body.contains(codProgressBadgeEl)) return codProgressBadgeEl;

    codProgressBadgeOuterEl = document.createElement('div');
    codProgressBadgeOuterEl.id = 'cb-cod-progress-badge-outer';

    codProgressBadgeEl = document.createElement('div');
    codProgressBadgeEl.id = 'cb-cod-progress-badge';

    codProgressBadgeOuterEl.appendChild(codProgressBadgeEl);
    document.body.appendChild(codProgressBadgeOuterEl);
    return codProgressBadgeEl;
  }

  /** Hide the main status badge. */
  function hideBadge() {
    if (badgeOuterEl) badgeOuterEl.style.display = 'none';
  }

  /**
   * Update the main status badge text and color.
   * @param {string} text - Badge text
   * @param {string} [mode_class] - CSS mode class (info, working, wait-input, success, error, off)
   */
  function setStatus(text, mode_class) {
    if (!enabled) return;
    if (!settings.showMainBadge) return;
    const el = badge();
    if (badgeOuterEl) badgeOuterEl.style.display = '';
    el.textContent = text;
    el.setAttribute('data-mode', mode_class || 'info');
  }

  /**
   * Update the COD progress badge or hide it.
   * @param {string|null} text - Progress text, or null to hide
   */
  function setCodProgress(text) {
    if (!text || !enabled || !settings.showProgressBadge) {
      if (codProgressBadgeOuterEl) codProgressBadgeOuterEl.style.display = 'none';
      return;
    }
    const el = codProgressBadge();
    codProgressBadgeOuterEl.style.display = 'block';
    el.textContent = text;
  }

  /** Show COD quantity input bar and set ready status. */
  function showCodQuantityInput() {
    const input = createCodQuantityInput();
    if (!input) return;
    wireCodQuantityInput();
    const container = input.parentElement;
    container.style.display = 'flex';
    if (codStopButtonEl) codStopButtonEl.style.display = 'none';
    input.value = '';
    setStatus('Ready — COD Quantity', 'info');
  }

  /** Hide COD quantity input bar and clear its value. */
  function hideCodQuantityInput() {
    if (codQuantityInputEl && codQuantityInputEl.parentElement) {
      codQuantityInputEl.parentElement.style.display = 'none';
    }
    if (codStopButtonEl) {
      codStopButtonEl.style.display = 'none';
    }
    if (codQuantityInputEl) {
      codQuantityInputEl.value = '';
    }
  }

  /** Update badge to reflect current mode or OFF state. */
  function showIdleStatus() {
    if (!enabled) {
      hideBadge();
      hideCodQuantityInput();
    } else if (mode === 'merchant') {
      setStatus('Ready — Merchant Order ID', 'info');
      hideCodQuantityInput();
    } else if (mode === 'phone') {
      setStatus('Ready — Customer Phone', 'info');
      hideCodQuantityInput();
    } else if (mode === 'consignment') {
      setStatus('Ready — Consignment ID', 'info');
      hideCodQuantityInput();
    } else if (mode === 'cod') {
      showCodQuantityInput();
    }
  }

  // ============ HELPERS ============

  /** Promise-based sleep. */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /**
   * Poll a predicate function until it returns truthy or timeout.
   * Supports AbortController for cancellation.
   *
   * @param {Function} predicate - Returns truthy value to resolve, or null to keep polling
   * @param {Object} opts - { interval, timeout, signal }
   * @returns {Promise<*>} Resolved value or null on timeout
   */
  function waitFor(predicate, { interval = 150, timeout = 3000, signal } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        return reject(new DOMException('Aborted', 'AbortError'));
      }

      const start = Date.now();
      let timerId = null;
      const onAbort = () => {
        if (timerId) clearTimeout(timerId);
        signal?.removeEventListener('abort', onAbort);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      (function tick() {
        if (signal?.aborted) {
          signal.removeEventListener('abort', onAbort);
          return reject(new DOMException('Aborted', 'AbortError'));
        }

        let val;
        try { val = predicate(); } catch (e) { val = null; }
        if (val) {
          if (timerId) clearTimeout(timerId);
          signal?.removeEventListener('abort', onAbort);
          return resolve(val);
        }
        if (Date.now() - start >= timeout) {
          if (timerId) clearTimeout(timerId);
          signal?.removeEventListener('abort', onAbort);
          return resolve(null);
        }
        timerId = setTimeout(tick, interval);
      })();
    });
  }

  // ============ PER-CYCLE CACHE ============
  let cachedRows = null;
  let cachedBusinessName = null;

  /** Invalidate per-cycle row/business cache (call when DOM/order list changes). */
  function clearCycleCache() { cachedRows = null; cachedBusinessName = null; }

  /** All order rows on the page (cached for the cycle). */
  function getRows() {
    if (cachedRows) return cachedRows;
    cachedRows = Array.from(document.querySelectorAll(SEL.row));
    return cachedRows;
  }

  /** Row's weight edit (pencil) icon. */
  function findWeightIcon(row) {
    return row.querySelector(SEL.weightIcon);
  }

  /** Row's weight number input, if open. */
  function findWeightNumberInput(row) {
    return row.querySelector(SEL.weightInput);
  }

  /** Row action button (print/sort) identified by lucide icon class. */
  function findActionButton(row, iconClass) {
    const icon = row.querySelector(`svg.${iconClass}`);
    return icon ? icon.closest('button') : null;
  }

  /** Consignment ID from row's data-order-id attribute. */
  function getConsignmentIdFromRow(row) {
    return row.getAttribute('data-order-id');
  }

  /** Extract the business name from the page UI. */
  function getBusinessName() {
    if (cachedBusinessName) return cachedBusinessName;
    const captions = Array.from(document.querySelectorAll('div')).slice(0, 500);
    for (const el of captions) {
      if (el.children.length > 0) continue;
      if (!/^Business Name$/i.test((el.textContent || '').trim())) continue;
      let value = el.nextElementSibling;
      if (value && (value.textContent || '').trim() === ':') {
        value = value.nextElementSibling;
      }
      if (value) {
        cachedBusinessName = value.textContent.trim();
        return cachedBusinessName;
      }
    }
    const match = document.body.innerText.match(/Business Name\s*:\s*([^\n:]+)/);
    cachedBusinessName = match ? match[1].trim() : 'Unknown';
    return cachedBusinessName;
  }

  // ============ TOAST WATCHER ============
  const toastTextByNode = new WeakMap();
  let toastDebounceTimer = null;

  /** Append toast text to ring buffer (max 50) and stamp lastToastAt. */
  function recordToast(text) {
    if (!text) return;
    lastToastEvents.push({ text, at: Date.now() });
    if (lastToastEvents.length > 50) lastToastEvents.shift();
    lastToastAt = Date.now();
  }

  // ============ MERGED DOM OBSERVER ============
  /** Debounce timer for input-remount reattachment. */
  let inputRemountDebounceTimer = null;

  /**
   * Single MutationObserver for toast detection + input remount.
   * Listens to childList and characterData (text inside existing toasts).
   */
  function watchDom() {
    const observer = new MutationObserver((mutations) => {
      let hasToast = false;
      let hasInputCandidate = false;

      for (const m of mutations) {
        if (hasToast && hasInputCandidate) break;
        // Text updates inside existing toast nodes (characterData mutations)
        if (!hasToast && m.type === 'characterData') hasToast = true;
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (!hasToast && (node.matches?.(SEL.toast) || node.querySelector?.(SEL.toast))) hasToast = true;
          if (!hasInputCandidate && node.querySelector?.('input[placeholder]')) hasInputCandidate = true;
        }
      }

      if (hasToast) {
        if (toastDebounceTimer) clearTimeout(toastDebounceTimer);
        toastDebounceTimer = setTimeout(processToasts, 50);
      }
      if (hasInputCandidate) {
        clearInputCache();
        if (inputRemountDebounceTimer) clearTimeout(inputRemountDebounceTimer);
        inputRemountDebounceTimer = setTimeout(attachInputListeners, 100);
      }
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  }

  /**
   * Process all live Sonner toasts: record them, and on sort-complete
   * either resume auto-flow (enabled + idle-ish) or track a manual sort.
   */
  function processToasts() {
    const toasts = Array.from(document.querySelectorAll(SEL.toast));
    for (const t of toasts) {
      const text = (t.textContent || '').trim();
      if (!text) continue;
      if (toastTextByNode.get(t) === text) continue;
      toastTextByNode.set(t, text);
      recordToast(text);

      if (isSortToast(text.toLowerCase())) {
        // Auto-flow on: resume + refocus input (covers IDLE e.g. after "Multiple parcels found")
        if (enabled && mode && state !== 'PRINTING' && state !== 'SORTING') {
          handleManualSortCompletion();
        }
        // Track manual sorts (extension OFF or IDLE) via click tracker
        if (lastClickedRowId && (state === 'IDLE' || !enabled)) {
          const bizName = getBusinessName();
          if (bizName) addConsignmentId(lastClickedRowId, bizName);
          lastClickedRowId = null;
        }
      }
    }
  }

  /** Handle manual sort completion (user clicked Print+Sort while extension was in WEIGHT_ENTRY or similar). */
  async function handleManualSortCompletion() {
    if (pendingSortConsignmentId && currentBusinessName) {
      await addConsignmentId(pendingSortConsignmentId, currentBusinessName);
    }
    pendingSortConsignmentId = null;
    state = 'IDLE';
    refocusCurrentInput();

    // Resume auto-flow if input has a value
    const inputConfigs = {
      consignment: { getInput: SEL.consignmentInput, requireConfirm: false },
      phone: { getInput: SEL.phoneInput, requireConfirm: true },
      merchant: { getInput: SEL.merchantOrderInput, requireConfirm: false },
    };
    const cfg = inputConfigs[mode];
    if (cfg) {
      const input = cfg.getInput();
      if (input && input.value.trim() && enabled) {
        onSearchInputChanged(mode, cfg.getInput, cfg.requireConfirm);
        return;
      }
    }
    showIdleStatus();
  }

  /**
   * Wait for a toast matching matchFn that arrived after sinceMark.
   *
   * @param {(lowerText: string) => boolean} matchFn
   * @param {number} sinceMark - lastToastAt captured BEFORE the action
   * @param {number} timeout - ms to wait
   * @returns {Promise<string|null>} toast text or null
   */
  function waitForToastSince(matchFn, sinceMark, timeout) {
    return waitFor(() => {
      const ev = lastToastEvents.find(
        (e) => e.at > sinceMark && matchFn(e.text.toLowerCase())
      );
      return ev ? ev.text : null;
    }, { interval: 100, timeout });
  }

  const isPrintSentToast = (t) => t.includes('sending to printer') || t.includes('pdf generated');
  const isSortToast = (t) => t.includes('sorted') && !t.includes('unsorted');
  const isWeightToast = (t) => t.includes('weight');

  // ============ STORAGE: Daily Reset + Consignment Tracking ============

  /** Get consignment tracking data from chrome.storage. */
  function getStorageData() {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) return resolve({ version: 2, lastReset: 0, businesses: {} });
      chrome.storage.local.get(['cbConsignments_v2'], (res) => {
        const data = res.cbConsignments_v2 || { version: 2, lastReset: 0, businesses: {} };
        resolve(data);
      });
    });
  }

  /** Persist consignment tracking data to chrome.storage. */
  function setStorageData(data) {
    return new Promise((resolve) => {
      if (!chrome?.storage?.local) return resolve();
      chrome.storage.local.set({ cbConsignments_v2: data }, resolve);
    });
  }

  /**
   * Check if daily reset threshold has been crossed (BDT timezone).
   * Clears all business data if current time >= reset hour and data hasn't been reset today.
   */
  /** Clear today's consignments if past the BDT reset threshold (shared.js math). */
  async function checkDailyReset() {
    if (settings.dailyResetEnabled === false) return;
    const resetMs = cbTodayResetMs(cbResolveResetMinutes(settings));

    const data = await getStorageData();
    if (Date.now() >= resetMs && data.lastReset < resetMs) {
      data.businesses = {};
      data.lastReset = resetMs;
      await setStorageData(data);
    }
  }

  /**
   * Record a sorted consignment ID for a business.
   * Moves duplicates to front (most recent first), enforces 1000-item limit.
   * @param {string} consignmentId
   * @param {string} businessName
   * @param {boolean} [batch=false] - If true, accumulate for batch flush instead of immediate write
   */
  async function addConsignmentId(consignmentId, businessName, batch = false) {
    if (batch) {
      pendingBatchConsignments.push({ id: consignmentId, name: businessName });
      return;
    }

    await checkDailyReset();
    const data = await getStorageData();
    if (!data.businesses[businessName]) data.businesses[businessName] = [];

    // Remove if exists (update timestamp)
    const idx = data.businesses[businessName].findIndex(x => x.id === consignmentId);
    if (idx >= 0) data.businesses[businessName].splice(idx, 1);

    // Add to front (most recent first)
    data.businesses[businessName].unshift({ id: consignmentId, at: Date.now() });

    // Enforce limit
    if (data.businesses[businessName].length > 1000) {
      data.businesses[businessName].length = 1000;
    }

    await setStorageData(data);

    // Notify popup
    chrome.runtime.sendMessage({
      type: 'CB_CONSIGNMENT_ADDED',
      businessName,
      consignmentId,
    }).catch(() => {});
  }

  /** Flush all batched consignment IDs to storage in one write. */
  async function flushBatchConsignments() {
    if (!pendingBatchConsignments.length) return;
    await checkDailyReset();
    const batch = pendingBatchConsignments.splice(0);
    const data = await getStorageData();

    for (const { id: consignmentId, name: businessName } of batch) {
      if (!data.businesses[businessName]) data.businesses[businessName] = [];
      const idx = data.businesses[businessName].findIndex(x => x.id === consignmentId);
      if (idx >= 0) data.businesses[businessName].splice(idx, 1);
      data.businesses[businessName].unshift({ id: consignmentId, at: Date.now() });
      if (data.businesses[businessName].length > 1000) {
        data.businesses[businessName].length = 1000;
      }
    }

    await setStorageData(data);
    chrome.runtime.sendMessage({ type: 'CB_CONSIGNMENT_ADDED' }).catch(() => {});
  }

  // ============ COD QUANTITY INPUT ============

  /** Create the COD quantity input + Process/Stop buttons if not already present. */
  function createCodQuantityInput() {
    const codInput = SEL.codInput();
    if (!codInput || !codInput.parentElement) return null;

    if (codQuantityInputEl && document.body.contains(codQuantityInputEl)) {
      return codQuantityInputEl;
    }

    if (!enabled || mode !== 'cod') return null;

    const container = document.createElement('div');
    container.id = 'cb-cod-quantity-container';
    container.innerHTML = `
      <input
        type="number"
        id="cb-cod-quantity-input"
        placeholder="Qty"
        min="1"
        max="200"
        value=""
      />
      <button id="cb-cod-quantity-btn">
        <span>Process</span>
        <span class="btn-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
        </span>
      </button>
      <button id="cb-cod-stop-btn" style="display:none;">Stop</button>
    `;

    const parent = codInput.parentElement;
    codInput.after(container);

    parent.style.display = 'flex';
    parent.style.alignItems = 'center';
    parent.style.gap = '8px';
    codInput.style.flex = '1';
    codInput.style.minWidth = '0';

    codQuantityInputEl = container.querySelector('#cb-cod-quantity-input');
    codStopButtonEl = container.querySelector('#cb-cod-stop-btn');
    wireCodQuantityInput();
    return codQuantityInputEl;
  }

  /** Attach event listeners to COD quantity input and buttons. */
  function wireCodQuantityInput() {
    const container = document.querySelector('#cb-cod-quantity-container');
    const input = container ? container.querySelector('#cb-cod-quantity-input') : null;
    if (!container || !input || container.dataset.cbWired) return;
    container.dataset.cbWired = '1';

    /** Validate COD qty input (1–200) and start batch. */
    function processQty() {
      const qty = parseInt(input.value, 10);
      if (isNaN(qty) || qty < 1) {
        setStatus('Min quantity is 1', 'error');
        input.value = '';
        input.focus();
        return;
      }
      if (qty > 200) {
        setStatus('Max quantity is 200', 'error');
        input.value = '';
        input.focus();
        return;
      }
      startCodBatch(qty);
    }

    container.addEventListener('click', (e) => {
      if (!e.target || !e.target.closest) return;
      if (e.target.closest('#cb-cod-quantity-btn')) {
        processQty();
      } else if (e.target.closest('#cb-cod-stop-btn')) {
        stopCodBatch();
      }
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') processQty();
    });
  }

  // ============ MODE MANAGEMENT ============
  /** Set processing mode and refresh idle badge. */
  function setMode(newMode) {
    mode = newMode;
    showIdleStatus();
  }

  /** User-initiated off (popup toggle / shortcut toggle): stop flows and hide UI. */
  function userDisable() {
    enabled = false;
    cycleToken++;
    state = 'IDLE';
    confirmResolve = null;
    confirmKeydownHandler = null;
    setCodProgress(null);
    hideCodQuantityInput();
    showIdleStatus();
  }

  // ============ ABORT CONTROLLER ============
  /** Create a new AbortController, aborting any previous one. */
  function createAbortController() {
    currentAbortController?.abort();
    currentAbortController = new AbortController();
    return currentAbortController.signal;
  }

  // ============ ERROR HANDLING HELPER ============

  /**
   * Show error status, wait, then reset to IDLE if token is still valid.
   * Replaces the repeated error→sleep→reset pattern.
   *
   * @param {string} msg - Error message to display
   * @param {number} ms - How long to show the error
   * @param {number} myToken - Current cycle token for staleness check
   */
  async function showErrorAndWait(msg, ms, myToken) {
    setStatus(msg, 'error');
    await sleep(ms);
    if (myToken === cycleToken) {
      state = 'IDLE';
      showIdleStatus();
    }
  }

  // ============ SEARCH INPUT HANDLER ============

  /**
   * Unified handler for search-type modes (merchant, consignment, phone).
   * Waits for exactly 1 row, then runs the full cycle.
   *
   * @param {string} modeName - Mode identifier
   * @param {Function} getInput - Function returning the search input element
   * @param {boolean} [requireConfirm=false] - If true, pauses for Enter confirmation (phone mode)
   */
  async function onSearchInputChanged(modeName, getInput, requireConfirm = false) {
    if (!enabled || mode !== modeName || state !== 'IDLE') return;

    const input = getInput();
    if (!input || !input.value.trim()) return;

    const myToken = ++cycleToken;
    const signal = createAbortController();
    clearCycleCache();
    state = 'WAITING_ROWS';

    try {
      // Wait for exactly 1 row — stable-count (React renders rows instantly)
      let result = null;
      let stableCount = -1;
      let stableSince = 0;
      const start = Date.now();
      for (;;) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const rowsNow = getRows();
        if (rowsNow.length === 1) {
          result = rowsNow;
          break;
        }
        const now = Date.now();
        if (rowsNow.length !== stableCount) {
          stableCount = rowsNow.length;
          stableSince = now;
        }
        if (now - stableSince >= CFG.rowStableMs || now - start >= CFG.rowPollHardMaxMs) break;
        await sleep(CFG.rowPollIntervalMs);
      }

      if (myToken !== cycleToken) return;

      if (!result) {
        const rows = getRows();
        if (rows.length === 0) {
          setStatus('No parcel found', 'error');
        } else {
          setStatus('Multiple parcels found', 'error');
        }
        await sleep(500);
        if (myToken === cycleToken) {
          state = 'IDLE';
        }
        return;
      }

      // Phone mode (typed only): settle typing, validate digits, confirm with Enter
      if (requireConfirm) {
        // Settle wait — judge only after typing pauses (no false mismatch mid-type).
        // Enter during wait (or within phoneEnterRememberMs) counts as confirm intent.
        let enterPressed = (Date.now() - lastEnterAt) < CFG.phoneEnterRememberMs;
        const settleKeydown = (e) => {
          if (e.key === 'Enter') enterPressed = true;
        };
        input.addEventListener('keydown', settleKeydown);
        try {
          let lastVal = input.value;
          let stableAt = Date.now();
          const settleStart = Date.now();
          while (!enterPressed) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            if (myToken !== cycleToken) return;
            const v = input.value;
            if (v !== lastVal) {
              lastVal = v;
              stableAt = Date.now();
            }
            if (Date.now() - stableAt >= CFG.phoneSettleMs ||
                Date.now() - settleStart >= CFG.phoneSettleMaxMs) break;
            await sleep(100);
          }
        } finally {
          input.removeEventListener('keydown', settleKeydown);
        }

        if (myToken !== cycleToken) return;

        // Validate ending digits match parcel phone (typed value, after settle)
        const row = result[0];
        const phoneDiv = row.querySelectorAll(':scope > div')[2];
        const phoneText = (phoneDiv?.textContent || '').trim();
        const typedDigits = input.value.trim().replace(/\D/g, '');

        if (typedDigits && phoneText && !phoneText.endsWith(typedDigits)) {
          setStatus('Phone number mismatch', 'error');
          await sleep(CFG.mismatchBadgeMs);
          if (myToken === cycleToken) {
            state = 'IDLE';
            showIdleStatus();
          }
          return;
        }

        // Enter already given (during/just before settle) + match → skip confirm pause
        if (!enterPressed) {
          state = 'PHONE_CONFIRM';
          setStatus('Parcel found — press Enter', 'wait-input');

          await new Promise((resolve, reject) => {
            const onAbort = () => {
              input.removeEventListener('keydown', confirmEnterHandler);
              reject(new DOMException('Aborted', 'AbortError'));
            };
            signal.addEventListener('abort', onAbort, { once: true });

            /** Enter key = confirm selected phone row. */
            function confirmEnterHandler(e) {
              if (e.key === 'Enter') {
                signal.removeEventListener('abort', onAbort);
                input.removeEventListener('keydown', confirmEnterHandler);
                confirmKeydownHandler = null;
                confirmResolve = null;
                resolve();
              }
            }
            confirmResolve = resolve;
            confirmKeydownHandler = confirmEnterHandler;
            input.addEventListener('keydown', confirmEnterHandler);
          });

          if (myToken !== cycleToken) return;
        }
      }

      currentBusinessName = getBusinessName();
      await runFullCycle(result[0], myToken, !settings.skipWeight);
    } catch (e) {
      if (e.name !== 'AbortError') console.error('[CarryBee]', e);
    }
  }

  // ============ REFOCUS HELPER ============

  /** Refocus and select the current mode's input field. */
  /**
   * Focus + select the current mode's input field.
   * @returns {boolean} true if input found and focused
   */
  function refocusCurrentInput() {
    if (!mode) return false;
    let input;
    if (mode === 'merchant') input = SEL.merchantOrderInput();
    else if (mode === 'phone') input = SEL.phoneInput();
    else if (mode === 'consignment') input = SEL.consignmentInput();
    else if (mode === 'cod') input = SEL.codInput();

    if (input) {
      input.focus();
      input.select();
      return true;
    }
    return false;
  }

  // ============ RESET STATE ============

  /** Cancel in-flight operations and reset to IDLE when user starts typing. */
  function resetStateForNewInput() {
    currentAbortController?.abort();
    currentAbortController = null;
    pendingSortConsignmentId = null;
    lastClickedRowId = null;

    // Close weight editor — find X button next to the weight input
    const weightInput = document.querySelector(SEL.weightInput);
    if (weightInput) {
      const closeBtn = weightInput.parentElement?.querySelector('svg.lucide-x');
      if (closeBtn) {
        closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    }

    if (confirmKeydownHandler) {
      const input = SEL.phoneInput();
      input?.removeEventListener('keydown', confirmKeydownHandler);
      confirmKeydownHandler = null;
    }
    if (confirmResolve) {
      const r = confirmResolve;
      confirmResolve = null;
      r();
    }
    if (state !== 'IDLE') {
      cycleToken++;
      state = 'IDLE';
    }
    showIdleStatus();
  }

  // ============ COD QUANTITY MODE ============

  /** Stop the current COD batch processing. */
  async function stopCodBatch() {
    cycleToken++;
    await flushBatchConsignments();
    hideCodQuantityInput();
    setStatus(`Stopped — ${codQuantityCounter}/${codQuantityTarget} sorted`, 'error');
    setCodProgress(null);
    await sleep(2500);
    state = 'IDLE';
    showCodQuantityInput();
    const codInput = SEL.codInput();
    if (codInput) codInput.focus();
  }

  /** Start a COD batch with the given quantity. */
  async function startCodBatch(qty) {
    if (!enabled || mode !== 'cod' || state !== 'IDLE') return;

    const myToken = ++cycleToken;
    clearCycleCache();
    codQuantityCounter = 0;
    codQuantityTarget = qty;
    currentBusinessName = getBusinessName();

    const input = createCodQuantityInput();
    if (!input) return;
    if (codStopButtonEl) codStopButtonEl.style.display = 'block';

    await runCodBatch(myToken);
  }

  /** Main COD batch loop: print → sort each row until target reached. */
  async function runCodBatch(myToken) {
    while (codQuantityCounter < codQuantityTarget && myToken === cycleToken) {
      clearCycleCache();
      state = 'PROCESSING';

      // Wait for the table to settle after the previous row was sorted/removed
      const row = await waitFor(() => {
        const rows = getRows();
        const first = rows[0];
        if (!first) return null;
        if (!findActionButton(first, 'lucide-printer')) return null;
        return first;
      }, { interval: 200, timeout: 1000 });

      if (myToken !== cycleToken) return;

      if (!row) {
        // No more rows — flush batched consignment IDs
        await flushBatchConsignments();
        setCodProgress(null);
        if (codQuantityCounter > 0) {
          setStatus(`✓ ${codQuantityCounter} parcels sorted`, 'success');
          await sleep(CFG.badgeDisplayMs);
        } else {
          setStatus('No more rows', 'error');
          await sleep(2000);
        }
        if (myToken === cycleToken) {
          state = 'IDLE';
          showCodQuantityInput();
          const codInput = SEL.codInput();
          if (codInput) codInput.focus();
        }
        return;
      }

      setCodProgress(`Processing ${codQuantityCounter + 1}/${codQuantityTarget}`);

      const consignmentId = getConsignmentIdFromRow(row);

      const result = await printThenSort(row, myToken);
      if (myToken !== cycleToken) return;

      if (!result.ok) {
        await flushBatchConsignments();
        setCodProgress(null);
        await sleep(2500);
        if (myToken === cycleToken) {
          state = 'IDLE';
          showCodQuantityInput();
          const codInput = SEL.codInput();
          if (codInput) codInput.focus();
        }
        return;
      }

      // Wait for row to disappear (skip if stuck/unverified — row may stay)
      if (!result.unverified) {
        await waitFor(() => !document.body.contains(row), { timeout: 2000 });
        if (myToken !== cycleToken) return;
      }

      // Store consignment ID after successful sort (batched)
      if (consignmentId) {
        await addConsignmentId(consignmentId, currentBusinessName, true);
      }

      codQuantityCounter++;
    }

    // Flush any remaining batched consignment IDs
    await flushBatchConsignments();

    if (myToken === cycleToken) {
      setCodProgress(`✓ ${codQuantityCounter} sorted`);
      setStatus('✓ Done', 'success');
      await sleep(CFG.badgeDisplayMs);
      setCodProgress(null);
      state = 'IDLE';
      showCodQuantityInput();
      const codInput = SEL.codInput();
      if (codInput) codInput.focus();
    }
  }

  // ============ PRINT + SORT HELPER ============

  /**
   * Click print, wait for toast, click sort, wait for toast.
   * Shared between runFullCycle and runCodBatch.
   *
   * @param {Element} row - The order row element
   * @param {number} myToken - Cycle token for staleness check
   * @returns {Promise<{ok: boolean, reason?: string}>}
   */
  async function printThenSort(row, myToken) {
    // ---- Print ----
    state = 'PRINTING';

    const printSinceMark = lastToastAt;
    const printBtn = findActionButton(row, 'lucide-printer');
    setStatus('Printing...', 'working');
    printBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const printToast = await waitForToastSince(isPrintSentToast, printSinceMark, CFG.printToastTimeoutMs);
    if (myToken !== cycleToken) return { ok: false, reason: 'stopped' };

    if (!printToast) {
      setStatus('Print failed', 'error');
      await sleep(1000);
      return { ok: false, reason: 'print-timeout' };
    }

    // ---- Sort ----
    state = 'SORTING';

    const sortSinceMark = lastToastAt;
    const sortBtn = findActionButton(row, 'lucide-arrow-down-wide-narrow');
    setStatus('Sorting...', 'working');
    sortBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Poll for sort completion: toast OR row removed (deadline in CFG)
    const DEADLINE = Date.now() + CFG.sortDeadlineMs;
    let sortToast = null;
    let rowRemoved = false;
    while (!sortToast && Date.now() < DEADLINE) {
      if (myToken !== cycleToken) return { ok: false, reason: 'stopped' };
      sortToast = await waitForToastSince(isSortToast, sortSinceMark, CFG.sortPollMs);
      if (sortToast) break;
      // Row removed from DOM = sorted (even without toast)
      if (!document.body.contains(row)) {
        rowRemoved = true;
        break;
      }
      // Sort button replaced by spinner = still loading, keep waiting
      const stillLoading = !findActionButton(row, 'lucide-arrow-down-wide-narrow');
      if (!stillLoading) break;
    }

    if (rowRemoved) return { ok: true };

    // Row still present — grace wait for toast
    if (!sortToast) {
      sortToast = await waitForToastSince(isSortToast, sortSinceMark, CFG.sortGraceTimeoutMs);
    }

    if (!sortToast) {
      // Stuck loading — show badge, but caller tracks consignment as sorted
      setStatus('Sort failed', 'error');
      await sleep(1000);
      return { ok: true, unverified: true };
    }

    return { ok: true };
  }

  // ============ CORE CYCLE ============

  /**
   * Full processing cycle: weight edit → print → sort.
   * Used by merchant, consignment, and phone modes.
   *
   * @param {Element} row - The order row element
   * @param {number} myToken - Cycle token for staleness check
   * @param {boolean} includeWeight - Whether to prompt for weight entry
   */
  async function runFullCycle(row, myToken, includeWeight) {
    const consignmentId = getConsignmentIdFromRow(row);

    // ---- Weight Edit ----
    if (includeWeight) {
      state = 'WEIGHT_EDIT';

      let weightInput = findWeightNumberInput(row);
      if (!weightInput) {
        // Editor not open yet — click pencil to open
        const pencil = findWeightIcon(row);
        if (!pencil) {
          await showErrorAndWait('✗ Failed', 2000, myToken);
          return;
        }

        pencil.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        weightInput = await waitFor(() => findWeightNumberInput(row), {
          interval: 100,
          timeout: CFG.weightInputWaitMs,
        });
        if (myToken !== cycleToken) return;
      }

      if (!weightInput) {
        await showErrorAndWait('✗ Failed', 2000, myToken);
        return;
      }

      weightInput.focus();
      weightInput.select();
      const originalWeightValue = (weightInput.value || '').trim();
      pendingSortConsignmentId = consignmentId;
      state = 'WEIGHT_ENTRY';
      setStatus('Enter weight', 'wait-input');

      const weightSinceMark = lastToastAt;

      // Wait for Enter — with AbortController support
      await new Promise((resolve, reject) => {
        const onAbort = () => {
          weightInput.removeEventListener('keydown', weightEnterHandler);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        currentAbortController?.signal?.addEventListener('abort', onAbort, { once: true });

        /** Enter key = submit weight value. */
        function weightEnterHandler(e) {
          if (e.key === 'Enter') {
            currentAbortController?.signal?.removeEventListener('abort', onAbort);
            weightInput.removeEventListener('keydown', weightEnterHandler);
            resolve();
          }
        }
        weightInput.addEventListener('keydown', weightEnterHandler);
      });
      if (myToken !== cycleToken) return;

      const finalWeightValue = (weightInput.value || '').trim();
      const weightWasChanged = finalWeightValue !== originalWeightValue;

      if (weightWasChanged) {
        const weightToast = await waitForToastSince(isWeightToast, weightSinceMark, CFG.weightToastTimeoutMs);
        if (myToken !== cycleToken) return;
        if (!weightToast) {
          setStatus('Weight update failed', 'error');
          await sleep(1500);
          if (myToken !== cycleToken) return;
          return;
        }
      }
    }

    // ---- Print + Sort (shared helper) ----
    const result = await printThenSort(row, myToken);
    if (myToken !== cycleToken) return;

    if (!result.ok) {
      await showErrorAndWait(`✗ ${result.reason}`, 2500, myToken);
      return;
    }

    // ---- Store consignment ID ----
    if (consignmentId) {
      await addConsignmentId(consignmentId, currentBusinessName, false);
    }
    if (myToken !== cycleToken) return;

    if (result.unverified) {
      // "Sort failed" badge already shown — tracked as sorted, keep badge visible
      state = 'IDLE';
      refocusCurrentInput();
      return;
    }

    setStatus('✓ Done', 'success');
    state = 'IDLE';

    // Refocus + select field right after sort
    refocusCurrentInput();
    showIdleStatus();
  }

  // ============ INPUT LISTENERS ============

  /**
   * Attach input/keydown listeners to search inputs.
   * Uses dataset.cbWired to prevent double-wiring.
   */
  function attachInputListeners() {
    const inputConfigs = [
      { getInput: () => SEL.merchantOrderInput(), handler: () => onSearchInputChanged('merchant', SEL.merchantOrderInput) },
      { getInput: () => SEL.phoneInput(), handler: () => onSearchInputChanged('phone', SEL.phoneInput, true) },
      { getInput: () => SEL.consignmentInput(), handler: () => onSearchInputChanged('consignment', SEL.consignmentInput) },
    ];

    for (const { getInput, handler } of inputConfigs) {
      const input = getInput();
      if (input && !input.dataset.cbWired) {
        input.dataset.cbWired = '1';
        input.addEventListener('input', () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          resetStateForNewInput();
          debounceTimer = setTimeout(handler, CFG.debounceMs);
        });
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            lastEnterAt = Date.now();
          }
        });

        // Wire the gray X icon that clears the input
        const clearIcon = input.parentElement?.querySelector('svg.lucide-x');
        if (clearIcon && !clearIcon.dataset.cbWired) {
          clearIcon.dataset.cbWired = '1';
          clearIcon.addEventListener('click', () => {
            resetStateForNewInput();
          });
        }
      }
    }

    createCodQuantityInput();
  }

  // ============ KEYBOARD SHORTCUTS ============

  /** Manifest command name → mode. */
  const COMMAND_TO_MODE = {
    'set-consignment-mode': 'consignment',
    'set-phone-mode': 'phone',
    'set-merchant-mode': 'merchant',
    'set-cod-mode': 'cod',
  };

  /**
   * Handle commands from background.js (keyboard shortcuts).
   * Toggle semantics: pressing the ACTIVE mode's shortcut turns the extension OFF;
   * any other shortcut switches mode (or turns ON if off).
   */
  function handleCommand(command) {
    if (!isProcessingPage()) return;
    const target = COMMAND_TO_MODE[command];
    if (!target) return;

    if (enabled && mode === target) {
      userDisable();
      return;
    }

    enabled = true;
    setMode(target);
    if (target === 'cod') {
      showCodQuantityInput();
      const codInput = SEL.codInput();
      if (codInput) codInput.focus();
    } else {
      refocusCurrentInput();
    }
  }

  // ============ RUNTIME MESSAGES ============

  /** Listen for messages from popup and background scripts. */
  function wireRuntimeMessages() {
    if (!chrome?.runtime?.onMessage) return;
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'CB_GET_STATE') {
        sendResponse({ enabled, mode });
      } else if (msg.type === 'CB_SET_STATE') {
        const next = !!msg.enabled;
        const newMode = msg.mode || null;

        if (next && !isProcessingPage()) {
          sendResponse({ enabled: false, mode: null });
          return;
        }

        if (!next) {
          userDisable();
        } else if (next && newMode) {
          enabled = true;
          setMode(newMode);
          if (newMode === 'cod') {
            showCodQuantityInput();
            const codInput = SEL.codInput();
            if (codInput) codInput.focus();
          } else {
            refocusCurrentInput();
          }
        } else if (next && !newMode) {
          // Toggle ON without mode — just enable, show "Choose mode"
          enabled = true;
          setStatus('Pick a mode', 'info');
        }

        sendResponse({ enabled, mode });
      } else if (msg.type === 'CB_POPUP_CLOSED') {
        if (enabled && state === 'IDLE') {
          refocusCurrentInput();
        }
        sendResponse({});
      } else if (msg.type === 'CB_COMMAND') {
        handleCommand(msg.command);
        sendResponse({ enabled, mode });
      }
    });
  }

  // ============ INIT ============

  /** Listen for settings changes from options page. */
  function wireSettingsListener() {
    if (!chrome?.storage?.onChanged) return;
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[SETTINGS_KEY]) {
        settings = { ...settings, ...(changes[SETTINGS_KEY].newValue || {}) };
      }
    });
  }

  // ============ URL-BASED AUTO-DISABLE (SPA NAVIGATION) ============

  /** True only on exact order-processing / sub-sort path segments (no query/hash false positives). */
  function isProcessingPage() {
    const p = location.pathname;
    return p === '/order-processing' || p.startsWith('/order-processing/') ||
           p === '/sub-sort' || p.startsWith('/sub-sort/');
  }

  /** Turn extension off: bump cycle token, abort flows, hide badges. */
  function disableExtension() {
    enabled = false;
    mode = null;
    cycleToken++;
    state = 'IDLE';
    currentAbortController?.abort();
    currentAbortController = null;
    pendingSortConsignmentId = null;
    confirmResolve = null;
    if (confirmKeydownHandler) {
      const input = SEL.phoneInput();
      input?.removeEventListener('keydown', confirmKeydownHandler);
      confirmKeydownHandler = null;
    }
    setCodProgress(null);
    hideCodQuantityInput();
    hideBadge();
  }

  /** React to SPA navigation: show idle status on processing page, else disable. */
  function onUrlChange() {
    if (isProcessingPage()) {
      showIdleStatus();
    } else {
      disableExtension();
    }
  }

  /** Monkey-patch pushState/replaceState + hashchange + setInterval fallback. */
  function wireUrlWatcher() {
    const origPush = history.pushState;
    const origReplace = history.replaceState;

    history.pushState = function (...args) {
      origPush.apply(this, args);
      onUrlChange();
    };
    history.replaceState = function (...args) {
      origReplace.apply(this, args);
      onUrlChange();
    };

    window.addEventListener('popstate', onUrlChange);
    window.addEventListener('hashchange', onUrlChange);

    // Fallback: poll URL every 1s for React routing that bypasses pushState
    let lastCheckedUrl = location.href;
    setInterval(() => {
      if (location.href !== lastCheckedUrl) {
        lastCheckedUrl = location.href;
        onUrlChange();
      }
    }, 1000);
  }

  /** Initialize the extension on page load. */
  /** Always-on click listener: capture row ID when Sort button is clicked. */
  function wireSortButtonTracker() {
    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const icon = btn.querySelector('svg.lucide-arrow-down-wide-narrow');
      if (!icon) return;
      const row = btn.closest(SEL.row);
      if (!row) return;
      lastClickedRowId = row.getAttribute('data-order-id');
    }, true);
  }

  /** Bootstrap: settings → URL watcher → observers → listeners. */
  async function init() {
    try {
      await loadSettings();
      wireUrlWatcher();
      onUrlChange();
      await checkDailyReset();

      watchDom();
      attachInputListeners();
      wireRuntimeMessages();
      wireSettingsListener();
      wireSortButtonTracker();

      // Signal ready to popup
      chrome.runtime.sendMessage({ type: 'CB_CONTENT_READY', url: location.href }).catch(() => {});
    } catch (e) {
      console.error('[CarryBee] Init failed:', e);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
