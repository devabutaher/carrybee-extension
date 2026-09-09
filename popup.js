/**
 * CarryBee Auto-Flow — Popup Controller
 *
 * Communicates with content script via chrome.runtime messages.
 * Displays mode selection, toggle, and consignment tracking list.
 */

// ============ DOM ELEMENTS ============
const toggle = document.getElementById('toggle');
const statusLabel = document.getElementById('statusLabel');
const btnMerchant = document.getElementById('btn-merchant');
const btnPhone = document.getElementById('btn-phone');
const btnCod = document.getElementById('btn-cod');
const btnConsignment = document.getElementById('btn-consignment');
const merchantSelect = document.getElementById('merchant-select');
const sortedCount = document.getElementById('sorted-count');
const consignmentList = document.getElementById('consignment-list');
const copyBtn = document.getElementById('copy-btn');
const clearBtn = document.getElementById('clear-btn');

// ============ STATE ============
let activeTabId = null;
let currentMode = null;
let allConsignments = {};
let selectedMerchant = null;

// ============ CONSTANTS ============
const COPY_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>';

/** Escape HTML entities to prevent XSS. */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ============ UI HELPERS ============

/** Disable all controls when extension is not available. */
function setUiDisabled() {
  toggle.disabled = true;
  statusLabel.textContent = '—';
  btnMerchant.disabled = true;
  btnPhone.disabled = true;
  btnCod.disabled = true;
  btnConsignment.disabled = true;
  merchantSelect.disabled = true;
  copyBtn.disabled = true;
  clearBtn.disabled = true;
}

/**
 * Update all UI elements to reflect current state.
 * @param {boolean} enabled - Whether auto-flow is active
 * @param {string|null} mode - Current processing mode
 */
function render(enabled, mode) {
  toggle.disabled = false;
  toggle.checked = enabled;
  currentMode = mode;

  const modes = { merchant: btnMerchant, phone: btnPhone, cod: btnCod, consignment: btnConsignment };
  Object.entries(modes).forEach(([key, btn]) => {
    btn.disabled = !enabled;
    btn.classList.toggle('active', enabled && mode === key);
  });

  statusLabel.textContent = enabled ? (mode ? '✓ Active' : 'Pick a mode') : 'Off';
}

// ============ CONSIGNMENT TRACKING ============

/** Load consignment data from chrome.storage and update the UI. */
function loadConsignments() {
  if (!chrome?.storage?.local) return;
  chrome.storage.local.get(['cbConsignments_v2'], (res) => {
    const data = res.cbConsignments_v2 || { businesses: {} };
    allConsignments = data.businesses || {};
    updateMerchantDropdown();
    if (selectedMerchant && allConsignments[selectedMerchant]) {
      displayList(selectedMerchant);
    }
  });
}

/** Rebuild the business name dropdown from stored data. */
function updateMerchantDropdown() {
  const merchants = Object.keys(allConsignments).filter((m) => allConsignments[m].length > 0);

  const currentValue = merchantSelect.value;
  merchantSelect.innerHTML = '<option value="">Select business name</option>';
  merchants.forEach((merchant) => {
    const option = document.createElement('option');
    option.value = merchant;
    option.textContent = `${merchant} (${allConsignments[merchant].length})`;
    merchantSelect.appendChild(option);
  });

  if (currentValue && merchants.includes(currentValue)) {
    merchantSelect.value = currentValue;
  } else if (merchants.length > 0) {
    merchantSelect.value = merchants[0];
    selectedMerchant = merchants[0];
    displayList(merchants[0]);
  } else {
    selectedMerchant = null;
    consignmentList.innerHTML = '<div class="list-empty">No data</div>';
    sortedCount.textContent = '—';
    copyBtn.disabled = true;
    clearBtn.disabled = true;
  }
}

/** Render the consignment list for a given business. */
function displayList(merchant) {
  if (!merchant || !allConsignments[merchant]) {
    consignmentList.innerHTML = '<div class="list-empty">No data</div>';
    sortedCount.textContent = '—';
    copyBtn.disabled = true;
    clearBtn.disabled = true;
    return;
  }

  const list = allConsignments[merchant];
  const count = list.length;
  sortedCount.textContent = count;

  if (count === 0) {
    consignmentList.innerHTML = '<div class="list-empty">No data</div>';
    copyBtn.disabled = true;
    clearBtn.disabled = true;
    return;
  }

  consignmentList.innerHTML = list.map((entry) => {
    const time = entry.at
      ? new Date(entry.at).toLocaleTimeString('en-US', {
          hour: 'numeric', minute: '2-digit', hour12: true
        })
      : '';
    return `
      <div class="list-item-outer">
        <div class="list-item-inner">
          <span class="list-item-id">${escapeHtml(entry.id || entry)}</span>
          ${time ? `<span class="list-item-time">${time}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');

  copyBtn.disabled = false;
  clearBtn.disabled = false;
}

// ============ INITIALIZATION ============

/** Query active tab, verify URL, and handshake with content script. */
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs && tabs[0];
  if (!tab || !tab.id) {
    setUiDisabled();
    return;
  }

  // URL guard: must be on CarryBee order processing or sub-sort page
  if (!tab.url?.includes('hive.carrybee.com/order-processing') && !tab.url?.includes('hive.carrybee.com/sub-sort')) {
    setUiDisabled();
    return;
  }

  activeTabId = tab.id;

  // Handshake: send GET_STATE with timeout
  const timeout = setTimeout(() => {
    setUiDisabled();
  }, 2000);

  chrome.tabs.sendMessage(activeTabId, { type: 'CB_GET_STATE' }, (response) => {
    clearTimeout(timeout);
    if (chrome.runtime.lastError || !response) {
      setUiDisabled();
      return;
    }
    render(!!response.enabled, response.mode);
    loadConsignments();
  });
});

