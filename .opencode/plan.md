# CarryBee Extension — Master Plan

Status legend: ✅ done | 🔄 in progress | ⬜ pending

## Line strategy
- **v1** (branch `v1`): vanilla JS extension — all active work here
- **v2** (branch `main`, tag v2.0.0): React rewrite — separate line

## Releases
- ✅ v1.0.0 → v1.1.0 → v1.1.1 → v1.1.2 (tags on v1 line)
- 🔄 v1.1.3 — toast observer fix + remove button-missing checks

## v1.1.3+ work (uncommitted batch)
- ✅ Toast observer: `characterData: true` + `querySelector(toast)` — RELEASED in v1.1.3
- ✅ Button-missing checks deleted — RELEASED in v1.1.3
- 🔄 Uncommitted batch (commit when user says):
  - ✅ Manual sort → refocus input (IDLE covered in sort-toast handler)
  - ✅ Badges early: stable-count 200ms, hard cap 1000ms (~400ms badge, was 1.7-1.9s)
  - ✅ Phone mismatch badge 1500 → 2500ms
  - ✅ COD settle timeout 3000 → 1000ms
  - ✅ Daily reset tz fix (UTC math) + settings.resetHour + add-time check
  - ✅ Sort: row-removed = success; stuck 20s → "Sort failed" badge BUT tracked as sorted (unverified)
  - ✅ Settings: reset time any h/m/AM-PM12h (`resetAtMinutes`, legacy migration)
  - ✅ Settings: Skip weight step (default OFF), Daily reset toggle (default ON) — Remember last mode REMOVED entirely (user request)
  - ✅ Badge on other pages fix: strict pathname isProcessingPage, setStatus/setCodProgress disabled-guard, handleCommand/CB_SET_STATE page guard, wireUrlWatcher early in init
  - ✅ Popup: Total sorted counter (all businesses), tracking section works on ANY page (URL guard only disables toggle+modes), strict pathname guard
  - ✅ Cleanup pass: shared.js (reset math dedup, manifest+importScripts), removed dead waitForToast + sortToastTimeoutMs + resetHour fallback, setUiDisabled→setControlsDisabled, onKeydown→confirmEnterHandler/weightEnterHandler, sort/weight literals→CFG keys, JSDoc on all fns, header/stale comment fixes
- ⬜ Browser test all above
- ✅ Released **v1.2.0**: 6-commit split (options/popup/shared/content/docs/release), lightweight tag `v1.2.0`, pushed `v1` + tag → Actions Build & Release (shared.js added to dist)

## Older done (v1.1.2 and before)
- ✅ COD batch ID flush, badge positioning/timing, sort 60s polling + final 3s toast wait
- ✅ Phone ending validation, SPA nav detection (pushState/hashchange/setInterval)
- ✅ Auto-flow resume after manual sort (`handleManualSortCompletion`)
- ✅ Daily reset via chrome.alarms, popup reorder (Consignment→Phone→Merchant→COD)
- ✅ `weightSinceMark` captured BEFORE Enter wait
