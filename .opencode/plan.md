# CarryBee Extension — Master Plan

Status legend: ✅ done | 🔄 in progress | ⬜ pending

## Line strategy
- **v1** (branch `v1`): vanilla JS extension — released line, fixes only
- **v2** (branches `v2` + `main`, tags v2.0.0/v2.1.0): React/WXT rewrite — active line

## Releases
- ✅ v1.0.0 → v1.1.0 → v1.1.1 → v1.1.2 → v1.1.3 → **v1.2.0** (v1 line, all pushed + tagged)
- ✅ v2.0.0 (React rewrite base)
- ✅ **v2.1.0** — port of v1.1.3+v1.2.0 to React + 2 bonus fixes + release workflow

## v2.1.0 port (DONE — released on branch v2)
- ✅ content: toast observer `characterData` + nested toast query; print/sort button-missing checks removed (`?.dispatchEvent`)
- ✅ content: isPrintSentToast `pdf generated`; isSortToast `&& !unsorted`; processToasts gate `enabled && mode`
- ✅ content: stable-count row poll (200ms/1000ms cap), badges "No parcel found"/"Parcel found — press Enter"/"Multiple parcels found"
- ✅ content: phone settle 400/2000ms + Enter remember 1500ms (lastEnterAt) + mismatch 2000ms
- ✅ content: sort deadline 20s + rowRemoved=success + grace 3s + `unverified` tracked (no ✓ overwrite); COD row-wait 1000ms + skip disappear-wait if unverified
- ✅ content: CFG aligned to v1 (sortPollMs/sortGraceTimeoutMs/sortDeadlineMs/weightToastTimeoutMs/mismatch/phone*); dead waitForToast + errorBadgeDebounceMs removed
- ✅ content: guards — setStatus `!enabled`, setCodProgress v1-shape, strict pathname isProcessingPage, CB_SET_STATE page guard, shortcut press-again → userDisable (COMMAND_TO_MODE), wireUrlWatcher first in init
- ✅ settings: `resetAtMinutes` + `dailyResetEnabled` + `skipWeight`; legacy resetHour migration in getSettings; types/storage.ts duplicate deleted; `!settings.skipWeight` in content
- ✅ date.ts: pure-UTC `todayResetMs`/`resolveResetMinutes` (machine-tz independent); checkDailyReset guards dailyResetEnabled
- ✅ options: 12h h/m/AM-PM picker (time-selects CSS), Behavior section (skipWeight + daily reset), save mirrors to `chrome.storage.local.cbSettings` (Fix B — onChanged live-update works)
- ✅ popup: Total sorted counter + tracking loads on ANY page + Clear via Dexie `clearConsignmentsByBusiness` (Fix A)
- ✅ README v2.1.0, version bump package.json + wxt.config (2.1.0)
- ✅ NEW `.github/workflows/release.yml` — tag push → windows-latest → npm ci + package → GH Release with carrybee-v2.zip
- ✅ 6 commits on `v2` (184c635…0cceace), lightweight tag `v2.1.0`, pushed `v2` + `main` + tag → Release run #35973333295
- ⬜ Browser test after zip attaches

## Older done (v1 line)
- ✅ v1.2.0: settings 12h picker, skipWeight, dailyResetEnabled, remember-mode REMOVED, badge guards, shortcut toggle, phone settle, sort unverified, popup total/any-page, shared.js, build.yml +shared.js
- ✅ v1.1.3: toast observer characterData + button-missing checks removed
- ✅ COD batch ID flush, badge positioning, SPA nav detection, auto-flow resume after manual sort, daily reset via alarms
