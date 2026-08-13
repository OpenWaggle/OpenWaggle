{ clean: false, filesChanged: 0
})).label).toBe('')
  })
```

✓

────────────────────────────────────────────────────────────────────────────────

Here's my complete review:

REVIEW FINDINGS

### MAJOR |
src/renderer/src/features/sidebar/components/__tests__/SessionListItemGitIndicator.c
omponent.test.tsx:45-53 | Test mock shape does not match SidebarSessionActions
interface

The actions() helper provides { onSelect, onArchive, onUnarchive, onDelete,
onRename, onDuplicate, onOpenDiff } but the component's SidebarSessionActions
requires { select, delete, archive, markUnread, clone }. This passes only because
tsconfig.renderer-tests.json has noCheck: true. The component receives undefined for
every action callback and would throw on any user interaction.

Why it matters: The test proves nothing about render-time correctness of action
wiring. If someone adds a click assertion or if the component ever guards on
actions.select existence at render time, this test silently breaks.

Fix: Replace the helper with { select: vi.fn(), delete: vi.fn(), archive: vi.fn(),
markUnread: vi.fn(), clone: vi.fn() }.

────────────────────────────────────────────────────────────────────────────────

### MINOR | src/renderer/src/features/sidebar/hooks/useSessionGitIndicators.ts:23-28
 | Effect re-fetches ALL paths when the set changes, even for a single addition

When one session is added to N existing sessions, the effect re-runs and calls
refreshStatus for all N+1 paths. The main-process 2s TTL cache makes this cheap in
practice (cached hits return immediately), but for 50 worktree sessions the first
mount fires 50 concurrent IPC roundtrips.

Why it matters: Not a correctness bug. For the common case (≤10–15 sessions, many
sharing a project path via local mode) this is negligible. At 50 unique worktrees
it's a brief I/O burst. The cache and per-path stale guard prevent data-level
issues.

Fix (optional): Track previously-fetched paths in a ref and only call refreshStatus
for newly-added paths.

────────────────────────────────────────────────────────────────────────────────

### MINOR | src/renderer/src/features/sidebar/hooks/useSessionGitIndicators.ts |
Non-active session indicators are never refreshed after initial load

useSessionGitIndicators fetches on mount / path-set change. useGitRefresh refreshes
only the active session's working path on agent_end. The onGitWorkingTreeChanged
listener in useGitRefresh also only acts on workingPath === changedPath. So a
non-active session whose turn ends won't have its sidebar indicator updated until
the user switches to it or the session list itself is rebuilt.

Why it matters: Low severity because users interact with the active session, and
switching sessions triggers a list rebuild. But the ADR's framing ("per-session
indicators") might set an expectation of liveness that isn't delivered for
background sessions.

Fix (optional): Have useSessionGitIndicators subscribe to onGitWorkingTreeChanged
for paths in its set, or re-fetch on agent_end for any session in the list.

────────────────────────────────────────────────────────────────────────────────

### CLEAN: Architecture compliance

- Cross-feature imports from sidebar → git are via the public @/features/git index.
  ✓
- resolveSessionWorkingDir lives in @shared/utils/worktree, platform-neutral. ✓
- No process.env in renderer code. No as casts. No biome-ignore / eslint-disable. ✓
- No external reference implementation names anywhere in diff. ✓
- File/function length caps respected (SessionListItem.tsx = 299 lines, under 300).
  ✓
- Pure logic (buildSessionGitIndicator, distinctWorkingPaths) in lib/. ✓

────────────────────────────────────────────────────────────────────────────────

### CLEAN: Rendering correctness

- Unknown status → null → EMPTY_INDICATOR → label '' → component returns null. No
  flicker. ✓
- Loading state (isLoading: true, status: null) also renders nothing. No false
  "clean" badge. ✓
- Map keying prevents session A from overwriting session B's status. ✓

────────────────────────────────────────────────────────────────────────────────

### CLEAN: Effect key soundness

- Separator '\u0000' cannot appear in filesystem paths (NUL byte forbidden on all
  supported OS). ✓
- Paths are sorted, so array identity changes from polling don't cause spurious
  re-fires. ✓

────────────────────────────────────────────────────────────────────────────────

### CLEAN: Stale-response handling

- Per-path request IDs in latestStatusRequestIdByPath correctly reject out-of-order
  responses per working tree. Test 'keeps each working tree independent and ignores
  its own stale responses' covers this with a deferred promise pattern. ✓
- The old statusProjectPath single-slot guard is fully replaced by the per-path
  mechanism. ✓

────────────────────────────────────────────────────────────────────────────────

### ADR 0016 ACCURACY

The ADR has been corrected and is substantially accurate post-implementation.
Remaining notes:

1. Decision 6 paragraph — accurate; explains the correction itself.
2. Known limitation — accurate; useGitRefresh fires on terminal transport events and
   refreshes the active working path. The caveat about non-active sessions is
   implicit but not explicitly stated.
3. Staging section — lists steps 1–4 as staged, all implemented in the commit
   series. ✓
4. Context section "Both pass projectPath" — describes the bug (past tense intent),
   accurate. ✓
5. Minor inaccuracy: The ADR Status line says "accepted (not yet implemented — see
   Staging)" but all 4 staging steps are now implemented. The status should be
   updated to "accepted, implemented" or similar.

────────────────────────────────────────────────────────────────────────────────
