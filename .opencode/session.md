# Session Context

Session: COD double-print fix (v2.1.2)
Date: 2026-10-19

## What was done
Full COD-mode rework (see plan.md):
- Double print root cause fixed via 2-level print locks w/ Dexie persistence (3-day TTL)
- Sort verification hardened to 30s deadline, no early break
- Stuck sort → batch stops with clear badge, ID auto-saved to consignment list
- Stop button now graceful (finishes current parcel first)

## Active files
- src/entrypoints/content/index.ts
- src/entrypoints/background.ts
- src/utils/storage.ts

## Next steps
- Load unpacked .output/chrome-mv3 and QA: (1) slow-network sort stall → stuck badge; (2) Stop mid-batch → finishes current parcel; (3) restart batch after stuck → locked row skipped/sort-only.
