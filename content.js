// CarryBee Check Entry — Content Script
// Works on: /order-processing (list) and /order-processing/store/{id} (store)
//
// Step-based protocol: never hold the message channel across a navigation.
// When a navigation is needed we return {status:'navigating', target}
// immediately and the side panel waits for the tab, then re-sends.

(() => {
  'use strict';

  // Guard against double injection (manifest injection + manual re-injection)
  if (window.__CE_LOADED) return;
  window.__CE_LOADED = true;

  const BUSINESS_CACHE_KEY = 'ce_business';

  // ── Debug logging (shows up in the CarryBee tab's DevTools console) ──
  const dbg = (...args) => console.debug('[CE content]', ...args);

  // ── Timing constants (tuned; event-driven waits do the real work) ──
  const POLL = 100; // generic poll tick
  const INPUT_WAIT = 8000; // wait for React to render a search input
  const PENDING_APPEAR_TIMEOUT = 2500; // debounce (~500ms) + request start
  const PENDING_GONE_TIMEOUT = 6000; // server response render
  const ROW_VERIFY_TIMEOUT = 4000; // rows must verify against the query
  const PARCEL_SETTLE = 2000; // client-side filter is instant; small guard only

  // ── Page Detection ──
  const getPageType = () => {
    const path = location.pathname;
    if (path === '/order-processing' || path === '/order-processing/') return 'list';
    if (path.startsWith('/order-processing/store/')) return 'store';
    return 'other';
  };

  // ── React-safe value setter ──
  const setNativeValue = (input, value) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value'
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Wait for a getter to return truthy, polling on a tick.
  async function waitFor(getter, timeoutMs) {
    const start = Date.now();
    do {
      const value = getter();
      if (value) return value;
      await sleep(POLL);
    } while (Date.now() - start < timeoutMs);
    return null;
  }

  // Wait for an input element to appear (React may render after document_idle)
  const waitForElement = (getter, timeoutMs) => waitFor(getter, timeoutMs);

  // ── Text normalization (keeps Bengali/unicode chars, only case + whitespace) ──
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

  const rowIncludes = (el, term) => {
    const q = norm(term);
    if (!q) return false;
    const digits = q.replace(/\D/g, '');
    const text = norm(el.getAttribute('data-order-id') || '') + ' ' + norm(el.textContent || '');
    // Phone numbers render in different formats (+880 1712 345 678 vs
    // 01712345678) — compare digit streams for digit-only queries.
    if (digits.length >= 8) {
      return text.replace(/\D/g, '').includes(digits);
    }
    return text.includes(q);
  };

  // ── Business cache (which business the open store page belongs to) ──
  function getCachedBusiness() {
    try {
      return JSON.parse(sessionStorage.getItem(BUSINESS_CACHE_KEY));
    } catch {
      return null;
    }
  }

  function setCachedBusiness(name, path) {
    try {
      sessionStorage.setItem(BUSINESS_CACHE_KEY, JSON.stringify({ name, path }));
    } catch {
      /* ignore */
    }
  }

  // ── Pending indicator helpers ──
  // CarryBee uses a 500ms debounce + server fetch on the list page.
  // During pending, data-pending="" appears on pagination/tabs and a
  // `searching...` spinner may render. Old rows stay visible meanwhile.
  const isPending = () =>
    !!document.querySelector('[data-pending]') ||
    !!document.querySelector('div[aria-label="searching..."]');

  // Wait for the pending indicator to appear, then disappear.
  // If it never appears (cached/fast response) we fall through — the row
  // verification below is the real correctness gate.
  async function waitForSearchSettle() {
    const appeared = await waitFor(isPending, PENDING_APPEAR_TIMEOUT);
    if (!appeared) {
      dbg('pending indicator never appeared — relying on row verification');
      return false;
    }
    const settled = await waitFor(() => !isPending(), PENDING_GONE_TIMEOUT);
    dbg('pending appeared and cleared:', settled);
    return true; // a real server search cycle completed
  }

  // ── List Page Functions ──
  const getBusinessSearchInput = () => document.querySelector('#search-business');

  const getBusinessRows = () =>
    [...document.querySelectorAll('tbody[data-slot="table-body"] tr[data-slot="table-row"]')];

  const getViewButton = (row) => row.querySelector('td:last-child a[data-slot="button"]');

  // Type into the business search. Only fires a clear when needed, so a check
  // never triggers an extra "empty query" search (that rendered ALL businesses
  // and raced the real search — the old "600 businesses found" bug).
  async function typeQuery(input, value, force) {
    if (force || input.value !== '') {
      setNativeValue(input, '');
      await sleep(120);
    }
    setNativeValue(input, value);
  }

  // Poll rows until they verify against the queried name.
  // Rows only count as results when their text actually mentions the query —
  // this makes counting a stale/unfiltered table (600 rows) impossible.
  //   verified   → { status: 'business_not_found' | 'multiple_business' | navigating }
  //   inconclusive → null (caller retries the search once)
  async function verifyBusinessRows(businessName, sawPending) {
    const plain = norm(businessName);

    async function classify(rows) {
      const real = rows.filter((row) => !!getViewButton(row));
      dbg('rows seen:', rows.length, 'real:', real.length);

      if (real.length > 0) {
        const matched = real.filter((row) => norm(row.textContent).includes(plain));
        dbg('matched query:', matched.length);
        if (matched.length === 0) return null; // stale/unfiltered table — keep waiting

        if (matched.length === 1) {
          const viewBtn = getViewButton(matched[0]);
          let storePath = '';
          try {
            storePath = new URL(viewBtn.href, location.href).pathname;
          } catch {
            storePath = '';
          }
          if (storePath) setCachedBusiness(businessName, storePath);
          // Click View and return IMMEDIATELY — navigation may destroy this
          // context, so never wait for the store page inside this message.
          viewBtn.click();
          return { status: 'navigating', target: 'store', storePath };
        }
        return { status: 'multiple_business', count: matched.length };
      }

      // 0 real rows: real empty state = placeholder rows (no View button), or
      // the table went empty because the filter removed everything.
      const placeholderRows = rows.length > 0;
      if (placeholderRows) return { status: 'business_not_found' };
      return null; // table not rendered yet — keep waiting
    }

    const start = Date.now();
    do {
      const verdict = await classify(getBusinessRows());
      if (verdict) return verdict;
      await sleep(POLL);
    } while (Date.now() - start < ROW_VERIFY_TIMEOUT);

    // Deadline hit: if the search settled (pending appeared + cleared) and the
    // table shows no results, that IS the answer — not an inconclusive retry.
    const rows = getBusinessRows();
    const real = rows.filter((row) => !!getViewButton(row));
    if (real.length === 0 && (rows.length > 0 || sawPending)) {
      dbg('deadline: empty result set → business_not_found');
      return { status: 'business_not_found' };
    }
    dbg('row verification inconclusive after', ROW_VERIFY_TIMEOUT, 'ms');
    return null;
  }

  async function searchBusiness(businessName) {
    const input = await waitForElement(getBusinessSearchInput, INPUT_WAIT);
    if (!input) {
      dbg('business search input not found');
      return { status: 'error', error: 'Business search input not found' };
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const t = Date.now();
      await typeQuery(input, businessName, attempt > 0);
      const sawPending = await waitForSearchSettle();
      const verdict = await verifyBusinessRows(businessName, sawPending);
      dbg(`business attempt ${attempt + 1} took ${Date.now() - t}ms →`, verdict?.status ?? 'inconclusive');
      if (verdict) return verdict;
      dbg('retrying business search once');
    }
    return {
      status: 'error',
      error: 'Search results did not load. Click Retry.',
    };
  }

  // ── Store Page Functions ──
  function getParcelInput(type) {
    const placeholders = {
      consignment: 'Search Consignment ID',
      merchant: 'Search Merchant Order ID',
      phone: 'Search Customer Phone',
    };
    const ph = placeholders[type];
    if (!ph) return null;
    return document.querySelector(`input[placeholder="${ph}"]`);
  }

  const getStoreRows = () => [...document.querySelectorAll('div[data-order-id]')];

  // Store page filters client-side (useMemo) — near instant. Poll briefly until
  // rows verify against the term; a table still showing the previous results
  // never passes verification.
  // Returns { result, sawUnmatchedRows } — sawUnmatchedRows means the table
  // showed rows that didn't match the term, i.e. the filter may not have
  // applied yet and one re-fire is worth it.
  async function verifyParcelRows(searchTerm) {
    const start = Date.now();
    let emptyTicks = 0;
    let sawUnmatchedRows = false;

    const classify = (rows) => {
      const matched = rows.filter((row) => rowIncludes(row, searchTerm));
      dbg('store rows:', rows.length, 'matched:', matched.length);
      if (rows.length > 0 && matched.length === 0) sawUnmatchedRows = true;

      if (matched.length === 1) {
        return { status: 'found', consignmentId: matched[0].getAttribute('data-order-id') };
      }
      if (matched.length > 1) {
        // Multiple results — don't show count (virtualizer limits DOM rows)
        return { status: 'multiple_entries' };
      }
      return null; // no verdict yet
    };

    // Require a stable empty table (~600ms) before "not_found", so a store
    // page whose order data is still loading doesn't give a false negative.
    do {
      const rows = getStoreRows();
      const verdict = classify(rows);
      if (verdict) return { result: verdict, sawUnmatchedRows };
      if (rows.length === 0) {
        emptyTicks++;
        if (emptyTicks >= 6) {
          return { result: { status: 'not_found' }, sawUnmatchedRows };
        }
      } else {
        emptyTicks = 0;
      }
      await sleep(POLL);
    } while (Date.now() - start < PARCEL_SETTLE);

    // Deadline: filter is synchronous, so whatever is showing is final.
    const rows = getStoreRows();
    const verdict = classify(rows) || { status: 'not_found' };
    return { result: verdict, sawUnmatchedRows };
  }

  async function searchParcel(searchTerm, type) {
    // The content script can wake up before React renders the inputs
    const input = await waitForElement(() => getParcelInput(type), INPUT_WAIT);
    if (!input) {
      dbg('parcel input not found:', type);
      return { status: 'error', error: 'Search input for ' + type + ' not found' };
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const t = Date.now();
      await typeQuery(input, searchTerm, attempt > 0);
      const { result, sawUnmatchedRows } = await verifyParcelRows(searchTerm);
      dbg(
        `parcel (${type}) attempt ${attempt + 1} took ${Date.now() - t}ms →`,
        result.status,
        'staleRows:',
        sawUnmatchedRows
      );
      // Retry once only when the table never actually matched the term
      // (filter didn't apply). A genuine no-match returns immediately.
      if (attempt === 0 && result.status === 'not_found' && sawUnmatchedRows) continue;
      return result;
    }
    return { status: 'not_found' };
  }

  // ── Navigate back to the list page (different/unknown business) ──
  function findListLink() {
    for (const link of document.querySelectorAll('a[href]')) {
      try {
        const u = new URL(link.href, location.href);
        if (
          u.hostname === location.hostname &&
          (u.pathname === '/order-processing' || u.pathname === '/order-processing/')
        ) {
          return link;
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  function goBackToList() {
    const link = findListLink();
    if (link) {
      link.click();
      // Safety net: if the click did not navigate, force a real navigation.
      // (If it DID navigate, this context is destroyed and the timer never fires.)
      setTimeout(() => {
        if (getPageType() !== 'list') location.assign('/order-processing');
      }, 1500);
    } else {
      location.assign('/order-processing');
    }
    return { status: 'navigating', target: 'list' };
  }

  // ── Determine which parcel input to use (phone first, then consignment) ──
  function getFirstParcelInputType(payload) {
    const candidates = [
      ['phone', payload.phone],
      ['consignment', payload.consignmentId],
    ];
    for (const [type, value] of candidates) {
      if (value && value.trim()) return { type, value: value.trim() };
    }
    return null;
  }

  // ── Readiness: has React rendered the input this page needs? ──
  // The side panel uses this instead of guessing from tab.status/URL timing.
  function isPageReady() {
    const type = getPageType();
    if (type === 'list') return !!getBusinessSearchInput();
    if (type === 'store') {
      return !!(getParcelInput('consignment') || getParcelInput('merchant') || getParcelInput('phone'));
    }
    return false;
  }

  // ── Main Check Flow ──
  async function checkEntry(payload) {
    const parcelInput = getFirstParcelInputType(payload);
    if (!parcelInput) {
      return {
        status: 'error',
        error: 'Enter at least one parcel info (Consignment/Merchant/Phone)',
      };
    }

    const businessName = (payload.businessName || '').trim();
    if (!businessName) {
      return { status: 'error', error: 'Business name is required' };
    }

    const pageType = getPageType();
    dbg('checkEntry:', pageType, JSON.stringify(parcelInput));

    if (pageType === 'other') {
      return {
        status: 'error',
        error:
          'Not on CarryBee Order Processing page. Navigate to hive.carrybee.com/order-processing first.',
      };
    }

    if (pageType === 'store') {
      // Only stay on the current store page if it belongs to the requested
      // business (cached when we navigated here via the View button).
      const cached = getCachedBusiness();
      if (cached && cached.path === location.pathname && cached.name === businessName) {
        return searchParcel(parcelInput.value, parcelInput.type);
      }
      // Different (or unknown) business → back to the list page first
      return goBackToList();
    }

    // List page — search the business, then navigate to its store
    return searchBusiness(businessName);
  }

  // ── Message Listener ──
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'CE_PAGE_TYPE') {
      sendResponse({ page: getPageType(), ready: isPageReady() });
      return;
    }

    if (msg.type === 'CE_CHECK_ENTRY') {
      checkEntry(msg.payload || {})
        .then(sendResponse)
        .catch((err) => sendResponse({ status: 'error', error: err.message }));
      return true; // async
    }
  });
})();
