# CarryBee Check Entry

Chrome extension that opens a **side panel** and checks if a
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
3. Click the extension icon → the side panel opens, docked beside the page
4. Enter one of: **Customer Phone Number** or **Consignment ID**
5. Click **Check Entry** or press **Enter**
6. Result shows:
   - ✓ **Entry Found** — with "Open Tab" button + copyable consignment ID
   - ✗ **No Entry** — no parcel matches
   - ✗ **Business Not Found** — no business matches the name you entered
   - ⚠ **Multiple Businesses / Entries** — be more specific

**Fast workflows (mouse-free, shortcuts while Google Sheet is focused):**
```
Sheet: business name → Ctrl+C → Alt+Q    → Business Name auto-filled
Sheet: click the Phone field → type the number → Enter
```
```
Phone, fully hands-free:
Sheet: type the number into any free cell → Ctrl+C → Alt+W
       → Phone auto-filled + the search runs automatically
```

- `Alt+Q` / `Alt+W` read the clipboard via the `clipboardRead` + `offscreen` + `scripting` permissions — whatever you copied last is what gets filled, so keep the copy-then-shortcut order
- Rebind the shortcuts at `chrome://extensions/shortcuts` if `Alt+Q` / `Alt+W` clash with another extension's shortcut
- The side panel never closes and keeps its state while you work — it stays visible beside the Sheet

**Not ready?** If no CarryBee tab is open (or the tab is on a different page), the panel shows an **"Open Order Processing"** link — one click opens the right page and the panel becomes ready automatically.

**Note:** The panel searches the CarryBee tab in the background. You can stay on Google Sheet while checking.

## Pages

| Page | URL | What happens |
|------|-----|-------------|
| List | `/order-processing?status=...` | Searches business → navigates to store → searches parcel |
| Store (same business) | `/order-processing/store/{id}` | Searches parcel directly (business remembered per tab) |
| Store (different/unknown business) | `/order-processing/store/{id}` | Goes back to the list page first → searches the new business → opens its store → searches parcel |

Navigation steps are driven by the panel's script. After every hop it asks
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

- **Panel UI**: click inside the panel → F12 (or right-click → Inspect) → Console (look for `[CE panel]`)
- **CarryBee tab**: DevTools → Console (look for `[CE content]`)
- **Background / offscreen**: `chrome://extensions` → CarryBee → *service worker* / *offscreen* Inspect (look for `[CE bg]` / `[CE offscreen]`)

Logs show hop count, search settle time, row counts, clipboard read method, and the final result.

## Panel layout

The content is a fixed **320px** column inside the browser's side panel —
docked by Chrome, resizable only by the panel splitter. Chrome decides the
outer chrome; the CSS keeps the column tidy at any panel width.

## Files

```
carrybee-check-entry/
├── manifest.json          MV3 + side panel + Alt+Q / Alt+W commands
├── background.js          Side panel open + clipboard fill orchestration
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
7. Verify **Alt+Q** auto-fills Business Name (panel open or closed) while Google Sheet has keyboard focus
8. Verify **Alt+W** auto-fills Phone + runs the search — hands-free end to end
9. Verify the **"Open Order Processing"** link appears when no CarryBee tab exists and becomes ready after clicking it

## Git / Publish

Source lives at `github.com/devabutaher/carrybee-extension`, branch
`check-entry`. Tags (`v*`) trigger the GitHub Action that zips the
extension and attaches it to a release for direct download.
