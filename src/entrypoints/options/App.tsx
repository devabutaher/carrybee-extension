import { useState, useEffect } from 'react';
import { getSettings, saveSettings, clearAllConsignments } from '~/utils/storage';
import type { Settings } from '~/types';
import { DEFAULT_SETTINGS } from '~/types';

const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTE_OPTIONS = Array.from({ length: 60 }, (_, i) => i);

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [savedIndicator, setSavedIndicator] = useState(false);
  const [version, setVersion] = useState('');

  useEffect(() => {
    getSettings().then(setSettings);
    if (chrome?.runtime?.getManifest) {
      setVersion(`v${chrome.runtime.getManifest().version}`);
    }
  }, []);

  const handleChange = async (partial: Partial<Settings>) => {
    const next = { ...settings, ...partial };
    setSettings(next);
    await saveSettings(next);
    setSavedIndicator(true);
    setTimeout(() => setSavedIndicator(false), 1500);
  };

  const handleClearAll = async () => {
    const confirmed = window.confirm(
      'Clear ALL consignment data for ALL businesses? This cannot be undone.'
    );
    if (!confirmed) return;
    await clearAllConsignments();
    window.alert('All data cleared.');
  };

  // 12h picker state derived from settings.resetAtMinutes
  const total = settings.resetAtMinutes ?? 19 * 60;
  const h24 = Math.floor(total / 60) % 24;
  const minute = total % 60;
  const h12 = ((h24 + 11) % 12) + 1;
  const isPm = h24 >= 12;

  const handleTimeChange = (partial: {
    h12?: number;
    minute?: number;
    pm?: boolean;
  }) => {
    const nextH12 = partial.h12 ?? h12;
    const nextMinute = partial.minute ?? minute;
    const nextPm = partial.pm ?? isPm;
    const nextH24 = (nextH12 % 12) + (nextPm ? 12 : 0);
    handleChange({ resetAtMinutes: nextH24 * 60 + nextMinute });
  };

  return (
    <div className="settings-container">
      <header className="settings-header">
        <div className="header-top">
          <div className="header-brand">
            <img
              src={chrome.runtime.getURL('icon/48.png')}
              alt="CarryBee"
              className="header-logo"
            />
            <h1 className="header-title">Settings</h1>
            {savedIndicator && (
              <span className="saved-indicator">✓ Saved</span>
            )}
          </div>
          <a
            href="https://github.com/devabutaher/carrybee-extension"
            target="_blank"
            rel="noopener"
            className="upgrade-link"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
            Update on GitHub
          </a>
        </div>
        <p className="header-subtitle">Customize CarryBee Auto-Flow behavior</p>
      </header>

      <section className="settings-section">
        <h2 className="section-title">Display</h2>
        <div className="settings-grid">
          <label className="setting-card">
            <div className="setting-info">
              <span className="setting-label">Show main badge</span>
              <span className="setting-desc">Display status badge on processing page</span>
            </div>
            <input
              type="checkbox"
              className="toggle-input"
              checked={settings.showMainBadge}
              onChange={(e) => handleChange({ showMainBadge: e.target.checked })}
              aria-label="Show main badge"
            />
            <span className="toggle-track">
              <span className="toggle-thumb" />
            </span>
          </label>

          <label className="setting-card">
            <div className="setting-info">
              <span className="setting-label">Show progress badge (COD)</span>
              <span className="setting-desc">Display processing count during COD batch</span>
            </div>
            <input
              type="checkbox"
              className="toggle-input"
              checked={settings.showProgressBadge}
              onChange={(e) =>
                handleChange({ showProgressBadge: e.target.checked })
              }
              aria-label="Show progress badge"
            />
            <span className="toggle-track">
              <span className="toggle-thumb" />
            </span>
          </label>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="section-title">Data</h2>
        <div className="settings-grid">
          <label className="setting-card">
            <div className="setting-info">
              <span className="setting-label">Daily reset time</span>
              <span className="setting-desc">Auto-clear consignments at this time (BDT)</span>
            </div>
            <div className="time-selects" role="group" aria-label="Daily reset time">
              <select
                className="setting-select"
                value={h12}
                onChange={(e) => handleTimeChange({ h12: parseInt(e.target.value, 10) })}
                aria-label="Reset hour"
              >
                {HOUR_OPTIONS.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
              <select
                className="setting-select"
                value={minute}
                onChange={(e) => handleTimeChange({ minute: parseInt(e.target.value, 10) })}
                aria-label="Reset minute"
              >
                {MINUTE_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {String(m).padStart(2, '0')}
                  </option>
                ))}
              </select>
              <select
                className="setting-select"
                value={isPm ? 'PM' : 'AM'}
                onChange={(e) => handleTimeChange({ pm: e.target.value === 'PM' })}
                aria-label="AM or PM"
              >
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>
          </label>

          <div className="setting-card">
            <div className="setting-info">
              <span className="setting-label">Clear all data</span>
              <span className="setting-desc">Remove all stored consignments</span>
            </div>
            <button className="btn-danger" onClick={handleClearAll}>
              Clear All
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="section-title">Behavior</h2>
        <div className="settings-grid">
          <label className="setting-card">
            <div className="setting-info">
              <span className="setting-label">Skip weight step</span>
              <span className="setting-desc">Print+Sort directly, no weight entry</span>
            </div>
            <input
              type="checkbox"
              className="toggle-input"
              checked={settings.skipWeight}
              onChange={(e) => handleChange({ skipWeight: e.target.checked })}
              aria-label="Skip weight step"
            />
            <span className="toggle-track">
              <span className="toggle-thumb" />
            </span>
          </label>

          <label className="setting-card">
            <div className="setting-info">
              <span className="setting-label">Daily reset</span>
              <span className="setting-desc">Auto-clear consignments daily at reset time</span>
            </div>
            <input
              type="checkbox"
              className="toggle-input"
              checked={settings.dailyResetEnabled}
              onChange={(e) =>
                handleChange({ dailyResetEnabled: e.target.checked })
              }
              aria-label="Daily reset"
            />
            <span className="toggle-track">
              <span className="toggle-thumb" />
            </span>
          </label>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="section-title">Keyboard Shortcuts</h2>
        <div className="shortcuts-grid">
          <div className="shortcut-item">
            <span className="shortcut-label">Consignment ID mode</span>
            <kbd className="shortcut-key">Ctrl+Shift+1</kbd>
          </div>
          <div className="shortcut-item">
            <span className="shortcut-label">Customer Phone mode</span>
            <kbd className="shortcut-key">Ctrl+Shift+2</kbd>
          </div>
          <div className="shortcut-item">
            <span className="shortcut-label">Merchant Order ID mode</span>
            <kbd className="shortcut-key">Ctrl+Shift+3</kbd>
          </div>
          <div className="shortcut-item">
            <span className="shortcut-label">COD Quantity mode</span>
            <kbd className="shortcut-key">Ctrl+Shift+4</kbd>
          </div>
        </div>
      </section>

      <footer className="settings-footer">
        <p>{version || 'CarryBee Auto-Flow'}</p>
        <p>
          Owner: <strong>Abu Taher</strong>
        </p>
        <p>
          <a
            href="https://github.com/devabutaher/carrybee-extension"
            target="_blank"
            rel="noopener"
          >
            Update on GitHub
          </a>
        </p>
      </footer>
    </div>
  );
}
