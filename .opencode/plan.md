# Carrybee Auto-Flow — Plan (v2.1.3 released)

## Done (release v2.1.3)
- ✅ Branding rename CarryBee → Carrybee across docs/popup/options/manifest/comments (Dexie DB name `CarryBeeDB` intentionally untouched — rename would orphan user data).
- ✅ Version 2.1.3, tag pushed, GitHub Action release success.
- ✅ Release: https://github.com/devabutaher/carrybee-extension/releases/tag/v2.1.3 (carrybee-v2.zip attached).
- Note: during rebase onto origin/v2 (v2.1.1), metadata conflicts resolved to v2.1.3 + Carrybee.

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

## Done (v2.1.6 — COD gap fixes, released)
- ✅ "Already" toast detection: any sort-phase toast containing "already" → NOT success → COD batch stops + pendingCheck record (kind 'sort') + ID also saved to consignment list. Row-removal still success.
- ✅ Guard-ID fallback: `idForGuard()` = consignmentId || row data-order-id — used for print locks, pickCodRow skip, pendingCheck save/clear. Unclear ID can never escape popup record.
- ✅ Skip badge wording: `Print unclear — skipped N · processing X/Y`.
- ✅ Released: tag v2.1.6 → workflow success → zip attached.
- ⬜ COD v3 planning (network-evidence) still open.

## Done (v2.1.5 — toast re-record bug fix)
- ✅ "No parcel found" after every sort: v2.1.4's 300ms re-record rule re-fired stale sort toasts → handleManualSortCompletion re-ran → emptied list → badge bug.
- ✅ New recording rules: toast recorded ONLY on (1) newly mounted/re-mounted node (queueNewToastNodes from observer) or (2) text change. Standing stale toasts never re-record. Recycled print toasts still detected (COD fix preserved).
- ✅ Observer: removed early break, feeds queueNewToastNodes; charData still triggers process.
- ✅ Version 2.1.5, built, pushed v2+main (8795a6a). Tag not created yet.
- ⬜ COD v3 planning: Phase 0 logger build (network-evidence design approved by user).

## Done (pending-check release — v2.1.4 code, not yet tagged)
- ✅ Root-cause explanation: toast recorder per-node dedupe ate identical consecutive Sonner toasts (node recycle) → missed print toast → old code treated it fatal → "Print failed" + batch stop.
- ✅ Recorder hardening: node+text dedupe now 300ms window only, recycled nodes re-record; universal `console.log("[Carrybee] toast:")` debug log.
- ✅ Non-fatal print path (COD): print-timeout → pending lock + pendingCheck row (kind 'print') → parcel skipped, batch continues. Fatal only for other real errors.
- ✅ Sort-stuck → pendingCheck row (kind 'sort') + batch stops with badge.
- ✅ New Dexie table `pendingChecks` (schema v3): {id PK, business, kind 'print'|'sort', at}. 3-day TTL prune (hourly alarm + SW startup). NOT touched by daily reset.
- ✅ Popup "⚠ Pending check (N)" section: grouped per business, ID + tag ("print unclear" orange / "sort failed" red) + hint text. Hidden when empty.
- ✅ Auto-cleanup: verified sort success (any mode) → CB_REMOVE_PENDING_CHECK.
- ✅ Badge text: `✓ N sorted · M unclear, K stuck (check popup)`.
- ✅ Version 2.1.4 bumped (package.json, manifest, README), built + zipped, pushed v2 + main (e8800ca). Tag NOT created yet.

## Decisions
- Pending check = user-facing popup record; printLocks stays internal anti-double-print guard (no remark in consignment list — user chose separate table).
- Remark = print verification only; sort-stuck w/ verified print shows "sort failed" kind row.
- Removed stale pendingCheck on any verified sort success.
