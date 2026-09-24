/**
 * CarryBee Auto-Flow — Settings Controller
 *
 * Manages extension settings stored in chrome.storage under 'cbSettings' key.
 * Settings: showMainBadge, showProgressBadge, resetAtMinutes (BDT),
 *           dailyResetEnabled, skipWeight.
 *
 * Save MERGES with existing storage so any future runtime keys
 * written by other extension contexts are never wiped.
 */

const showMainBadgeEl = document.getElementById('showMainBadge');
const showProgressBadgeEl = document.getElementById('showProgressBadge');
const resetHourEl = document.getElementById('resetHour');
const resetMinuteEl = document.getElementById('resetMinute');
const resetAmPmEl = document.getElementById('resetAmPm');
const skipWeightEl = document.getElementById('skipWeight');
const dailyResetEnabledEl = document.getElementById('dailyResetEnabled');
const clearAllEl = document.getElementById('clearAll');
const savedIndicator = document.getElementById('saved-indicator');

const SETTINGS_KEY = 'cbSettings';

const defaultSettings = {
  showMainBadge: true,
  showProgressBadge: true,
  resetAtMinutes: 19 * 60, // 7:00 PM BDT
  dailyResetEnabled: true,
  skipWeight: false,
};

// Populate hour (1-12) and minute (00-59) selects
for (let h = 1; h <= 12; h++) {
  const opt = document.createElement('option');
  opt.value = h;
  opt.textContent = h;
  resetHourEl.appendChild(opt);
}
for (let m = 0; m < 60; m++) {
  const opt = document.createElement('option');
  opt.value = m;
  opt.textContent = String(m).padStart(2, '0');
  resetMinuteEl.appendChild(opt);
}

/** Load settings from chrome.storage, merged with defaults + legacy migration. */
async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get([SETTINGS_KEY], (res) => {
      const stored = res[SETTINGS_KEY] || {};
      const s = { ...defaultSettings, ...stored };
      // Legacy migration: stored resetHour (0-23) → resetAtMinutes
      if (stored.resetAtMinutes == null && stored.resetHour != null) {
        s.resetAtMinutes = stored.resetHour * 60;
      }
      resolve(s);
    });
  });
}

/** Save settings to chrome.storage (merge — preserves future runtime keys). */
async function saveSettings(fields) {
  return new Promise((resolve) => {
    chrome.storage.local.get([SETTINGS_KEY], (res) => {
      const merged = { ...(res[SETTINGS_KEY] || {}), ...fields };
      chrome.storage.local.set({ [SETTINGS_KEY]: merged }, resolve);
    });
  });
}

/** Populate UI elements from settings object. */
function settingsToUI(s) {
  showMainBadgeEl.checked = s.showMainBadge;
  showProgressBadgeEl.checked = s.showProgressBadge;
  skipWeightEl.checked = !!s.skipWeight;
  dailyResetEnabledEl.checked = s.dailyResetEnabled !== false;

  const total = s.resetAtMinutes != null ? s.resetAtMinutes : 19 * 60;
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  resetHourEl.value = String(((h24 + 11) % 12) + 1); // 0→12, 13→1
  resetMinuteEl.value = String(m);
  resetAmPmEl.value = h24 >= 12 ? 'PM' : 'AM';
}

/** Read current UI state into settings fields (12h → minutes since midnight). */
function uiToSettings() {
  const h12 = parseInt(resetHourEl.value, 10) || 12;
  const m = parseInt(resetMinuteEl.value, 10);
  const pm = resetAmPmEl.value === 'PM';
  const h24 = (h12 % 12) + (pm ? 12 : 0);

  return {
    showMainBadge: showMainBadgeEl.checked,
    showProgressBadge: showProgressBadgeEl.checked,
    skipWeight: skipWeightEl.checked,
    dailyResetEnabled: dailyResetEnabledEl.checked,
    resetAtMinutes: h24 * 60 + (Number.isFinite(m) ? m : 0),
  };
}

/** Attach change listeners to all settings inputs. */
function setupListeners() {
  const inputs = [
    showMainBadgeEl,
    showProgressBadgeEl,
    skipWeightEl,
    dailyResetEnabledEl,
    resetHourEl,
    resetMinuteEl,
    resetAmPmEl,
  ];

  inputs.forEach((input) => {
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
