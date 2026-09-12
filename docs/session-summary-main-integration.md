# Session Summary integration with terminals and browser previews

The Summary branch incorporates main commit `077e9c04` and app version `v0.3.0-alpha.66`, including session-owned terminals, browser previews, and worktree Setup receipts.

## Session ownership and overlays

The header toggle remains available independently of available chat width. The Summary floats and does not reserve chat width. Automatic display yields to the current Session's inspector or floating browser preview. Explicitly opening the Summary suspends that Session's floating preview, including its native browser view. Closing the Summary restores the retained preview tab. Switching Sessions must not expose the previous Session's preview or resource catalog.

Resources and change-request details participate in the same right-sidebar coordinator as terminals and browser tabs. Opening one claims the inspector without deleting the other Session-owned tabs. Authorization remains in the dock.

Route claims carry their Session scope. A matching inspector suspends the floating preview and marks it as a native-view occluder, so a bounds-observer callback cannot make the native view reappear over the inspector. Closing Resources restores a previously open Summary first. Hiding that Summary restores the retained preview with the same native view identity.

Draft routes use the same `draft:<projectPath>` owner key as browser and terminal tabs, not a raw project path. Diff and file inspectors therefore suspend the matching draft preview before the first message, even though the Summary itself is not shown yet. Another draft's or Session's claim must not affect that preview.

The no-project root route retains a null scope so global extension inspectors can still open before a project is selected. It must not inherit an unrelated workspace's claim.

Draft workspace migration requires a one-use receipt from successful creation of the current draft, not merely a transition from a draft-shaped owner key to a Session ID. Navigation invalidates unused receipts and late creation responses do not steal a newer selection. Both owners are fenced through pending browser work, native migration, and renderer layout transfer. Ordinary navigation preserves both groups. Main-opened Setup terminal reconciliation waits for the fence and follows the committed owner instead of disappearing or recreating the old draft.

After native ownership commits, renderer reconciliation attempts every independent layout, floating-preview, sidebar, focus, and source-owner cleanup step even if a storage write fails. The first failure remains visible; a later cleanup error must not replace it or imply that native ownership rolled back. This protects the current in-memory layout but does not promise durable persistence when the storage backend is unavailable.

Native browser disposal failures receive one retry. Closing a genuinely absent native ID is an idempotent no-op, covering launcher tabs and restored tabs that have not mounted; existing foreign IDs still reject. If any preview still cannot be closed, the entire browser group and its floating state remain in the project draft with that owner's grant intact. Successfully closed previews in the retained group can remount under the same draft owner. Terminal ownership still completes independently, including active side-panel presentation. The error identifies where the browser tabs remain; the consumed creation receipt never triggers an automatic repeat of the native terminal handoff.

Explicit close IPC must wait for native destruction, not just a successful return from Electron's `webContents.close()`. Electron closes these views asynchronously. A live close exception or bounded destruction timeout rejects the operation and preserves the view's ownership for retry. Intentional closure must not emit the unexpected-content-closed error used for external teardown. A native regression injects a close failure, verifies that the same browser tab remains available, then retries through the UI and confirms destruction. Closing a right-panel tab also waits for this result; a failed tab stays available for retry. Successful sibling closures and terminal fallback reconcile independently of persistence failures without masking the first native error or claiming another Session's inspector.

Native viewport emulation waits for the browser view's `dom-ready` event. A restored floating tab can request scaled bounds before its renderer exists; calling Electron's emulation method at that point can crash the main process. Committed main-frame navigation and renderer loss invalidate readiness, while the latest requested viewport, bounds, and zoom remain available for the next ready event. A cancelled provisional navigation leaves the existing document usable. Resetting to fill also disables previously applied emulation after readiness returns. Disposal removes the readiness listeners.

## Database upgrades

Main's migration IDs 26 and 27 remain assigned to worktree Setup dispatch and receipts. Summary lineage starts at 28; Summary resources and indexes continue through 45.

An earlier unreleased Summary build used IDs 26 through 43. Boot recognizes only the exact legacy ID/name pairs and moves their ledger entries by two, highest ID first, in one SQLite transaction. It preserves application timestamps and existing data instead of rerunning those migrations. Unknown destination entries fail closed. Fresh installs and databases from main use the same migration runner.

Regression tests cover old-branch and main databases, partial upgrades, repeated startup, retained resources and Setup receipts, unknown identities, and rollback after a ledger-write failure.

## Deletion safety

Project removal refreshes the confirmed Session set and validates the complete available Hive before deleting any Session. Active Workers, missing descendants, or cycles stop the operation. Eligible Workers are deleted before their parents. A later storage failure stops further deletions and refreshes the lists to reflect any completed work. Project removal is not a project-wide database transaction.

Individual deletion closes admission to new lineage writes and waits for already admitted writes before checking eligibility. New conflicting mutations reject immediately so a cancelled run finalizer cannot wait on its own deletion. The existing run and terminal fences remain in place, and deletion waits for run settlement before removing metadata. Database guards still recheck eligibility. Cleanup after a committed delete is best-effort and must not report the committed metadata as rolled back.

## Verification boundary

Header controls adapt to the header's available width through CSS container queries. Compact layouts keep the Session title and all actions within the window by hiding secondary metadata and collapsing action text to accessible icons. This fixes the Windows shared navigation failure without removing the title-visibility assertion or extending test timeouts. Native QA covers sidebar collapse/restoration at 800, 1024, 1184, and 1600 content pixels; the visual suite separately covers a 720-pixel viewport. Existing Darwin baselines remain unchanged.

Component regressions cover overlay restoration, session isolation, sidebar ownership, and native-view occlusion requests. The native coexistence E2E checks the actual Electron browser view's visibility and identity while operating the Summary and preview controls.

The September 12 macOS retest passed the complete coexistence sequence and all visual baselines, including the request composer and Settings. Provider scenarios passed GitHub ready requests, GitLab draft requests, and unauthenticated browser fallback. Their fake CLI environment now remains first in PATH after desktop login-shell hydration, without changing the app's production shell behavior.

The Linux integration failure on the preceding revision was a PTY fixture surviving its first SIGHUP. Fixture teardown now escalates after one second through the identity-checked native kill and descriptor-close methods. It retains the original ten-second deadline and requires both process exit and successful resource drain before deleting its temporary home. An isolated Linux probe passed 100 runs, including six escalations. A deterministic native regression starts a Bash shell that ignores SIGHUP.

This integration does not merge the unfinished Session Host orchestration branch. Its separate compatibility contract and live integration gate are documented in [Session Summary and Session Host compatibility](session-summary-hive-integration.md).
