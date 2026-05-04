# Pi Migration Remaining Work

_Status: active implementation spec_
_Last updated: 2026-05-04_
_Replaces audited/deleted historical specs:_

- `docs/specs/pi-sdk-migration-blueprint.md`
- `docs/specs/pi-sdk-migration-discovery.md`
- `docs/specs/pi-sdk-migration-execution-plan.md`
- `docs/specs/pi-sdk-migration-sequencing.md`
- `docs/specs/pi-sdk-session-projection-spec.md`

## Purpose

This spec records the remaining work needed to finish the Pi-native migration after reconciling historical migration specs, current implementation, Pi TUI behavior, and product decisions.

The runtime migration is mostly complete: Pi is already the runtime kernel, provider/model/auth state is Pi-derived, `.openwaggle/settings.json` bridges Pi settings, SQLite session projection tables exist, Pi snapshots are persisted, and renderer routes can select session branch/node context. The remaining work is product/projection/UI completeness over Pi sessions.

## Source constraints

Implementation must stay faithful to:

- `docs/first-principles.md`
  - Pi is the runtime kernel.
  - Runtime capabilities come from Pi first.
  - OpenWaggle owns typed IPC, renderer UI state, and SQLite product projection.
  - Product state must be an explicit projection over real Pi sessions/nodes/branches.
- `docs/hexagonal-architecture.md`
  - Pi SDK imports stay confined to `src/main/adapters/pi/`.
  - IPC/application code depends on OpenWaggle-owned ports and DTOs.
  - Persistence changes go through ports/adapters instead of direct IPC-to-store imports.
- `docs/lessons.md`
  - Mirror Pi TUI/SDK behavior by default.
  - Do not show the full Pi node tree in the left sidebar.
  - Do not introduce Waggle-only branch semantics.

## Explicit non-goals

Do not revive deleted runtime/product surfaces:

- no removed vendor-runtime chat transport
- no deprecated external stream-shape contract
- no old flat-message SQLite tables as product truth
- no removed context side-panel/pinned-context system
- no legacy tool-gating product flow
- no permanent second branch sidebar
- no fake projection-only branch deletion that makes SQLite disagree with Pi session truth

---

## Implementation order

1. **Standard-mode session/branch contract**
   - ✅ session/branch projection metadata
   - ✅ branch archive/rename and sidebar navigation semantics
   - ✅ right-side Session Tree shell, filters, route slot, and persisted expanded state
   - ✅ draft branch lifecycle, including send-time Pi materialization and scoped composer drafts
   - ✅ composer-integrated branch summary flow
   - transcript action parity remains: full node-backed branch-out matrix plus Pi-style fork/clone triggers
2. **Shared tests as contract**
   - write mode-parameterized branch behavior tests that run for `standard` now and remain skipped/TODO for `waggle` until Waggle is Pi-extension backed.
3. **Hotkeys foundation and consolidation**
   - ✅ add `@tanstack/react-hotkeys`
   - ✅ implement Session Tree shortcuts with it
   - ✅ consolidate app-level/global renderer keydown handlers that were suitable for TanStack Hotkeys in this phase.
4. **Resource precedence hardening**
   - ✅ enforce `.openwaggle > .pi > .agents` for skills, prompts, themes, and extensions inside the Pi adapter.
5. **Retry/compaction/durability parity**
   - surface Pi retry/compaction events inline
   - persist/reconcile interrupted active runs without auto-resuming after process death.
6. **Waggle Pi-extension phase**
   - refactor Waggle away from separate app-level orchestration into Pi extension/in-session behavior.
   - Waggle must pass the same branch behavior contract as standard mode.
7. **Session-native naming cleanup**
   - after behavior stabilizes, migrate conversation-shaped APIs/names toward session-native surfaces.

---

## 1. Left sidebar session/branch navigation

### Required behavior

The left sidebar is navigation-first. It shows projects, sessions, materialized branches, and transient draft branch rows only. It must never show the full Pi node graph.

