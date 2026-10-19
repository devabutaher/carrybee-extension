# CarryBee Auto-Flow — Plan

## Done
- ✅ COD double-print bug: root cause was early break in sort-poll loop (`!stillLoading`) → row stayed in DOM → reprocessed → reprinted.
- ✅ Anti-double-print locks: Dexie `printLocks` table (v2 schema), 2-level (pending=click w/o toast, confirmed=toast verified). Seeded in content script at init + batch start via `CB_GET_PRINT_LOCKS`; persisted via `CB_ADD_PRINT_LOCK`. Pending rows skipped in COD picker; confirmed rows get sort-only retry. Never downgrades, survives Stop/reload/restart.
- ✅ Sort wait hardened: removed early break; waits for toast | row removed | 30s deadline (`sortDeadlineMs: 30000`, removed `sortGraceTimeoutMs`).
- ✅ Stuck after 30s → batch stops: consignment ID saved to list anyway; badge `✓ N sorted · 1 stuck (check manually)`; status "Sort failed — stopped"; then IDLE + input ready.
- ✅ Graceful Stop button: `codStopRequested` flag — finishes current print+sort cycle, then stops with `✓ N sorted` badge. Hard abort (popup off/mode switch/URL change) unchanged via cycleToken.
- ✅ Print-lock expiry: 3 days (`PRINT_LOCK_TTL_MS`), pruned hourly via existing `dailyReset` alarm + on SW startup. NOT cleared by daily reset.
- ✅ Locks shared across all modes (`printThenSort` signature: `(row, myToken, consignmentId)`); pending-pass-through only for single search modes; confirmed → sort-only everywhere.

## Decisions
- Lock saved BEFORE print click (pending) — worst case: manual print, never double.
- Stuck parcel counts NOT in counter; consignment list entry still saved.
- Re-sort success (sort-only) re-adds consignment (dedupe-safe, benign refresh).
- Pending lock in single search mode → normal print flow (user explicitly targeted parcel).
- Daily reset still clears consignments as before; print locks exempt.

## Files
- `src/utils/storage.ts` — printLocks table + add/get/prune
- `src/entrypoints/background.ts` — CB_ADD_PRINT_LOCK, CB_GET_PRINT_LOCKS, hourly prune
- `src/entrypoints/content/index.ts` — locks, CFG 30s, printThenSort rewrite, runCodBatch/finishCodBatch/pickCodRow, graceful stop
- Commit: `fix(cod): anti-double-print locks, 30s sort deadline, graceful stop` (d1f5782)

## Next / ideas
- ⬜ Manual QA on hive.carrybee.com with slow network throttling
- ⬜ Optional: status badge showing "recovered" count for sort-only retries