// ============ MESSAGE LISTENERS ============

/** Listen for content script ready signal and consignment updates. */
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'CB_CONTENT_READY' && activeTabId) {
    chrome.tabs.sendMessage(activeTabId, { type: 'CB_GET_STATE' }, (response) => {
      if (!chrome.runtime.lastError && response) {
        render(!!response.enabled, response.mode);
      }
    });
  } else if (msg.type === 'CB_CONSIGNMENT_ADDED') {
    loadConsignments();
  }
});

// ============ POPUP CLOSE DETECTION ============

/** Notify content script when popup closes (via visibilitychange). */
let popupOpen = true;

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && popupOpen) {
    popupOpen = false;
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, { type: 'CB_POPUP_CLOSED' }, () => {});
    }
  } else if (document.visibilityState === 'visible') {
    popupOpen = true;
  }
});

window.addEventListener('pagehide', () => {
  if (popupOpen && activeTabId) {
    chrome.tabs.sendMessage(activeTabId, { type: 'CB_POPUP_CLOSED' }, () => {});
  }
});

// ============ TOGGLE SWITCH ============

toggle.addEventListener('change', () => {
  if (activeTabId == null) return;
  const next = toggle.checked;
  const msg = next
    ? { type: 'CB_SET_STATE', enabled: true, mode: null }
    : { type: 'CB_SET_STATE', enabled: false, mode: null };

  chrome.tabs.sendMessage(activeTabId, msg, (response) => {
    if (chrome.runtime.lastError || !response) {
      setUiDisabled();
      return;
    }
    render(!!response.enabled, response.mode);
  });
});

// ============ MODE BUTTONS ============

[
  { btn: btnMerchant, mode: 'merchant' },
  { btn: btnPhone, mode: 'phone' },
  { btn: btnCod, mode: 'cod' },
  { btn: btnConsignment, mode: 'consignment' },
].forEach(({ btn, mode }) => {
  btn.addEventListener('click', () => {
    if (activeTabId == null) return;
    if (!toggle.checked) {
      toggle.checked = true;
    }
    const msg = { type: 'CB_SET_STATE', enabled: true, mode };
    chrome.tabs.sendMessage(activeTabId, msg, (response) => {
      if (chrome.runtime.lastError || !response) {
        setUiDisabled();
        return;
      }
      render(!!response.enabled, response.mode);
      // Close popup after mode selection
      window.close();
    });
  });
});

// ============ MERCHANT DROPDOWN ============

merchantSelect.addEventListener('change', () => {
  selectedMerchant = merchantSelect.value;
  if (selectedMerchant) {
    displayList(selectedMerchant);
  }
});

// ============ COPY ALL BUTTON ============

copyBtn.addEventListener('click', () => {
  if (!selectedMerchant || !allConsignments[selectedMerchant]) return;

  const list = allConsignments[selectedMerchant];
  const text = list.map(e => e.id || e).join('\n');

  navigator.clipboard.writeText(text).then(() => {
    copyBtn.classList.add('btn-success');
    copyBtn.textContent = '✓ Copied!';
    setTimeout(() => {
      copyBtn.classList.remove('btn-success');
      copyBtn.innerHTML = `<span>Copy All</span><span class="btn-icon">${COPY_ICON_SVG}</span>`;
    }, 2000);
  }).catch(() => {
    copyBtn.textContent = '✗ Failed';
    setTimeout(() => {
      copyBtn.innerHTML = `<span>Copy All</span><span class="btn-icon">${COPY_ICON_SVG}</span>`;
    }, 2000);
  });
});

// ============ CLEAR BUTTON ============

clearBtn.addEventListener('click', () => {
  if (!selectedMerchant) return;

  const confirmed = confirm(`Clear all ${allConsignments[selectedMerchant].length} consignments for ${selectedMerchant}? This cannot be undone.`);
  if (!confirmed) return;

  chrome.storage.local.get(['cbConsignments_v2'], (res) => {
    const data = res.cbConsignments_v2 || { version: 2, lastReset: 0, businesses: {} };
    delete data.businesses[selectedMerchant];
    chrome.storage.local.set({ cbConsignments_v2: data }, () => {
      allConsignments = data.businesses;
      selectedMerchant = null;
      merchantSelect.value = '';
      loadConsignments();
    });
  });
});