- Sessions with only `main` show only the session row.
- Sessions with multiple non-archived materialized branches show branch rows for all sessions, not only the active session.
- `main` appears as a branch row only once a session has more than one materialized branch.
- Branch rows are ordered by current stable projection order: `main` first, then other branches in stable creation/projection order.
- Session row click keeps current behavior: open the session's last active branch; fallback to `main`/nearest valid branch if unavailable.
- Branch row click navigates to that branch head/full conversation.
- Branch lists are collapsible per session via a small chevron on the session row.
- Collapsed/expanded branch-list state persists per session in `session_tree_ui_state.branches_sidebar_collapsed`.
- A transient draft branch auto-expands its owning session while the draft exists.
- A collapsed session row may show a subtle active-branch chip/label; header remains the strongest active context display.
- Archived branches are hidden from normal left-sidebar navigation and do not produce archived-count badges in the main sidebar.

### Draft branch rows

- Draft rows remain allowed in the left sidebar as immediate feedback.
- Current placement is preserved: draft row appears at the top of the owning session's branch list before materialized branches.
- Draft row is visually dashed/muted and contextual.
- Draft row updates or disappears when the user clicks around without materializing work.
- Draft row becomes durable only after materialization by send or branch-summary creation.
- Draft branch context is not restored across app reload/restart.

### Branch row actions

- Branch row actions open from a hover-revealed three-dots overflow button.
- Non-main branch actions:
  - Rename
  - Archive
- Branch rename is inline in the sidebar row.
- Branch rename is left-sidebar only in v1.
- `main` is not renamable.
- Archive action on `main` is treated as archive-session. If other active branches exist, warn that archiving main archives/hides the full session and all branches.
- Archive branch/session actions are left-sidebar only.
- Restore is only possible from Settings archived section.

### Archive/delete semantics

- Session archive is supported.
- Session delete is supported.
- Branch archive/restore is supported as OpenWaggle projection/UI metadata.
- Branch delete is not supported until Pi exposes native subtree/branch deletion.
- Archived branches remain in the full Session Tree because Pi session truth is append-only.
- Archived branch state is an overlay/badge, not a Session Tree filter.
- Settings archived section groups archived branches under owning sessions/projects.
- Restoring a branch does not auto-navigate; it makes the branch visible again.
- If archiving the active non-main branch, navigate to `main` or the closest available branch; product requirement is simply not to leave the user stranded on a hidden branch.

### Implementation status

Implemented in the current branch:

- SQLite tracks branch archive state with `session_branches.archived_at`.
- `listSessions()` projects non-archived branches for sidebar navigation and preserves manual branch names/archive state across Pi reprojection.
- IPC/preload/repository APIs support branch rename/archive/restore and tree UI state updates.
- Left sidebar renders branch rows for all sessions, persists branch-list collapse state, supports inline non-main rename, archives non-main branches, and maps main archive to session archive.
- Settings archived section lists archived branches grouped by project/session and restores them without navigation.

### Acceptance criteria

- Branch rows render for every session with multiple non-archived branches.
- Single-main sessions stay compact.
- Branch collapse state persists per session.
- Draft row appears at the top of the owning session's branch list and disappears when draft context clears.
- Rename preserves manual branch names across later Pi snapshots.
- Archiving a branch hides it from sidebar but leaves it visible in Session Tree.
- Restore from Settings makes a branch visible without auto-navigation.

---

## 2. Right-side Session Tree panel

### Required behavior

The full Pi node graph belongs in an explicit right-side Session Tree panel opened from a header tree icon. This mirrors Pi TUI `/tree` as an on-demand navigation surface.

- Session Tree shares the existing right-side panel slot with Diff.
- Right panel mode is one of: `null | 'diff' | 'session-tree'`.
- Only one right-side panel can be open at a time.
- Header tree icon opens Session Tree.
- Command/action system exposes `Open Session Tree`.
- Use OpenWaggle design system, not raw ASCII art.
- Preserve tree semantics with indentation, connector lines, active-path markers, keyboard focus, compact rows, muted structural nodes, and badges.

