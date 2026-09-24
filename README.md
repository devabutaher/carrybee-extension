# CarryBee Auto-Flow v2.1.0

Automates the Order Processing flow on CarryBee Hive. Supports Merchant Order ID, Customer Phone, COD Quantity, and Consignment ID modes.

## Installation

1. Download `carrybee-v2.zip` from [Releases](https://github.com/devabutaher/carrybee-extension/releases/tag/v2.1.0)
2. Extract the ZIP file
3. Open `chrome://extensions` in your browser
4. Enable **Developer mode** (top right toggle)
5. Click **Load unpacked**
6. Select the extracted `chrome-mv3` folder
7. Done!

## Keyboard Shortcuts

| Shortcut | Mode |
|----------|------|
| `Ctrl+Shift+1` | Consignment ID |
| `Ctrl+Shift+2` | Customer Phone |
| `Ctrl+Shift+3` | Merchant Order ID |
| `Ctrl+Shift+4` | COD Quantity |

Press the active mode's shortcut again to toggle it OFF.

## Build from Source

```bash
git clone https://github.com/devabutaher/carrybee-extension.git
cd carrybee-extension
git checkout v2
npm install
npm run build
```

Output → `.output/chrome-mv3/`

To create a distributable ZIP:

```bash
npm run package
```

This creates `carrybee-v2.zip` in the project root.

## Tech Stack

- [WXT](https://wxt.dev) - Web Extension Framework
- React 18 - UI (Popup & Options)
- TypeScript - Type safety
- Dexie.js - IndexedDB storage
