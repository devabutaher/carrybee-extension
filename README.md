# CarryBee Auto-Flow (Chrome Extension)

Automates the Order Processing flow on CarryBee. Supports 4 processing modes with automatic weight entry, printing, sorting, and consignment ID tracking.

## Quick Start

1. `chrome://extensions` → **Developer mode** ON
2. **Load unpacked** → select `carrybee-extension` folder
3. Go to CarryBee Order Processing page, **refresh**
4. Click extension icon → toggle ON → choose mode → start processing

---

## 4 Processing Modes

### Mode 1: Merchant Order ID
- Scan/type Merchant ID → exactly 1 row → auto weight focus
- You enter weight + press Enter → auto print → auto sort
- With **Skip weight step** ON: no weight prompt, direct print+sort
- Field auto-selects, next scan replaces old ID

### Mode 2: Customer Phone
- Type phone number (typed only, no scan) → extension auto-searches
- Input settles (400ms pause) → digits checked against parcel phone
- Mismatch → "Phone number mismatch" badge (2s) → stops
- Match → "Parcel found — press Enter" → press Enter → auto weight focus
- Enter right after typing counts as confirm (no second Enter needed)
- You enter weight + press Enter → auto print → auto sort
- **Skip weight step** ON: skip weight, direct print+sort
- Field auto-selects for next number

### Mode 3: COD Quantity
- Type COD amount → field appears at bottom-right
- Enter quantity (1-200) → auto loops print+sort (no weight)
- Progress: "Processing 5/100"
- Stop button available during processing
- Done: "✓ 100 sorted"

### Mode 4: Consignment ID
- Scan/type Consignment ID → exactly 1 row → auto weight focus
- You enter weight + press Enter → auto print → auto sort
- With **Skip weight step** ON: no weight prompt, direct print+sort
- Field auto-selects, next scan replaces old ID

---

## Consignment ID Tracking

### Auto-Tracking (all modes)
- Every successful sort captures Consignment ID
- Grouped by **business name**
- Persists in browser (until manually cleared)
- Daily auto-reset at configured time (default 7pm BDT)

### Popup Section: Sorted Consignments
1. **Total counter** — green, sum across ALL businesses (top-right)
2. **Business dropdown** — select business (with per-business count)
3. **List** — one Consignment ID per line (monospace font)
4. **Copy All** — copies to clipboard (paste into Sheets)
5. **Clear** — delete all data (confirm first)

Tracking data (total, dropdown, list) is visible from **any tab/page** —
only toggle + mode buttons need the Order Processing page.

---

## Data Storage

**Format:**
```json
{
  "Daraz Bangladesh": [
    { "id": "F0731...", "at": 1719400000000 },
    { "id": "F0732...", "at": 1719400060000 }
  ],
  "Fiyona Mart": [
    { "id": "F0801...", "at": 1719400120000 }
  ]
}
```

- Each entry has `id` (consignment ID) and `at` (timestamp)
- Per-merchant isolation (Daraz IDs ≠ Fiyona Mart IDs)
- Survives page reload (until manually cleared)
- Max 1000 entries per business (oldest removed first)
- Auto-resets daily at configured time (BDT timezone)

---

## Settings

Right-click extension icon → **Options** to configure:

| Setting | Default | Description |
|---------|---------|-------------|
| Show main badge | ON | Display status badge on processing page |
| Show progress badge (COD) | ON | Display processing count during COD batch |
| Daily reset time | 7:00 PM BDT | Any time — Hour (1-12) / Minute / AM-PM picker |
| Daily reset | ON | Toggle auto-clear of consignments daily |
| Skip weight step | OFF | Print+sort directly, no weight entry |

---

## Error Handling

### Network Failures
- Print/Sort wait **up to 12 seconds** for toast
- If no toast: badge shows error, cycle stops
- Manual: retry or continue with next parcel

### Search Errors
- **No parcel found** → badge shows when search returns 0 rows
- **Multiple parcels found** → badge shows when row count ≠ 1 (stable, ≤1s)
- **Phone number mismatch** → judged after 400ms typing settle, badge 2s
- **Empty field** after backspace → no error badge

### COD Mode Edge Cases
- Quantity \<1 or >200 → error badge, re-prompt
- Network error during print/sort → error badge, stops batch
- Stop button → pauses, shows "Stopped at X/Y"

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+1` | Consignment ID mode |
| `Ctrl+Shift+2` | Customer Phone mode |
| `Ctrl+Shift+3` | Merchant Order ID mode |
| `Ctrl+Shift+4` | COD Quantity mode |

Press the **same** shortcut again while that mode is active → extension **OFF**.
Pressing a different mode shortcut switches mode (ON if currently off).

---

## UI Positioning

- **Main Badge** (top-right, ~208px down) — status messages
- **COD Progress Badge** (top-right, ~244px down) — "Processing X/Y"
- **Quantity Input** (bottom-right) — visible only in COD mode, Process + Stop buttons
- **Badges don't overlap** — stacked vertically to right side

---

## Per-Tab & Safety

- Toggle ON/OFF is **per-tab only** — other tabs unaffected
- **Page reload** → extension OFF (safety)
- **Multiple parcel rows** → auto-advance only if exactly 1 row

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Extension not ready | Reload the page and try again |
| Phone mode not working | Make sure you type phone number, extension auto-searches |
| Weight input not opening | Check if row actually exists (1 result) |
| COD quantity input missing | Only appears after COD mode selected |
| Data not saving | Check storage permissions, extension must be ON |
| Sort count mismatch | Network delays may cause resubmit, check manually |

---

## Project Structure

```
carrybee-extension/
├── manifest.json          # Chrome extension manifest (MV3)
├── shared.js              # Shared utils — daily reset math (BDT)
├── background.js          # Service worker — shortcuts + daily reset
├── content.js             # Content script — main automation logic
├── content.css            # Content script styles (badges, COD input)
├── popup.html             # Extension popup UI
├── popup.js               # Popup controller
├── popup.css              # Popup styles
├── options.html           # Settings page
├── options.js             # Settings controller
├── options.css            # Settings styles
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── .github/
    └── workflows/
        └── build.yml      # CI/CD — build & release
```

---

## Owner

**Abu Taher** — [Update on GitHub](https://github.com/devabutaher/carrybee-extension)