### Filters

Ship the full Pi tree filter set in v1:

- `Default`
- `No tools`
- `User only`
- `Labeled`
- `All`

The selected filter persists globally through Pi `treeFilterMode` settings, matching Pi TUI. Do not create a separate per-session OpenWaggle filter preference in v1.

Archived branch state is an overlay; it does not add a sixth filter.

### Tree state and markers

- Expanded/collapsed node state persists per session in SQLite (`session_tree_ui_state.expanded_node_ids_json` plus `expanded_node_ids_touched` so first-open defaults can expand the tree without breaking explicit collapse-all persistence).
- Active materialized branch path is visually distinct from selected draft/preview path.
- Suggested semantics:
  - active materialized path: solid accent marker
  - draft/preview path: dashed or secondary accent marker
  - inactive paths: neutral/muted
  - archived branch heads/path: muted plus `Archived` badge

### Keyboard and hotkeys

Use `@tanstack/react-hotkeys` for new renderer/global keyboard shortcuts.

Minimum Session Tree keyboard behavior:

- Arrow up/down: move focused node
- Arrow left: collapse expanded node or move to parent
- Arrow right: expand collapsed node or move to first child
- Enter: select focused node
- Escape: close panel

The same phase must add the TanStack Hotkeys foundation and consolidate suitable existing app-level/global keyboard handlers. Component-local editor/listbox interactions can remain with their owning component/editor systems when appropriate.

### Implementation status

Implemented in the current branch:

- Route search supports `panel: 'diff' | 'session-tree'`; Diff and Session Tree share the same right-side slot.
- Header tree icon and command palette action open the Session Tree.
- Session Tree renders OpenWaggle-styled graph rows with connector rails, interactive node dots, active/draft/archive/branch badges, expand/collapse controls, and Pi filter modes. The renderer builds a Pi-like visible tree model: filter-hidden ancestors are transparent, active-path children are ordered first, single-child chains stay on the same rail, and indentation appears only around real branch points.
- Session Tree controls keep the toolbar focused on Pi filter select plus deferred node search; the shared OpenWaggle scroll-to-bottom affordance appears as the same center-bottom overlay pattern used by the chat transcript only when tree content is scrollable and the user is away from the bottom.
- Filter mode persists globally through Pi `treeFilterMode` settings via Pi adapter-backed IPC.
- Expanded node ids persist per session through `session_tree_ui_state.expanded_node_ids_json`; untouched sessions default to all parent nodes expanded, while explicit user collapse state is preserved by `expanded_node_ids_touched`.
- Session Tree keyboard support uses `@tanstack/react-hotkeys` for Arrow up/down/left/right, Enter, and Escape.

### Acceptance criteria

- Header icon opens/closes the Session Tree panel.
- Diff and Session Tree never render as stacked right sidebars.
- Docked right-side panels open and close with the same width-clipping motion model as the left sidebar.
- Docked right-side panels clamp opened width so the chat transcript remains visible on non-fullscreen windows and keep the closing panel content mounted so Diff cannot flash while Session Tree closes.
- Full filter set works and persists through Pi setting.
- Search narrows visible nodes without blocking typing, searches persisted node content/branch ids even when a renderer message object is not hydrated, preserves matching ancestors for orientation, and temporarily expands result paths so matches hidden under collapsed nodes remain visible.
- Expanded node state survives panel close/reopen and app restart.
- Keyboard navigation works and is accessible.
- Archived branches remain visible with archived state.

---

## 3. Node selection, draft context, and materialization

### Selection rules

- Selecting/clicking an existing materialized branch head navigates to that branch and clears draft state.
- Selecting/clicking a non-head node creates or updates an OpenWaggle transient draft context.
- Non-head selection changes the transcript to root → selected node.
- Non-head selection does not mutate Pi until the draft materializes, except when branch summarization is explicitly chosen.
- Clicking around updates/clears the single transient draft context for that session.
- Switching session/project clears unsent draft branch context.
- Draft branch context is not deep-linked and is not restored across restart.

