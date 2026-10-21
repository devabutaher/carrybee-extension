// CarryBee Check Entry — Popup Window Script

(() => {
  'use strict';

  // ── Debug logging (shows up in the panel's DevTools console) ──
  const dbg = (...args) => console.debug('[CE panel]', ...args);

  const CARRYBEE_URL = 'https://hive.carrybee.com/order-processing';

  // ── DOM Elements ──
  const pageStatus = document.getElementById('pageStatus');
  const openPageSection = document.getElementById('openPageSection');
  const openPageLink = document.getElementById('openPageLink');
  const inputBusiness = document.getElementById('input-business');
  const inputConsignment = document.getElementById('input-consignment');
  const inputPhone = document.getElementById('input-phone');
  const checkBtn = document.getElementById('checkBtn');
  const resultSection = document.getElementById('resultSection');
  const resultContent = document.getElementById('resultContent');
  const placeholderSection = document.getElementById('placeholderSection');

  // ── Timing constants ──
  const NAV_TIMEOUT = 15000; // wait for a navigation target to become ready
  const PING_RETRIES = 8; // readiness pings when re-detecting the tab
  const PING_INTERVAL = 300;
  const MAX_SEND_RETRIES = 3; // auto-retries after "not responding"
  const MAX_HOPS = 6; // max list↔store navigation steps per check

  // ── State ──
  let isChecking = false;
  let carryBeeTabId = null;
  let pageType = 'other';
  let lastPayload = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const now = () => Date.now();

  // ── Initialize ──
  function init() {
    [inputBusiness, inputConsignment, inputPhone].forEach((input) => {
      input.addEventListener('input', updateButtonState);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !checkBtn.disabled) handleCheck();
      });
    });

    checkBtn.addEventListener('click', handleCheck);

    openPageLink.addEventListener('click', () => {
      chrome.tabs.create({ url: CARRYBEE_URL }, () => {
        // ignoring lastError: tab creation is best-effort
        chrome.runtime.lastError;
      });
      // tabs.onUpdated picks the new tab up and flips the status to ready
    });

    findCarryBeeTab();
  }

  function updateButtonState() {
    const hasBusiness = inputBusiness.value.trim().length > 0;
    const hasParcel =
      inputConsignment.value.trim().length > 0 || inputPhone.value.trim().length > 0;

    checkBtn.disabled = isChecking || !hasBusiness || !hasParcel || !carryBeeTabId;
  }

  // ── CarryBee tab helpers ──
  function isCarryBeeUrl(url) {
    try {
      const u = new URL(url);
      return u.hostname === 'hive.carrybee.com' && u.pathname.startsWith('/order-processing');
    } catch {
      return false;
    }
  }

  function isStoreUrl(url) {
    try {
      return new URL(url).pathname.startsWith('/order-processing/store/');
    } catch {
      return false;
    }
  }

  function sendToTab(tabId, message) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
          } else if (!response) {
            resolve({ ok: false, error: 'No response from CarryBee tab' });
          } else {
            resolve({ ok: true, response });
          }
        });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
  }

  function getTab(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) resolve(null);
        else resolve(tab);
      });
    });
  }

  // Single readiness ping. Content replies {page, ready} — `ready` means React
  // has rendered the input the page needs, verified from inside the page
  // instead of guessed from tab.status / URL timing.
  async function pingOnce(tabId) {
    const r = await sendToTab(tabId, { type: 'CE_PAGE_TYPE' });
    if (r.ok && r.response && r.response.page) return r.response;
    return null;
  }

  // Retrying ping — for the ambiguous "tab may be re-injecting" case.
  async function pingContent(tabId) {
    for (let i = 0; i < PING_RETRIES; i++) {
      const response = await pingOnce(tabId);
      if (response) return response;
      await sleep(PING_INTERVAL);
    }
    return null;
  }

  // ── Find CarryBee tab ──
  function findCarryBeeTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ url: '*://hive.carrybee.com/order-processing*' }, async (tabs) => {
        if (tabs.length === 0) {
          carryBeeTabId = null;
          setPageStatus('error', 'Open hive.carrybee.com/order-processing in a tab');
          updateButtonState();
          resolve(null);
          return;
        }

        const tabId = tabs[0].id;
        const response = await pingContent(tabId);

        if (!response) {
          setPageStatus('error', 'Refresh the CarryBee tab (F5)');
          carryBeeTabId = null;
          updateButtonState();
          resolve(null);
          return;
        }

        carryBeeTabId = tabId;
        pageType = response.page;

        if (pageType === 'list') {
          setPageStatus('ready', 'CarryBee tab ready (list page)');
        } else if (pageType === 'store') {
          setPageStatus('ready', 'CarryBee tab ready (store page)');
        } else {
          setPageStatus('error', 'CarryBee tab not on Order Processing page');
          carryBeeTabId = null;
        }

        updateButtonState();
        resolve(carryBeeTabId);
      });
    });
  }

  function setPageStatus(status, text) {
    pageStatus.textContent = text;
    pageStatus.className = 'page-status';
    if (status === 'ready') pageStatus.classList.add('ready');
    if (status === 'error') {
      pageStatus.classList.add('error');
      // Not ready for checks → offer a one-click way to open the right page
      openPageSection.classList.remove('hidden');
    } else {
      openPageSection.classList.add('hidden');
    }
  }

  // ── Wait until the tab reaches the target page AND the content script
  // confirms the page is actually ready (input rendered, document loaded).
  // A real document load shows tab.status !== 'complete'; a client-side
  // (Next.js) navigation passes straight to the content-ping gate.
  async function waitForReady(tabId, target) {
    const start = now();
    while (now() - start < NAV_TIMEOUT) {
      const tab = await getTab(tabId);
      if (!tab || !tab.url) return false;

      if (isCarryBeeUrl(tab.url)) {
        const onStore = isStoreUrl(tab.url);
        const urlOk = target === 'store' ? onStore : !onStore;
        const loaded = !tab.status || tab.status === 'complete';

        if (urlOk && loaded) {
          const response = await pingOnce(tabId);
          if (response && response.page === target && response.ready) {
            dbg(`target '${target}' ready in ${now() - start}ms`);
            return true;
          }
        }
      }
      await sleep(150);
    }
    dbg(`target '${target}' NOT ready within ${NAV_TIMEOUT}ms`);
    return false;
  }

  // After a failed send: wait for the tab to finish loading, then confirm via
  // the content ping (the ping itself is the readiness gate — no fixed grace).
  async function waitTabReady(tabId) {
    const start = now();
    while (now() - start < NAV_TIMEOUT) {
      const tab = await getTab(tabId);
      if (!tab) return false;
      if (!tab.status || tab.status === 'complete') {
        const response = await pingOnce(tabId);
        if (response && response.ready) return true;
      }
      await sleep(200);
    }
    return false;
  }

  // ── Check Entry ──
  async function handleCheck() {
    if (isChecking) return;

    if (!carryBeeTabId) {
      await findCarryBeeTab();
      if (!carryBeeTabId) {
        showError('No CarryBee tab found. Open hive.carrybee.com/order-processing and retry.');
        return;
      }
    }

    const payload = {
      businessName: inputBusiness.value.trim(),
      consignmentId: inputConsignment.value.trim(),
      phone: inputPhone.value.trim(),
    };

    if (!payload.businessName) return;
    if (!payload.consignmentId && !payload.phone) return;

    lastPayload = payload;
    isChecking = true;
    checkBtn.disabled = true;
    checkBtn.textContent = 'Searching...';
    checkBtn.classList.add('loading');

    showLoading('Looking for your parcel in CarryBee tab...');
    const checkStart = now();

    try {
      const result = await runCheck(carryBeeTabId, payload);
      dbg(`check finished in ${now() - checkStart}ms →`, result.status);
      handleResult(result);
    } catch (err) {
      showError(err.message || 'Unknown error');
    } finally {
      resetButton();
      // If a navigation/ping race cleared the tab id, re-establish it
      if (!carryBeeTabId) findCarryBeeTab();
    }
  }

  // Drives the content-script state machine across navigations:
  // send → navigating? wait until ready → send again → final result
  async function runCheck(tabId, payload) {
    let hops = 0;
    let sendFailures = 0;
    let navPingFailures = 0;

    while (hops <= MAX_HOPS) {
      const sent = await sendToTab(tabId, { type: 'CE_CHECK_ENTRY', payload });

      if (!sent.ok) {
        sendFailures++;
        if (sendFailures > MAX_SEND_RETRIES) {
          throw new Error('CarryBee tab not responding. Refresh that tab. (' + sent.error + ')');
        }
        setLoadingText('Reconnecting to CarryBee tab...');
        await waitTabReady(tabId); // wait for load + readiness ping
        continue;
      }

      sendFailures = 0;
      const result = sent.response;

      if (result.status === 'navigating') {
        hops++;
        setLoadingText(
          result.target === 'store'
            ? 'Opening business store page...'
            : 'Back to order list...'
        );

        const readyInTime = await waitForReady(tabId, result.target);
        if (!readyInTime) {
          throw new Error('Navigation did not complete. Check the CarryBee tab and retry.');
        }
        navPingFailures = 0;
        continue;
      }

      return result;
    }

    throw new Error('Too many navigation steps. Please retry.');
  }

  function resetButton() {
    isChecking = false;
    checkBtn.textContent = 'Check Entry';
    checkBtn.classList.remove('loading');
    updateButtonState();
  }

  // ── Result Display ──
  function showLoading(step) {
    placeholderSection.classList.add('hidden');
    resultSection.classList.remove('hidden');
    resultContent.className = 'result-content result-loading';
    resultContent.innerHTML =
      '<div class="result-title"><span class="spinner"></span>Searching...</div>' +
      '<div class="result-detail" id="loadingDetail">' + escapeHtml(step) + '</div>';
  }

  function setLoadingText(text) {
    const el = document.getElementById('loadingDetail');
    if (el) el.textContent = text;
  }

  function showError(message) {
    placeholderSection.classList.add('hidden');
    resultSection.classList.remove('hidden');
    resultContent.className = 'result-content result-error';
    resultContent.innerHTML =
      '<div class="result-title"><span class="result-icon">✗</span>Error</div>' +
      '<div class="result-detail">' + escapeHtml(message) + '</div>' +
      '<div class="result-row"><button class="retry-btn" id="retryBtn">Retry</button></div>';

    // Errors often mean the CarryBee tab is missing/wrong — keep the open-page
    // link visible so the user can fix it in one click.
    openPageSection.classList.remove('hidden');

    const retryBtn = document.getElementById('retryBtn');
    if (retryBtn) {
      retryBtn.addEventListener('click', handleCheck);
    }
  }

  function handleResult(result) {
    placeholderSection.classList.add('hidden');
    resultSection.classList.remove('hidden');

    switch (result.status) {
      case 'found':
        showFound(result.consignmentId);
        break;
      case 'not_found':
        showNotFound();
        break;
      case 'business_not_found':
        showBusinessNotFound();
        break;
      case 'multiple_business':
        showMultipleBusiness(result.count);
        break;
      case 'multiple_entries':
        showMultipleEntries();
        break;
      case 'error':
        showError(result.error || 'Unknown error');
        break;
      default:
        showError('Unexpected response');
    }
  }

  function showFound(consignmentId) {
    resultContent.className = 'result-content result-found';
    resultContent.innerHTML =
      '<div class="result-title"><span class="result-icon">✓</span>Entry Found</div>' +
      '<div class="result-row">' +
        (consignmentId
          ? '<span class="result-consignment" id="copyBtn" title="Click to copy">' + escapeHtml(consignmentId) + '</span>'
          : '<span></span>') +
        '<button class="view-btn" id="viewBtn">Open Tab</button>' +
      '</div>';

    // Copy consignment ID on click
    const copyBtn = document.getElementById('copyBtn');
    if (copyBtn && consignmentId) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(consignmentId).then(() => {
          copyBtn.classList.add('copied');
          copyBtn.textContent = 'Copied!';
          setTimeout(() => {
            copyBtn.classList.remove('copied');
            copyBtn.textContent = consignmentId;
          }, 1500);
        });
      });
    }

    // Open existing CarryBee tab
    const viewBtn = document.getElementById('viewBtn');
    if (viewBtn) {
      viewBtn.addEventListener('click', () => {
        chrome.tabs.update(carryBeeTabId, { active: true });
      });
    }
  }

  function showNotFound() {
    resultContent.className = 'result-content result-not-found';
    resultContent.innerHTML =
      '<div class="result-title"><span class="result-icon">✗</span>No Entry Found</div>' +
      '<div class="result-detail">No parcel matches your search.</div>';
  }

  function showBusinessNotFound() {
    resultContent.className = 'result-content result-not-found';
    resultContent.innerHTML =
      '<div class="result-title"><span class="result-icon">✗</span>Business Not Found</div>' +
      '<div class="result-detail">No business matches your search. Check the name and try again.</div>';
  }

  function showMultipleBusiness(count) {
    resultContent.className = 'result-content result-multiple';
    resultContent.innerHTML =
      '<div class="result-title"><span class="result-icon">⚠</span>Multiple Businesses Found</div>' +
      '<div class="result-detail">' +
      count +
      ' businesses match. Please be more specific.</div>';
  }

  function showMultipleEntries() {
    resultContent.className = 'result-content result-multiple';
    resultContent.innerHTML =
      '<div class="result-title"><span class="result-icon">⚠</span>Multiple Entries Found</div>' +
      '<div class="result-detail">Multiple parcels match your search.</div>';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Keyboard shortcut (Alt+Q): fill Business Name from clipboard ──
  // The popup window question-of-focus: when the WINDOW holds OS focus the
  // document read works; when it doesn't (e.g. user mid-Sheet), background
  // reads elsewhere and sends CE_FILL_BUSINESS.
  // After the business name lands, caret goes to the PHONE input so the
  // user can type the number and press Enter — completely mouse-free.
  async function fillBusinessFromClipboard() {
    try {
      window.focus();
    } catch {
      /* ignore */
    }

    let text = '';
    try {
      text = (await navigator.clipboard.readText()) || '';
    } catch {
      // window didn't have focus → background's other readers take over
    }

    inputBusiness.focus();
    if (text.trim()) {
      inputBusiness.value = text.trim();
    }
    inputBusiness.select();
    if (text.trim()) {
      inputPhone.focus(); // caret ready for the parcel number
    }
    updateButtonState();
    return !!text.trim();
  }

  // Fill directly from text provided by the background's offscreen reader.
  function fillBusinessFromText(text) {
    try {
      window.focus();
    } catch {
      /* ignore */
    }
    inputBusiness.value = text.trim();
    inputPhone.focus(); // caret ready for the parcel number
    updateButtonState();
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Alt+Q path: the panel (attempt to) read the clipboard itself.
    if (msg && msg.type === 'CE_FOCUS_INPUT') {
      fillBusinessFromClipboard().then(sendResponse);
      return true; // async — true = filled here, false = needs offscreen help
    }
    // Alt+Q fallback: the background read the clipboard elsewhere.
    if (msg && msg.type === 'CE_FILL_BUSINESS' && msg.text && msg.text.trim()) {
      fillBusinessFromText(msg.text);
      sendResponse(true);
      return;
    }
    // Auto-run path (Alt+W): the number came from the Sheet clipboard,
    // so kick the check off immediately — no typing, no clicking.
    if (msg && msg.type === 'CE_FILL_PHONE' && msg.text && msg.text.trim()) {
      inputPhone.value = msg.text.trim();
      updateButtonState();
      sendResponse(true);
      handleCheck(); // async — fires and forgets
      return;
    }
  });

  // ── Listen for tab changes ──
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabId === carryBeeTabId) {
      carryBeeTabId = null;
      findCarryBeeTab();
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Known CarryBee tab finished (re)loading → refresh page type/status.
    // Skip while a check is running so navigation doesn't race the driver loop.
    if (tabId === carryBeeTabId && changeInfo.status === 'complete') {
      if (!isChecking) findCarryBeeTab();
      return;
    }
    // CarryBee tab opened after the panel already showed the "Open ..." hint
    if (
      carryBeeTabId === null &&
      changeInfo.status === 'complete' &&
      tab &&
      tab.url &&
      isCarryBeeUrl(tab.url)
    ) {
      findCarryBeeTab();
    }
  });

  // ── Start ──
  init();
})();
