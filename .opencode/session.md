# Session — 2026-09-24 (continued)

## Done this session
- **Released v1.2.0** earlier (6 commits + lightweight tag, pushed v1 + tag) — v1 line complete
- **Released v2.1.0** — full port of v1.1.3 + v1.2.0 into React/WXT clone at `C:\Users\write\Downloads\carrybee-new` (branch `v2`):
  1. `184c635` fix(content): toast observer characterData + remove button missing checks
  2. `6f45266` feat(content): phone settle, sort unverified tracking, shortcut toggle, badge guards (+CFG alignment, toast matcher fixes, processToasts gate, COD 1000ms, types PrintThenSortResult.unverified)
  3. `6e6e79f` feat(settings): reset minutes picker, skip weight, daily reset toggle + live mirror (Settings type rewrite, date.ts pure-UTC math, storage migration + Fix B mirror, options 12h picker + Behavior, content `!settings.skipWeight`, deleted types/storage.ts)
  4. `80f7e25` feat(popup): total sorted, tracking any page, clear via Dexie (Fix A)
  5. `0f172aa` docs: readme v2.1.0 (also dropped stale Ctrl+Shift+X row, added toggle-off note)
  6. `0cceace` chore(release): v2.1.0 (package.json + wxt.config 2.1.0, NEW .github/workflows/release.yml — windows-latest because package.mjs uses powershell Compress-Archive)
- lightweight tag `v2.1.0`; pushed `origin v2`, `origin v2:main` (synced), `origin v2.1.0`
- verified: `npx tsc --noEmit` exit 0, `npm run build` green, built manifest version 2.1.0
- Actions: Release run #35973333295 in progress (tag v2.1.0)

## Active files (carrybee-new, branch v2 @ 0cceace)
- `src/entrypoints/content/index.ts` — CFG 84-102, badges 179+, toast watcher 243+, watchDom 336+, printThenSort ~585, runFullCycle ~660, onSearchInputChanged ~765, runCodBatch ~920, handleCommand ~1050, guards 1100+, init 1210
- `src/types/index.ts` — Settings {showMainBadge, showProgressBadge, resetAtMinutes, dailyResetEnabled, skipWeight}; DEFAULT 19*60/true/false
- `src/utils/date.ts` — resolveResetMinutes/todayResetMs/shouldDailyReset (pure UTC)
- `src/utils/storage.ts` — Dexie; getSettings legacy resetHour migration; saveSettings mirrors chrome.storage.local.cbSettings; checkDailyReset guards dailyResetEnabled
- `src/entrypoints/options/App.tsx` — 12h time-selects + Behavior toggles
- `src/entrypoints/popup/App.tsx` — total counter, any-page load, Clear→Dexie
- `.github/workflows/release.yml` — tag→zip→GH Release (windows-latest)
- CarryBee-extension repo `v1` branch @ 366adbe = released v1.2.0 (do not modify unless asked)

## Key decisions
- React settings live-update = mirror write: options saves Dexie AND chrome.storage.local → content onChanged → refetch from background(Dexie). Mirror key `cbSettings`.
- resetHour legacy migrated at read-time in getSettings (Dexie rows from v2.0.0)
- release.yml on windows-latest — package.mjs powershell zip needs it (ubuntu has no powershell; GNU tar can't write .zip)
- lightweight tag (matches v1 tags; v2.0.0 was annotated — inconsistent but lightweight = current convention)
- main == v2 after release (both 0cceace)

## Next steps
1. Confirm Release run green + carrybee-v2.zip attached to GH Release v2.1.0
2. Browser test extension (phone settle, sort unverified, shortcut toggle, settings live-update, popup Clear, daily reset at custom time)
3. v1 line: browser-test v1.2.0 zip too (pending from previous session)

## Notes
- Two clones: `carrybee-extension` (v1 line, working dir, has .opencode/plan.md+session.md) and `carrybee-new` (v2 line, on branch v2)
- Same remote https://github.com/devabutaher/carrybee-extension
- Release pattern: feat/fix splits → docs → `chore(release): vX.Y.Z` → lightweight tag → push branch + main-sync + tag → Actions attaches zip
