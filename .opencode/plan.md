# CarryBee Extension — Master Plan

Status legend: ✅ done | 🔄 in progress | ⬜ pending

## Line strategy
- **v1** (branch `v1`): vanilla JS extension — all active work here
- **v2** (branch `main`, tag v2.0.0): React rewrite — separate line

## Releases
- ✅ v1.0.0 → v1.1.0 → v1.1.1 → v1.1.2 (tags on v1 line)
- 🔄 v1.1.3 — toast observer fix + remove button-missing checks

## v1.1.3 work
- ✅ Toast observer: restore old proven behavior — `characterData: true` + `querySelector(toast)` fallback (root cause of false "Weight update failed")
- ✅ Delete "Print button missing" / "Sort button missing" checks — click via `?.`, toast timeout catches real failure
- ✅ Weight flow: mark before Enter → toast contains "weight" → auto print+sort; no toast 3s → "Weight update failed" → stop
- ✅ manifest version 1.0.0 → 1.1.3
- ⬜ User browser test (weight change + Enter → auto print+sort)
- ⬜ Tag v1.1.3 + push → GitHub Actions release

## Older done (v1.1.2 and before)
- ✅ COD batch ID flush, badge positioning/timing, sort 60s polling + final 3s toast wait
- ✅ Phone ending validation, SPA nav detection (pushState/hashchange/setInterval)
- ✅ Auto-flow resume after manual sort (`handleManualSortCompletion`)
- ✅ Daily reset via chrome.alarms, popup reorder (Consignment→Phone→Merchant→COD)
- ✅ `weightSinceMark` captured BEFORE Enter wait
