# Session Summary catalog measurements

Measured on 2026-09-08 against implementation commit `5c96871c`, including main's context checkpoint changes at `d0502904`.

## Method

The measurement used the actual Effect-backed SQLite Session Resource repository on an Apple M4 Max, macOS 26.6.2 arm64, Node 24.12.0. The temporary database was outside the repository and contained no user data. Unit tests were running concurrently, so these results include local CPU contention.

Start with the deterministic catalog in `src/main/adapters/__tests__/sqlite-session-resource-pagination.test-harness.ts`. Its primary session has 300 resources and 3,600 occurrences. Add 9,700 source images to that session, each with one user-provided occurrence on its active branch. Keep the fixture's second session and unrelated resource to exercise session confinement. The measured session then has 10,000 resources and 13,300 occurrences.

Within one repository lifetime, run each operation 25 times in sequence using `performance.now()` around the awaited Effect. Discard five warm-up samples, sort the remaining 20 samples, and report the median, nearest-rank 95th percentile, and maximum. Serialize the final result with `JSON.stringify` and measure its UTF-8 byte length. Database creation and seeding are outside the timer.

| Operation | Median | p95 | Maximum | Response |
| --- | ---: | ---: | ---: | ---: |
| First Sources page, limit 20, exact total 9,900 | 0.56 ms | 0.83 ms | 2.49 ms | 9,385 bytes |
| Exact image lookup, resource `scale-9000` | 0.11 ms | 0.14 ms | 0.17 ms | 457 bytes |
| Locate that image, true gallery position and neighbors, total 9,850 | 89.31 ms | 103.34 ms | 106.32 ms | 1,473 bytes |

The measurement asserted the returned page size, exact totals, and resource identity. It did not hydrate the complete catalog into JavaScript.

These are warm local repository timings, not network, IPC, image decoding, or React paint timings. They are evidence for this build and dataset, not a cross-platform latency guarantee. Gallery ranking still depends on the size and branch topology of the catalog; a bounded response does not mean constant-time database work.

## Regression coverage

- `sqlite-session-resource-pagination.unit.test.ts` checks keyset pages, exact totals, bounded occurrence previews, active-path image ordering, cursor invalidation, and request discovery past unrelated Outputs. Its query-plan assertion checks the request index and rejects a temporary sort.
- `sqlite-session-resource-targeted.unit.test.ts` checks exact resource and occurrence lookups, bounded transcript image queries, and occurrence batching.
- Session Resource backfill and extraction tests enforce traversal, per-pass, image-byte, and attachment budgets.
- Session Summary component tests cover retained-sidebar query suppression and session-bound query keys. Electron tests cover floating geometry and session transitions at the interaction boundary.

Use the native Electron and CI evidence alongside these measurements. Do not loosen functional assertions or visual thresholds to meet a timing target.
