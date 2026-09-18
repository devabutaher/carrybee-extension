import { useState, useEffect, useCallback } from 'react';
import type { Mode } from '~/types';
import { escapeHtml } from '~/utils/helpers';

type ExtensionState = {
  enabled: boolean;
  mode: Mode | null;
};

const MODES: Array<{ key: Mode; label: string; icon: JSX.Element }> = [
  {
    key: 'consignment',
    label: 'Consignment ID',
    icon: (
      <svg className="mode-pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    key: 'phone',
    label: 'Customer Phone',
    icon: (
      <svg className="mode-pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
    ),
  },
  {
    key: 'merchant',
    label: 'Merchant Order',
    icon: (
      <svg className="mode-pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <path d="M3.27 6.96L12 12.01l8.73-5.05" />
        <path d="M12 22.08V12" />
      </svg>
    ),
  },
  {
    key: 'cod',
    label: 'COD Quantity',
    icon: (
      <svg className="mode-pill-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 6v6l4 2" />
      </svg>
    ),
  },
];

const COPY_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CHECK_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export default function App() {
  const [extensionState, setExtensionState] = useState<ExtensionState>({
    enabled: false,
    mode: null,
  });
  const [allConsignments, setAllConsignments] = useState<
    Record<string, Array<{ id: string; at: number }>>
  >({});
  const [selectedMerchant, setSelectedMerchant] = useState<string>('');
  const [isDisabled, setIsDisabled] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const loadConsignments = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'CB_GET_CONSIGNMENTS' }, (response) => {
      if (chrome.runtime.lastError || !response) return;
      setAllConsignments(response.businesses || {});
    });
  }, []);

  const sendMessage = useCallback(
    (msg: object): Promise<ExtensionState | null> => {
      return new Promise((resolve) => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tab = tabs?.[0];
          if (!tab?.id) {
            setIsDisabled(true);
            resolve(null);
            return;
          }

          chrome.tabs.sendMessage(tab.id, msg, (response) => {
            if (chrome.runtime.lastError || !response) {
              setIsDisabled(true);
              resolve(null);
              return;
            }
            setExtensionState({
              enabled: !!response.enabled,
              mode: response.mode,
            });
            resolve(response);
          });
        });
      });
    },
    []
  );

  // Init: handshake with content script
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      if (!tab?.id) {
        setIsDisabled(true);
        return;
      }

      if (
        !tab.url?.includes('hive.carrybee.com/order-processing') &&
        !tab.url?.includes('hive.carrybee.com/sub-sort')
      ) {
        setIsDisabled(true);
        return;
      }

      const timeout = setTimeout(() => {
        setIsDisabled(true);
      }, 2000);

      chrome.tabs.sendMessage(
        tab.id,
        { type: 'CB_GET_STATE' },
        (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError || !response) {
            setIsDisabled(true);
            return;
          }
          setExtensionState({
            enabled: !!response.enabled,
            mode: response.mode,
          });
          chrome.runtime.sendMessage(
            { type: 'CB_CHECK_DAILY_RESET' },
            () => {
              loadConsignments();
            }
          );
        }
      );
    });
  }, [loadConsignments]);

  // Listen for content script ready + consignment updates
  useEffect(() => {
    const listener = (msg: { type: string }) => {
      if (msg.type === 'CB_CONTENT_READY') {
        sendMessage({ type: 'CB_GET_STATE' });
      } else if (msg.type === 'CB_CONSIGNMENT_ADDED') {
        loadConsignments();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [sendMessage, loadConsignments]);

  // Popup close detection
  useEffect(() => {
    let popupOpen = true;

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && popupOpen) {
        popupOpen = false;
        chrome.tabs.query(
          { active: true, currentWindow: true },
          (tabs) => {
            const tab = tabs?.[0];
            if (tab?.id) {
              chrome.tabs.sendMessage(
                tab.id,
                { type: 'CB_POPUP_CLOSED' },
                () => void chrome.runtime.lastError
              );
            }
          }
        );
      } else if (document.visibilityState === 'visible') {
        popupOpen = true;
      }
    };

    const onPageHide = () => {
      if (popupOpen) {
        chrome.tabs.query(
          { active: true, currentWindow: true },
          (tabs) => {
            const tab = tabs?.[0];
            if (tab?.id) {
              chrome.tabs.sendMessage(
                tab.id,
                { type: 'CB_POPUP_CLOSED' },
                () => void chrome.runtime.lastError
              );
            }
          }
        );
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);

  // Toggle handler
  const handleToggle = () => {
    const next = !extensionState.enabled;
    sendMessage({
      type: 'CB_SET_STATE',
      enabled: next,
      mode: null,
    });
  };

  // Mode button handler
  const handleModeClick = (newMode: Mode) => {
    sendMessage({
      type: 'CB_SET_STATE',
      enabled: true,
      mode: newMode,
    });
    window.close();
  };

  // Merchant dropdown
  const merchants = Object.keys(allConsignments).filter(
    (m) => allConsignments[m].length > 0
  );

  const currentMerchant =
    selectedMerchant && allConsignments[selectedMerchant]
      ? selectedMerchant
      : merchants.length > 0
        ? merchants[0]
        : null;

  const sortedCount = currentMerchant
    ? allConsignments[currentMerchant].length
    : 0;

  const consignmentList = currentMerchant
    ? allConsignments[currentMerchant]
    : [];

  // Copy all
  const handleCopy = () => {
    if (!currentMerchant || !allConsignments[currentMerchant]) return;
    const text = allConsignments[currentMerchant]
      .map((e) => e.id)
      .join('\n');
    navigator.clipboard.writeText(text).then(
      () => {
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      },
      () => {
        // fallback
      }
    );
  };

  // Clear
  const handleClear = () => {
    if (!currentMerchant) return;
    const confirmed = window.confirm(
      `Clear all ${allConsignments[currentMerchant].length} consignments for ${currentMerchant}? This cannot be undone.`
    );
    if (!confirmed) return;

    chrome.storage.local.get(['cbConsignments_v2'], (res) => {
      const data = res.cbConsignments_v2 || {
        version: 2,
        lastReset: 0,
        businesses: {},
      };
      delete data.businesses[currentMerchant];
      chrome.storage.local.set({ cbConsignments_v2: data }, () => {
        setSelectedMerchant('');
        loadConsignments();
      });
    });
  };

  const statusText = extensionState.enabled
    ? extensionState.mode
      ? '✓ Active'
      : 'Pick a mode'
    : 'Off';

  return (
    <div className="popup-outer">
      <div className="popup-inner">
        {/* Header */}
        <header className="popup-header">
          <img
            src={chrome.runtime.getURL('icon/48.png')}
            alt="Carrybee"
            className="popup-logo"
          />
          <h1 className="popup-title">Carrybee Auto-Flow</h1>
          <a
            href="https://github.com/devabutaher/carrybee-extension"
            target="_blank"
            className="popup-github-link"
            title="GitHub"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7 17L17 7" />
              <path d="M7 7h10v10" />
            </svg>
          </a>
        </header>

        {/* Status Row */}
        <div className="status-row">
          <span className="status-label">{statusText}</span>
          <label className="toggle-wrapper">
            <input
              type="checkbox"
              className="toggle-input"
              checked={extensionState.enabled}
              onChange={handleToggle}
              disabled={isDisabled}
              aria-label="Enable auto-flow"
            />
            <span className="toggle-track">
              <span className="toggle-thumb" />
            </span>
          </label>
        </div>

        {/* Mode Selector */}
        <section className="mode-section">
          <div className="mode-label">Processing Mode</div>
          <div className="mode-grid">
            {MODES.map(({ key, label, icon }) => (
              <button
                key={key}
                className={`mode-pill-outer ${
                  extensionState.enabled && extensionState.mode === key
                    ? 'active'
                    : ''
                }`}
                disabled={isDisabled || !extensionState.enabled}
                onClick={() => handleModeClick(key)}
              >
                <span className="mode-pill-inner">
                  {icon}
                  {label}
                </span>
              </button>
            ))}
          </div>
        </section>

        <div className="divider" />

        {/* Tracking Section */}
        <section className="tracking-section">
          <div className="tracking-header">
            <span className="tracking-label">Sorted Consignments</span>
            <span className="sorted-count">
              {sortedCount > 0 ? sortedCount : '—'}
            </span>
          </div>

          <div className="dropdown-wrapper">
            <div className="dropdown-outer">
              <select
                className="dropdown-inner"
                value={currentMerchant || ''}
                onChange={(e) => setSelectedMerchant(e.target.value)}
              >
                <option value="">Select business name</option>
                {merchants.map((merchant) => (
                  <option key={merchant} value={merchant}>
                    {merchant} ({allConsignments[merchant].length})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="list-outer">
            <div className="list-inner">
              {consignmentList.length === 0 ? (
                <div className="list-empty">No data</div>
              ) : (
                consignmentList.map((entry, idx) => {
                  const time = entry.at
                    ? new Date(entry.at).toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                        hour12: true,
                      })
                    : '';
                  return (
                    <div key={idx} className="list-item-outer">
                      <div className="list-item-inner">
                        <span
                          className="list-item-id"
                          dangerouslySetInnerHTML={{
                            __html: escapeHtml(entry.id),
                          }}
                        />
                        {time && (
                          <span className="list-item-time">{time}</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="action-row">
            <button
              className={`action-btn primary ${copySuccess ? 'btn-success' : ''}`}
              disabled={!currentMerchant || consignmentList.length === 0}
              onClick={handleCopy}
            >
              <span>{copySuccess ? '✓ Copied!' : 'Copy All'}</span>
              <span className="btn-icon">{copySuccess ? CHECK_ICON : COPY_ICON}</span>
            </button>
            <button
              className="action-btn danger"
              disabled={!currentMerchant || consignmentList.length === 0}
              onClick={handleClear}
            >
              <span>Clear</span>
              <span className="btn-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </span>
            </button>
          </div>
        </section>

        <p className="hint">
          Toggle ON, pick a mode. Consignments tracked per business.
          <br />
          <strong>Shortcuts:</strong> Ctrl+Shift+1/2/3/4 to switch modes instantly.
        </p>

        <footer className="popup-footer">
          ♥ Developed by Abu Taher
        </footer>
      </div>
    </div>
  );
}
