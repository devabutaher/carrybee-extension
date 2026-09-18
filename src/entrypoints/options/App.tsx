import { useState, useEffect } from 'react';
import { getSettings, saveSettings, clearAllConsignments } from '~/utils/storage';
import type { Settings } from '~/types';
import { DEFAULT_SETTINGS } from '~/types';

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
            <select
              className="setting-select"
              value={settings.resetHour}
              onChange={(e) =>
                handleChange({ resetHour: parseInt(e.target.value, 10) })
              }
              aria-label="Daily reset time"
            >
              <option value={17}>5:00 PM</option>
              <option value={18}>6:00 PM</option>
              <option value={19}>7:00 PM</option>
              <option value={20}>8:00 PM</option>
              <option value={21}>9:00 PM</option>
              <option value={22}>10:00 PM</option>
            </select>
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