### User-node retry/edit parity

Mirror Pi TUI `navigateTree()` behavior:

- selecting a user message treats the branch point as the parent node and pre-fills composer with the user message text for retry/edit.
- selecting assistant/tool/summary/other branchable nodes continues from after that node with a blank composer unless an existing scoped draft should be restored.

Actual Pi navigation still waits until materialization, except summary materialization.

### Transcript behavior in draft context

- Draft context transcript shows only root → selected-node path.
- Do not show downstream original branch content dimmed.
- If the user wants the old downstream path, they can navigate back to the materialized branch or open Session Tree.

### Branch summary materialization

Branch-summary choice mirrors Pi tree-navigation timing: it happens when the draft is created, not when the user sends.

When selecting a non-head node that abandons downstream content from the current branch:

- If Pi `branchSummary.skipPrompt` is false, the composer enters branch-summary decision mode.
- If skip-prompt is true, default to `No summary` and keep the draft transient.
- If no downstream content exists, do not show the summary choice.

Composer-integrated summary choices:

- `No summary`
  - keep draft transient until send
  - restore normal composer with preserved prompt
- `Summarize`
  - call Pi navigation/summarization immediately
  - materialize the branch after summary completes
  - restore normal composer with preserved prompt
- `Summarize with custom prompt`
  - reuse the composer input for summary instructions
  - submit routes to Pi branch summarization, not normal chat send
  - materialize branch after summary completes
- `Cancel` / Escape
  - cancel draft and restore previous materialized context

If the user sends from a transient draft, materialize the branch by navigating Pi to the selected node/options first, then sending the message.

### Implementation status

Implemented in the current branch:

- Selecting a materialized branch head from Session Tree navigates to that branch and clears draft state.
- Selecting a non-head node from Session Tree creates a transient OpenWaggle draft context and refreshes the transcript to the selected path without immediate Pi mutation.
- Branching from a user message uses the parent node as the draft source and pre-fills the composer with the original user text, matching Pi retry/edit direction.
- Branch-summary choice appears when draft creation abandons downstream content and honors Pi `branchSummary.skipPrompt`.
- `No summary` keeps the draft transient; `Summarize` and custom summary instructions call Pi navigation immediately and materialize the branch before send.
- Cancel/Escape restores the previous materialized context and previous composer text.
- Composer drafts are scoped by project/session/branch/draft context, preserved across navigation, cleared for sent/deleted/archived contexts, and restored only for matching live contexts.
- Sending from a transient draft navigates Pi to the selected source before sending, then clears the draft state.

Still remaining:

- shared mode-parameterized branch behavior contract tests

### Acceptance criteria

- Selecting non-head nodes creates draft context without Pi mutation unless summary is chosen.
- Summary choice appears at draft creation, composer-integrated.
- `No summary` remains transient.
- `Summarize`/custom summary materializes a real branch before send.
- Cancel restores previous branch context and composer text.
- Sending from draft materializes branch and clears draft state.

---

## 4. Transcript branching, fork, and clone actions

### Same-session branch-out

The chat transcript must show a Git branch-out affordance everywhere the user can validly branch out.

Show `Branch from here` on visible branchable rows that map to real Pi session nodes:

- user message rows
- assistant message rows
- visible tool rows/results represented as Pi nodes
- branch summary rows
- compaction summary rows
- visible structural/timeline rows with real node ids

Do not show branch-out on UI-only rows:

- welcome screen
- loading/streaming phase indicators
- run summaries
- error banners
- hidden internal Waggle coordination entries
- separators with no Pi node id

Branch icons appear on hover/focus in the existing row action cluster, not always visible and not inside markdown content. Keyboard users must be able to reach the action.

Branching from transcript does not auto-open Session Tree.

Current implementation status:

- Implemented: branch-out for user and assistant message rows backed by visible transcript messages.
- Remaining: distinct node-backed branch actions for visible tool-result rows, branch-summary rows, compaction-summary rows, and any future structural/timeline rows that map to real Pi nodes.
- Remaining: Pi-style fork and clone actions below.

