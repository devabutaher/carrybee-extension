# Session — 2026-09-23/24

## Done this session
- Released **v1.1.3** (toast observer characterData fix + button-missing checks removed)
- Uncommitted batch (user: no commit yet, more fixes may come):
  1. Manual sort → input refocus + resume (sort-toast handler covers IDLE)
  2. Badges early: stable-count row poll (~400ms, was 1.7-1.9s)
  3. Phone mismatch badge 2500ms
  4. COD settle timeout 1000ms
  5. Daily reset tz bug (UTC math, content+background), settings.resetHour honored, check on add/flush
  6. Sort: row-removed=success; stuck 20s → "Sort failed" + ID tracked as sorted (`unverified`)
  7. Settings upgrade: any-time reset (h/m/AM-PM 12h, `resetAtMinutes` + migration), Remember last mode (OFF), Skip weight step (OFF), Daily reset toggle (ON)
  8. Badge persist on other pages: strict pathname check, `if (!enabled) return` in setStatus + setCodProgress hide-path always works, handleCommand/CB_SET_STATE ignore non-processing page, URL watcher wired first in init
  9. Popup upgrade: `#total-sorted` (all-biz sum, green), tracking data loads on any page via chrome.storage, URL guard only disables toggle+mode buttons, strict pathname check
  10. Cleanup: NEW `shared.js` (cbResolveResetMinutes/cbTodayResetMs — BDT math single source; manifest js:["shared.js","content.js"], background importScripts); deleted dead waitForToast, CFG.sortToastTimeoutMs, dead resetHour fallback in content; CFG gained sortPollMs/sortGraceTimeoutMs/sortDeadlineMs/weightToastTimeoutMs; renames setControlsDisabled + confirmEnterHandler/weightEnterHandler; background hoisted VALID_COMMANDS; JSDoc on every fn; headers updated (sub-sort, daily-reset duty, any-page popup)
  11. Shortcut toggle: all 4 Ctrl+Shift+1/2/3/4 press-again-on-active-mode → OFF via shared `userDisable()` (also used by CB_SET_STATE off branch)
  12. REMOVED Remember last mode entirely: settings card, defaults, persistSession/restoreSession/scheduleRestoreFocus, all call sites — fresh load always starts OFF; shortcut/popup paths still refocus input
  13. Phone typed-only flow: settle-wait (400ms stable / Enter / 2000ms cap) before endsWith check; Enter remembered 1500ms (lastEnterAt) → match skips 2nd Enter; mismatch badge 2000ms (CFG.mismatchBadgeMs); badges: "No parcel found", "Parcel found — press Enter to confirm"

## Active files
- `shared.js` — reset math (load FIRST in content list + SW importScripts)
- `content.js`, `background.js`, `popup.js`, `options.*` — cleanup applied, syntax OK
- `content.js` — settings/restore (31-85), checkDailyReset (~520), search/stable-count (~700), sort toast handler (~409), printThenSort (~1000), runFullCycle (~1049+1137)
- `background.js` — checkDailyReset (resetAtMinutes + dailyResetEnabled)
- `options.html/js/css` — time-selects, Behavior section, merge-save

## Key decisions
- weight toast fail → STOP (no print+sort); row removed → sort success without toast
- unverified sort → track ID, keep fail badge, no ✓ overwrite, COD batch continues
- persistSession only on explicit user action (setMode/CB_SET_STATE), NOT disableExtension (URL guard)
- options save = merge (preserves lastMode/lastEnabled)

## Next steps
1. ~~User browser test~~ → released **v1.2.0** (6 commits + lightweight tag, pushed v1; build.yml includes shared.js in dist)

## Notes
- v1 = JS line, v2 = React rewrite (origin/main) — do NOT mix
- Release pattern: feat/fix splits → docs → `chore(release): vX.Y.Z` → lightweight tag → push branch + tag
