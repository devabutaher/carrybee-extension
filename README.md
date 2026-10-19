# CarryBee Check Entry

Chrome extension that opens a small pinned popup window and checks if a
parcel exists for a given business on CarryBee Order Processing.

## Installation

No build step needed. Direct load:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder (`carrybee-check-entry`)

## Usage

1. Open CarryBee in one tab: `https://hive.carrybee.com/order-processing`
2. Open Google Sheet in another tab (for business names)
3. Click the extension icon (or press **Alt+Q**) → a small window opens at
   the top-right of the active window, pinned above other windows
4. Enter one of: **Customer Phone Number** or **Consignment ID**
5. Click **Check Entry** or press **Enter**
6. Result shows:
   - ✓ **Entry Found** — with "Open Tab" button + copyable consignment ID
   - ✗ **No Entry** — no parcel matches
   - ✗ **Business Not Found** — no business matches the name you entered
   - ⚠ **Multiple Businesses / Entries** — be more specific

**Fast workflow (Alt+Q, mouse-free):**
```
Sheet: select business name → Ctrl+C → Alt+Q
       window opens/raises, Business Name auto-filled,
       caret in the Phone input → type the number → Enter
```

- `Alt+Q` reads the clipboard via the `clipboardRead` + `offscreen` + `scripting` permissions — whatever you copied last is what gets filled, so keep the copy-then-shortcut order
- Rebind the shortcut at `chrome://extensions/shortcuts` if `Alt+Q` clashes with another extension's shortcut
- The window stays pinned (`alwaysOnTop`) until closed; move it like any normal window

**Not ready?** If no CarryBee tab is open (or the tab is on a different page), the window shows an **"Open Order Processing"** link — one click opens the right page and the window becomes ready automatically.

**Note:** The window searches the CarryBee tab in the background. You can stay on Google Sheet while checking.

## Pages

| Page | URL | What happens |
|------|-----|-------------|
| List | `/order-processing?status=...` | Searches business → navigates to store → searches parcel |
| Store (same business) | `/order-processing/store/{id}` | Searches parcel directly (business remembered per tab) |
| Store (different/unknown business) | `/order-processing/store/{id}` | Goes back to the list page first → searches the new business → opens its store → searches parcel |

Navigation steps are driven by the window's script. After every hop it asks
the CarryBee tab's content script to confirm the page is actually ready
(search input rendered) before sending the next command — no fixed-guess
timing, so navigation races no longer happen.

## Search correctness

Row counting is verified against your search term. Rows only count as results
when their text actually contains the queried business name / parcel ID, so a
stale or unfiltered table (e.g. all 600 businesses) can never be reported as a
result. If results don't verify, the search is retried once automatically.

## Debugging

Per-stage timing is logged to the console at debug level:

- **Window UI**: click inside the window → F12 → Console (look for `[CE panel]`)
- **CarryBee tab**: DevTools → Console (look for `[CE content]`)
- **Background / offscreen**: `chrome://extensions` → CarryBee → *service worker* / *offscreen* Inspect (look for `[CE bg]` / `[CE offscreen]`)

Logs show hop count, search settle time, row counts, clipboard read method, and the final result.

## Window size

The content is a fixed **320px** column inside a fixed-size popup window
(~340×660) — extension-created (`chrome.windows.create`) and pinned with
`alwaysOnTop`. Tune `PANEL_WIDTH`/`PANEL_HEIGHT` in `background.js` if needed.

## Files

```
carrybee-check-entry/
├── manifest.json          MV3 + Alt+Q command
├── background.js          Pinned window open/focus + clipboard fill orchestration
├── content.js             Page detection + search + step-based navigation
├── popup/
│   ├── index.html         UI structure (320px, phone + consignment inputs)
│   ├── popup.css          CarryBee-matched styling
│   └── popup.js           Driver loop + result display + clipboard fill
├── offscreen/             Hidden clipboard reader (last-resort path)
├── icons/                 Yellow magnifier (16/48/128 + search.png master art)
├── README.md
└── .opencode/plan.md      Full plan + office tasks
```

## What's Left (Office Tasks)

See `.opencode/plan.md` for full details.

1. Test with real business names
2. Verify the automated search-retry behavior when the CarryBee list renders stale rows
3. Test list → store navigation (no "tab not responding" error)
4. Test store → list navigation when the business name changes
5. Verify store page search works (phone search + consignment search)
6. Test edge cases (business exists but no parcels)
7. Verify **Alt+Q** opens/raises the pinned window, auto-fills Business Name, and puts the caret in the Phone input — while Google Sheet has keyboard focus. Also test: window already open + Alt+Q, no clipboard content, and non-business clipboard text
8. Confirm window size comfort on your monitor (tune `PANEL_WIDTH`/`PANEL_HEIGHT` in `background.js`)
9. Verify the **"Open Order Processing"** link appears when no CarryBee tab exists and becomes ready after clicking it

## Git / Publish

Git setup happens after manual testing is done (see `.opencode/plan.md`).