### Pi-style fork to new session

Pi `/fork` creates a new session from before a previous user message and pre-fills composer with that user message text.

OpenWaggle triggers:

- user message row action: `Fork to new session`
- composer slash command: `/fork`
- command palette: `Fork to new session…`

`/fork` and command palette action open a previous-user-message selector. A direct user-message row action skips the selector.

Only user message rows show `Fork to new session`. Assistant/tool/summary rows do not.

### Pi-style clone to new session

Pi `/clone` duplicates the current session at the current position.

OpenWaggle triggers:

- left-sidebar session overflow: `Clone to new session`
- composer slash command: `/clone`
- command palette: `Clone to new session`

Command palette clone uses current active session/branch/node context. Sidebar clone is row-scoped; mirror Pi mechanics first, and if a non-active row cannot safely clone without switching runtime state, disable it with a truthful explanation.

If the user is in a transient draft context, clone uses the currently visible draft path/current position and does not first materialize a same-session branch.

### Acceptance criteria

- Branch and fork are visually distinct on user-message rows.
- Branch from here creates same-session draft context.
- Fork to new session creates a new session and pre-fills composer with the selected user message text.
- Clone to new session duplicates current/row-scoped position into a new session.
- `/fork` and `/clone` mirror Pi semantics.

---

## 5. Composer draft preservation

### Required behavior

Never destroy in-progress user intent already typed in the composer.

- Composer drafts are scoped to concrete project/session/branch/draft context, not global app state.
- On navigation, save current context draft and load target context draft so prompts do not leak across projects/sessions/branches.
- Lifecycle actions like archive/restore/delete do not directly mutate the visible composer except through resulting navigation.
- Materialized branch drafts persist across in-app navigation in renderer state.
- Composer drafts are not restored after app restart in the current implementation; transient draft branch context also does not persist across restart.
- If transient draft context clears, restore/preserve composer text according to the materialized context the user returns to.
- Attachments are part of composer intent and follow the same in-memory context scoping where safe; do not persist attachment capabilities across restart without the memory-safe attachment rules.
- Archived conversations/sessions/branches do not restore old unsent composer drafts later; restoring archive restores history, not old unsent prompts.
- If a stored draft belongs to a deleted session/branch, it is removed from persistence. This cleanup must not be confused with clearing the currently visible composer unless deletion causes navigation.

### Acceptance criteria

- Typed composer text survives branch-summary mode cancellation/materialization.
- Composer text does not leak from one project/session/branch into another during navigation.
- In-app navigation restores materialized branch draft text and in-memory attachment metadata for the matching context.
- Composer drafts, including transient draft context, are not restored after restart in this phase.

---

## 6. Structural/timeline transcript rendering

### Required behavior

The default chat transcript remains conversational/product-relevant:

- user messages
- assistant messages
- tool activity/results as currently supported
- branch summaries
- compaction summaries
- branch/draft context indicators

Low-level structural Pi entries are not shown in the default transcript:

- `model_change`
- `thinking_level_change`
- `session_info`
- `label`
- `custom`

Those entries remain available in the Session Tree through filters such as `All` and `Labeled`.

Branch summaries and compaction summaries should render as distinct product/timeline rows, not plain assistant bubbles.

### Acceptance criteria

- Default transcript does not become noisy with bookkeeping entries.
- Branch/compaction summaries are visually distinct.
- Hidden internal Waggle custom prompts remain hidden.
- Session Tree can expose structural nodes through filters.

---

## 7. Branch-scoped future mode and Waggle

### Standard branch config

- Composer represents the active branch state.
- Future mode/config changes on one branch do not affect other branches.
- Child/draft branches inherit parent mode/config at draft creation.
- Materialized branch state persists through SQLite branch state.

### Waggle target architecture

Waggle is a later phase after standard-mode branch semantics are complete and tested.

Target:

