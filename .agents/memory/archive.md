# Archive

Entries moved out of active memory because the code they describe is gone: the merge-queue
CI tiers (superseded by ADR 0033), the removed Electron Playwright E2E suite and its probes
(`OpenWaggleApp`, diff-performance E2E), and the ESLint half of the old lint setup.
Do not load by default; read only for the history behind a removed code path.

## CI is tiered behind a merge queue (ADR 0029, September 2026 — superseded by ADR 0033; see "Merge queue removed" below. Retained for history.)

A 2026-09-01 audit of ~300 CI runs (~36h) found 51% green / 21% failed / 27% cancelled, with 85% of failures concentrated on three agent PRs. The enforced merge gate was only three ubuntu checks; the 3-OS E2E matrix and package rehearsals ran informationally per push, so agents burned multi-hour loops on reds that never gated merges. Windows E2E failed 33% of runs — two-thirds of failures were "all 29 tests pass, then `Worker teardown timeout of 90000ms`" (a hanging shutdown, not a test problem), the rest Windows-timing test timeouts and locator misses. `hive-sessions.e2e.test.ts` on PR #181 failed 8× consecutively on a JSON parse race: `applicationCliStdout` returns raw stdout when its extraction grammar does not match, so a leading `{}` empty payload plus trailing content explodes in `JSON.parse`.

Fixes shipped: Fast gate per push (static checks split into Unit / Integration & Component / MCP Conformance jobs + macOS E2E with `retries: 2` and `PLAYWRIGHT_WORKERS: '2'`), Full gate on `merge_group` results (adds Windows/Linux E2E plus path-scoped rehearsals: package consumer smoke when `packages/**`/lockfile/release tooling changed; website/docs rehearsal when website/docs **or package** surfaces changed). `scripts/package-release-gate.ts` encodes tier semantics (`full|fast|fast-no-e2e|visual`); required-but-skipped is an error, skipped-conditional is fine. `e2e/support/electron-process-tree.ts` bounds `app.close()` at 10s, names surviving descendants into `$GITHUB_STEP_SUMMARY`, and force-kills the tree (`taskkill /T /F` on Windows) — a safety net whose forensics feed the root-cause hunt for non-clean Windows exits. The settings-side half (enable merge queue + update the required-check list to the new job names) is a maintainer runbook step in `docs/release-and-versioning.md`. It must be applied in the same admin window as the merge: the rename retires the `Unit & Component Tests` context, so between merge and ruleset swap open PRs show a forever-pending required check until an admin applies the swap or merges with the routine bypass.

## Electron E2E launches ignore a running dev app, but a dirty tree blocks checkouts

`OpenWaggleApp.launch` sets `OPENWAGGLE_DISABLE_SINGLE_INSTANCE=1`, so a running `pnpm dev` instance does not steal E2E launches. Two things do bite:

## Filed under "Electron Runtime Memory"

- Electron Playwright E2E requires isolated user data and single-instance lock opt-out when another OpenWaggle instance is running.

## Filed under "Syntax And Workspace Editing Memory"

- Diff performance E2E starts inside the panel toggle's capture listener, records Pierre's first shadow-root readiness through the light-DOM `data-diff-code-ready` contract, and keeps measuring until progressive patch preparation completes. Long-task entries are selected by interval overlap because the browser task that dispatches the click starts just before the listener timestamp. A body-level code query cannot see Pierre's shadow rows, and falling back to the time when Playwright finishes polling charges startup, runner descheduling, and test-driver delay to diff rendering.
- Right-sidebar performance checks must target the shared visible panel marker, not the docked shell: narrower or DPI-scaled viewports use the sheet variant, and a docked-only locator reports missing feedback even while highlighted code is visible.
- During timed renderer work, poll visibility or completion values without locator-expect ARIA diagnostics. A hosted Windows CPU profile traced 4.6-second long tasks to Playwright's `_ariaSnapshotForExpect` / `generateAriaTree` while preparation was pending, not OpenWaggle rendering. `expect.poll` with `isVisible()` or `count()` preserves the assertions and existing performance limits without that injected traversal.
- Playwright CSS locators still traverse shadow descendants for `count()` and `isVisible()`. The Windows Full run on `8c1f86af` sampled 500–740 ms in injected CSS queries even after removing ARIA diagnostics. Timed diff probes now use native light-DOM queries and inspect only the first diff container's shadow code, preserving visibility and completion checks. Profiles also contain application rendering/layout work, so probe overhead alone does not establish that the Windows performance failure is fixed; confirm against fresh hosted CI without relaxing budgets.

## Filed under "Product And UX Memory"

- Session-selection E2E readiness must match the mounted route surface's Session ID to the selected sidebar row, not just the header title and composer visibility. Sidebar selection updates the store before routing commits, so the outgoing surface can briefly show the new title/transcript before its lazy route replacement. Workspace hydration remains an independent boundary and must not be awaited by the shared navigation helper (delayed-hydration tests intentionally hold it).

## Filed under "Tooling Memory"

- TypeScript 7 uses Oxlint with tsgolint for type-aware TypeScript rules. ESLint remains for repository-specific, TanStack, and import-cycle rules; transitive `@typescript-eslint/*` utilities come from those third-party plugins and are not OpenWaggle's TypeScript parser.

## Filed under "Startup compatibility needs persisted-profile tests"

The same Enter rule applies to direct preload `writeTerminal` calls in Electron E2E. A replacement-shell usability probe that appends LF can successfully write bytes on Windows without submitting its command. Preserve the real restart, generation, offset, and marker assertions; send CR as xterm does for Enter.
