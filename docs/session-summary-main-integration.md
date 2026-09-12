# Session Summary integration with terminals and browser previews

The Summary branch incorporates main commit `7a4388f9`, including session-owned terminals, browser previews, and worktree Setup receipts.

## Session ownership and overlays

The header toggle remains available independently of available chat width. The Summary floats and does not reserve chat width. Automatic display yields to the current Session's inspector or floating browser preview. Explicitly opening the Summary suspends that Session's floating preview, including its native browser view. Closing the Summary restores the retained preview tab. Switching Sessions must not expose the previous Session's preview or resource catalog.

Resources and change-request details participate in the same right-sidebar coordinator as terminals and browser tabs. Opening one claims the inspector without deleting the other Session-owned tabs. Authorization remains in the dock.

Route claims carry their Session scope. A matching inspector suspends the floating preview and marks it as a native-view occluder, so a bounds-observer callback cannot make the native view reappear over the inspector. Closing Resources restores a previously open Summary first. Hiding that Summary restores the retained preview with the same native view identity.

## Database upgrades

Main's migration IDs 26 and 27 remain assigned to worktree Setup dispatch and receipts. Summary lineage starts at 28; Summary resources and indexes continue through 45.

An earlier unreleased Summary build used IDs 26 through 43. Boot recognizes only the exact legacy ID/name pairs and moves their ledger entries by two, highest ID first, in one SQLite transaction. It preserves application timestamps and existing data instead of rerunning those migrations. Unknown destination entries fail closed. Fresh installs and databases from main use the same migration runner.

Regression tests cover old-branch and main databases, partial upgrades, repeated startup, retained resources and Setup receipts, unknown identities, and rollback after a ledger-write failure.

## Deletion safety

Project removal refreshes the confirmed Session set and validates the complete available Hive before deleting any Session. Active Workers, missing descendants, or cycles stop the operation. Eligible Workers are deleted before their parents. A later storage failure stops further deletions and refreshes the lists to reflect any completed work. Project removal is not a project-wide database transaction.

Individual deletion closes admission to new lineage writes and waits for already admitted writes before checking eligibility. New conflicting mutations reject immediately so a cancelled run finalizer cannot wait on its own deletion. The existing run and terminal fences remain in place, and deletion waits for run settlement before removing metadata. Database guards still recheck eligibility. Cleanup after a committed delete is best-effort and must not report the committed metadata as rolled back.

## Verification boundary

Component regressions cover overlay restoration, session isolation, sidebar ownership, and native-view occlusion requests. The native coexistence E2E checks the actual Electron browser view's visibility and identity while operating the Summary and preview controls.

The September 12 macOS retest passed the complete coexistence sequence and all visual baselines, including the request composer and Settings. Provider scenarios passed GitHub ready requests, GitLab draft requests, and unauthenticated browser fallback. Their fake CLI environment now remains first in PATH after desktop login-shell hydration, without changing the app's production shell behavior.

The Linux integration failure on the preceding revision was a PTY fixture surviving its first SIGHUP. Fixture teardown now escalates after one second through the identity-checked native kill and descriptor-close methods. It retains the original ten-second deadline and requires both process exit and successful resource drain before deleting its temporary home. An isolated Linux probe passed 100 runs, including six escalations. A deterministic native regression starts a Bash shell that ignores SIGHUP.

This integration does not merge the unfinished Session Host orchestration branch. Its separate compatibility contract and live integration gate are documented in [Session Summary and Session Host compatibility](session-summary-hive-integration.md).
