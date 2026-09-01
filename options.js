/**
 * CarryBee Auto-Flow — Settings Controller
 *
 * Manages extension settings stored in chrome.storage under 'cbSettings' key.
 * Settings: showMainBadge, showProgressBadge, resetHour.
 */

const showMainBadgeEl = document.getElementById('showMainBadge');
const showProgressBadgeEl = document.getElementById('showProgressBadge');
const resetHourEl = document.getElementById('resetHour');
const clearAllEl = document.getElementById('clearAll');
const savedIndicator = document.getElementById('saved-indicator');

const SETTINGS_KEY = 'cbSettings';

const defaultSettings = {
  showMainBadge: true,
  showProgressBadge: true,
  resetHour: 19,
};

/** Load settings from chrome.storage, merged with defaults. */
async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get([SETTINGS_KEY], (res) => {
      resolve({ ...defaultSettings, ...(res[SETTINGS_KEY] || {}) });
    });
  });
}

/** Save settings to chrome.storage. */
async function saveSettings(s) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [SETTINGS_KEY]: s }, resolve);
  });
}

/** Populate UI elements from settings object. */
function settingsToUI(s) {
  showMainBadgeEl.checked = s.showMainBadge;
  showProgressBadgeEl.checked = s.showProgressBadge;
  resetHourEl.value = s.resetHour;
}

/** Read current UI state into a settings object. */
function uiToSettings() {
  return {
    showMainBadge: showMainBadgeEl.checked,
    showProgressBadge: showProgressBadgeEl.checked,
    resetHour: parseInt(resetHourEl.value, 10) || 19,
  };
}

/** Attach change listeners to all settings inputs. */
function setupListeners() {
  const inputs = [showMainBadgeEl, showProgressBadgeEl, resetHourEl];

  inputs.forEach(input => {
    input.addEventListener('change', async () => {
      const s = uiToSettings();
      await saveSettings(s);
      if (savedIndicator) {
        savedIndicator.style.opacity = '1';
        setTimeout(() => { savedIndicator.style.opacity = '0'; }, 1500);
      }
    });
  });

  clearAllEl.addEventListener('click', async () => {
    const confirmed = confirm('Clear ALL consignment data for ALL businesses? This cannot be undone.');
    if (!confirmed) return;

    chrome.storage.local.remove(['cbConsignments_v2'], () => {
      alert('All data cleared.');
    });
  });
}

// ============ INIT ============
(async () => {
  const s = await loadSettings();
  settingsToUI(s);
  setupListeners();

  // Load version from manifest
  const versionEl = document.getElementById('version');
  if (versionEl && chrome?.runtime?.getManifest) {
    versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
  }
})();