- Waggle implemented as Pi extension/in-session behavior rather than separate runtimes.
- Waggle uses the same Pi session/tree/projection path as standard mode.
- Everything agreed for standard-mode branches applies equally to Waggle:
  - branch navigation
  - draft creation/materialization
  - transcript branch-out
  - archive/restore
  - fork/clone semantics
  - active-run semantics
- Waggle-specific differences:
  - independent branch-scoped run configuration
  - transcript UX coloring/attribution

### Tests

Create mode-parameterized branch behavior tests:

- run for `standard` immediately
- include skipped/TODO `waggle` cases until Waggle is Pi-extension backed
- unskip Waggle once implemented and require the same branch behavior contract to pass

### Acceptance criteria

- Standard branch behavior has contract tests before Waggle refactor.
- Waggle implementation later passes the same contract with only config/color/attribution differences.

---

## 8. Project-local resource precedence

### Required behavior

Effective project resource precedence is:

```text
.openwaggle > .pi > .agents
```

Applies to:

- skills
- prompts
- themes
- extensions

Implementation must stay confined to `src/main/adapters/pi/`.

### Implementation status

Implemented in the current branch:

- Pi project settings storage injects project resource roots in `.openwaggle`, `.pi`, `.agents` order for skills, prompts, themes, and extensions.
- The Pi resource loader is configured from those ordered paths in the Pi adapter.
- Implicit precedence roots are stripped again when Pi project settings are persisted so `.openwaggle/settings.json` does not accumulate adapter-added defaults.
- Unit coverage verifies same-name skill collisions prefer `.openwaggle` while existing setting persistence behavior remains truthful.

### Acceptance criteria

- Same resource id/name in all three locations resolves to `.openwaggle`.
- Removing `.openwaggle` falls back to `.pi`, then `.agents`.
- Skill toggles still apply where OpenWaggle owns catalog state.
- Diagnostics/source info remain truthful.

---

## 9. Pi retry, compaction, and interrupted-run durability

### Retry and context overflow

Mirror Pi native behavior:

- Pi retryable provider/runtime errors emit `auto_retry_start` / `auto_retry_end`.
- OpenWaggle surfaces retry inline, not in a modal.
- Inline retry row/banner uses OpenWaggle design system and exposes cancel mapped to Pi `abortRetry()`.
- Final failure uses normal error UI.
- Context overflow recovery is separate from normal retry and surfaces as inline compaction/recovery status.
- Manual compaction remains slash-command based: `/compact` and `/compact <custom instructions>`.

### Interrupted runs after process death

If OpenWaggle restarts and finds active run records:

- reconcile latest Pi session snapshot into SQLite
- mark run as interrupted
- do not auto-resume after process death
- show compact icon indicator on affected session/branch rows
- show inline notice when opened
- no startup modal/toast storm
- clear the interrupted indication when user dismisses the inline notice or sends a new message from the affected branch

Live provider/runtime errors while app is alive still use Pi auto-retry.

### Acceptance criteria

- Retry countdown/cancel appears inline and follows Pi settings.
- Context overflow recovery is visible inline.
- Restart after interrupted run reconciles product projection and shows compact interrupted indication without auto-resume.

---

## 10. Session-native naming cleanup

This is last, after functional behavior stabilizes.

Current conversation-shaped surfaces remain:

- `conversations:*` IPC
- `Conversation` DTOs
- `SessionProjectionRepository`
- `activeConversationId` renderer naming

Required direction:

- add session-native IPC/state names before removing old names
- keep compatibility shims isolated and temporary
- avoid reviving old flat-message storage or runtime semantics

---

## Verification requirements

For each implementation slice:

1. Follow TDD vertical slices: one behavior test, minimal implementation, refactor.
2. Prefer public-interface/integration-style tests over implementation mocks.
3. Run targeted tests for the touched slice.
4. Run `pnpm typecheck` or narrower typecheck as the slice grows.
5. Run `pnpm check:architecture` for main-process changes.
6. If renderer code is touched:
   - run React Doctor diagnostics
   - run Electron QA via MCP against the real app after static checks pass
7. Keep this spec and relevant user docs truthful as behavior lands.
