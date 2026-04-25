# Pi SDK Migration Discovery Log

> Historical migration document. This file records discovery state from the TanStack-to-Pi migration and is not the current product/runtime contract. Current behavior is described in `README.md`, `docs/architecture.md`, `docs/system-architecture.md`, and the user guide.

_Status: in progress_
_Date: 2026-04-22_
_Purpose: preserve grill-me decisions and migration findings before context compaction or interruption._

## Core migration stance

- Treat the migration as a **full cleanup**, not a compatibility bridge.
- OpenWaggle is a **Pi-powered desktop product shell**, not a TanStack-shaped app with Pi hidden underneath.
- Pre-user product: prefer clean breaks over compatibility scaffolding.
- Remove deprecated TanStack-era behavior instead of preserving it for sentimentality.

## Architectural ownership

### Pi owns at runtime
- Agent execution kernel
- Session/runtime continuity
- Tools/runtime truth
- Provider/model/auth runtime logic
- Skills/extensions/prompts/resources runtime model
- Compaction behavior and policy
- MCP/spawn-agent implementation model where possible

### OpenWaggle owns
- Electron shell
- Renderer/UI
- Typed IPC
- Canonical SQLite persistence (product projection)
- Settings/product UX
- Session/tree/transcript product model
- Waggle semantics and UX

## Persistence and runtime projection

- OpenWaggle DB remains canonical product truth.
- Persist the **full Pi session tree projection** in SQLite.
- Use a **generic typed node graph** as canonical persistence shape.
- Use **Pi node IDs as the primary node identity** wherever possible.
- Use a **full event projector as the primary persistence path**.
- Use **periodic/checkpoint reconciliation only for repair**.
- Do **not** persist raw Pi event logs by default.
- Session creation happens on first user send, not before.
- Session remains even if the first run fails.

## Session / branch / tree model

- Fully embrace Pi session-tree semantics.
- Tree-first UX from day one.
- Full interleaved navigable node sequence appears in the tree.
- Structural/system nodes are preserved and visible.
- Structural/system nodes also appear in the transcript as differentiated system/timeline items.
- Main transcript always represents the **current working context**.
- Clicking a tree node immediately changes working context.
- Transcript shows the **full path from session root** to the selected node.
- Active node should always be auto-revealed and ancestor-expanded in the tree.
- Users can manually collapse/expand the tree.
- Tree expansion/collapse state is remembered per session and persisted across restarts.

## Session and branch UX

- Left sidebar 1: sessions.
- Left sidebar 2: branch/session tree for the active session only.
- Second sidebar is dynamic: it always reflects the selected session.
- Second sidebar is collapsible.
- Toggle lives visibly in the main sidebar chrome, Codex-style.
- Keyboard shortcut: Cmd/Ctrl+B.
- Branch/sidebar header remains visible and session/branch context remains visible when collapsed.
- Branches sidebar is hidden until there is any branch beyond `main`.
- Once branching exists, sidebar appears.
- Session rows show session name + subtle active branch label.
- Sessions sidebar rows stay single-line.
- Branch tree rows also stay single-line.

## Naming

### Sessions
- Auto-name from plain user message text.
- No LLM naming.
- Truncate to fit UI.
- Users can manually rename sessions.

### Branches
- Initial branch is reserved `main`.
- `main` is non-deletable and non-renamable.
- New branches auto-name from the **source node they branched from**:
  - if user node, use user text
  - if assistant node, use assistant text
- Users can manually rename branches.

### Rename UX
- Use existing 3-dots menu pattern.
- Rename triggers inline input.
- Confirm with Enter or checkmark.
- Rename updates everywhere immediately.

## Branching behavior

- Branching from tree nodes should immediately activate the new branch.
- Clicking a node in the tree immediately navigates to that working context.
- Transcript remains a working-context view, not an inspection mode.
- Branching can also be initiated from transcript items when Pi semantics allow it.
- OpenWaggle may add UX sugar such as “send as new branch” as long as it compiles down to Pi-native branch semantics.
- “Send as new branch” should create a **child of the current active leaf/path**.
- Tree semantics should stay aligned with Pi.

## Deletion and archival

### Branch deletion
- Deleting a branch deletes the **whole subtree** under it.
- No modal/double confirmation.
- UI must clearly state that deleting the branch deletes all child branches beneath it.
- If deleting the active branch subtree, activate the nearest surviving parent branch.
- `main` cannot be deleted.

### Session archival
- Archival remains a product feature.
- Archival is **session-level only**.
- No branch-level archival.

## Transcript redesign

- Transcript UX should be rethought deeply, not merely ported.
- Shared history vs branch-specific history should be visually distinguished.
- Use a branch-start marker plus persistent subtle branch-specific styling after divergence.
- Shared history can be somewhat more subdued.
- Tool calls are individual and chronological.
- Never semantically group tool calls to hide activity.
- If there are 100 tool calls, show 100 tool call items.
- Tool calls appear when invoked, not only when finished.
- Tool items update live while running.
- Tool items are collapsed by default, even while running.
- Users can inspect any tool call at any time, during or after execution.
- Preserve current auto-scroll behavior if it already works; do not change unrelated stable UX in this migration.

## Context / compaction / pinned state

- Pi owns compaction behavior and policy.
- OpenWaggle owns the UI/presentation around compaction.
- For the migration, keep only:
  - context meter
  - manual compact action
- Remove for now:
  - context sidebar / inspector
  - pinned messages / pinned context
  - richer compaction guidance UX
- Postpone richer context features to a later Pi-native extension-backed issue.
- Context meter stays compact, always visible, near the composer/lower chrome.
- Context meter semantics should be primarily **usage / headroom**.
- Use Pi-style information content (percentage + context window), but OpenWaggle’s own visual asset (fillable SVG gauge).
- Example desired semantics: `86.6% / 272k`.

## Providers / models / auth UX

- Pi is runtime truth for provider/model/auth logic.
- OpenWaggle keeps a curated, polished settings UX on top.
- The current single compact model selector interaction should remain broadly familiar.
- Users should still see models across providers in one selector.
- Repeated models across providers/routes are acceptable if enabled.
- Settings must reflect what Pi can truly provide; no fake capability promises.
- OpenWaggle should expose Pi concepts fairly directly in the product and docs where appropriate.

## Docs / learnings / lessons cleanup

- Website and internal docs must be updated to reflect Pi-native runtime and session/tree model.
- After migration, do a hard prune of `docs/learnings.md` and `docs/lessons.md`:
  - remove TanStack-specific or deprecated-runtime entries
  - remove flat-thread/old continuation assumptions
  - keep enduring engineering and behavioral rules that still apply

## Waggle mode

### What Waggle is
Waggle is OpenWaggle’s structured multi-agent collaboration mode: two distinct agents work on the same problem in visible turns, can challenge each other, and converge through a synthesis step.

### First principles of Waggle
- Waggle is **not just generic subagents**.
- Shared problem, distinct perspectives.
- Turn-taking is the control structure.
- User must be able to understand who did what.
- Synthesis is essential, not decorative.
- Constructive disagreement is part of the value.
- Shared workspace requires explicit conflict visibility.
- Waggle is for hard problems where collaboration improves outcomes.
- User authority still matters.

### Migration direction
- Waggle should remain an **OpenWaggle-owned structured collaboration feature**.
- Rebuild it on top of Pi-native primitives.
- Do not collapse it into generic Pi orchestration behavior.

## Deleted / removed / simplified systems to expect

### Remove outright
- TanStack AI runtime integration
- TanStack AI patches
- TanStack AI React/useChat integration
- Continuation repair layers tied to TanStack behavior
- TanStack-specific stream chunk mappers / connection adapters
- TanStack AI devtools surfaces
- Current context inspector / pinned context system for now

### Rebuild / replace
- Main agent runtime boundary
- Shared stream/runtime IPC contracts
- Renderer chat/session/transcript state
- Provider/model/auth settings backend
- Session persistence schema
- Orchestration path that still depends on TanStack
- Waggle implementation over Pi primitives

## Still-open topics to continue grilling

1. Detailed Waggle UX/architecture in Pi-native world
2. Manual compact UX specifics
3. Provider/settings capability audit against Pi
4. Session/tree node rendering details in transcript and sidebar
5. Future extension-backed context features issue framing
6. Exact schema/read-model design for session/node graph
7. Migration phasing / execution plan

## Numbered grill decisions locked so far

- Q1: OpenWaggle SQLite remains canonical, not Pi JSONL as product truth.
- Q2: Renderer becomes fully OpenWaggle-owned; remove TanStack chat runtime.
- Q3: Drop AG-UI as a target constraint; use OpenWaggle-owned Pi-oriented runtime protocol.
- Q4: Drop AG-UI as target constraint in favor of thinner OpenWaggle-native protocol.
- Q5: Remove approval and plan mode initially.
- Q6: Initial capability posture = full Pi-style access.
- Q7: Pi’s built-in tool/runtime model is the runtime truth first.
- Q8: MCP + spawn agents should primarily be implemented as Pi-native extensions/resources.
- Q9: Adopt Pi’s resource model directly where possible.
- Q10: Pi runtime truth for providers/models/auth, with polished OpenWaggle UX on top.
- Q11: Pi session continuity is runtime truth; DB stores product projection.
- Q12: Persist a thin product projection, not full runtime mirror.
- Q13: Store stable Pi session reference in SQLite.
- Q14: Expose Pi branching/tree semantics directly.
- Q15: Full tree-first UX from day one.
- Q16: Use explicit Session + Branch model rather than preserving thread terminology.
- Q17: Branch tree sidebar should be hierarchical from day one.
- Q18: Active session + branch always visible when branches sidebar is collapsed.
- Q19: New branch becomes active immediately.
- Q20: Clicking a node navigates immediately.
- Q21 revised: Allow UX sugar like “send as new branch” if aligned with Pi semantics.
- Q22: Send-as-new-branch creates child of current active leaf/path.
- Q24: Sessions and branches auto-named; no LLM naming.
- Q25: Branch name comes from source node branched from.
- Q26: Session sidebar row shows session name + active branch label.
- Q27: Session sidebar rows are single-line.
- Q28: Branch rows are single-line too.
- Q29: Switching sessions restores that session’s last active branch.
- Q30: Initial branch name is `main`.
- Q31: Users can rename both sessions and branches.
- Q32 revised: Rename via 3-dots action menu, inline input.
- Q33: Branch rows get their own 3-dots action menu.
- Q34: Branch deletion removes whole subtree.
- Q35: After deleting active subtree, activate nearest surviving parent.
- Q36: `main` cannot be deleted.
- Q37: `main` cannot be renamed.
- Q38 refined: Support Pi’s node model including structural/system nodes and IDs.
- Q39 corrected: Show all relevant nodes in tree, but visually differentiate node types.
- Q40: Show full interleaved node sequence in tree.
- Q41: Main transcript is always current working context.
- Q42: Transcript shows full path from session root.
- Q43: Tree auto-scrolls/reveals active node.
- Q44: Tree auto-expands ancestor chain to reveal active node.
- Q45: Users can manually collapse/expand tree.
- Q46: Remember tree expansion/collapse per session.
- Q47: Persist tree expansion/collapse across restarts.
- Q48: Do not create empty sessions before first send.
- Q49: No branch tree before first send.
- Q50: Nothing appears in sessions sidebar before first send.
- Q51: Session appears in sidebar immediately on first send.
- Q52: Session remains even if first run fails.
- Q53: Branch sidebar hidden until branching complexity exists.
- Q54 inferred: Show branches sidebar as soon as anything beyond `main` exists.
- Q55+ several obvious UX defaults were inferred rather than asked.
- Q78: Pi owns compaction behavior/policy.
- Q79: Keep only context meter + manual compact; remove context sidebar/pins for now.
- Q80: Context meter remains compact and always visible near composer.
- Q81: Context meter primarily communicates usage/headroom.
- Q82: Keep single compact model selector behavior.
- Q83: Keep curated OpenWaggle provider/model settings UX over Pi backend truth.
- Q84: Waggle remains OpenWaggle-owned structured collaboration rebuilt on Pi primitives.
- Q85: First Pi-native Waggle remains explicitly two-agent, not generalized N-agent orchestration.
- Q86: Waggle operates as a mode within the current canonical session/tree, not as hidden multi-session orchestration.
- Q87: Implement Waggle as a thick Pi extension for runtime mechanics, while OpenWaggle remains responsible for product UX/presentation and persistence projection.
- Q88: Waggle v1 uses a max-turn ceiling with early stop allowed; turn count is not a guaranteed exact number of turns.
- Q89: Early stop is decided by Waggle runtime policy based on structured signals, including agent recommendations, not only by explicit bilateral agent agreement.
- Q90: “Needs user input” is a first-class Waggle runtime outcome/state (`waiting-for-user`), not merely a transcript-level question.
- Q91: When Waggle is `waiting-for-user`, the user reply is rendered in the normal transcript position and automatically resumes the same Waggle run/mode unless the user explicitly turns Waggle off first.
- Q92: Turning Waggle off affects only future assistant behavior; it does not implicitly cancel an in-flight Waggle run. Stopping/cancelling is a separate explicit action.
- Q93: Waggle mode is scoped at the branch level; different branches may have different future-run modes.
- Q94: New branches inherit the parent branch’s future mode by default, including Waggle-enabled state.
- Q95: Child branches inherit the full future-run Waggle configuration by default (enabled state, team/preset, max-turn ceiling, collaboration mode, and relevant branch-scoped settings), but the user can change it afterward.
- Q96 clarified: The composer represents the current branch state only. Changing Waggle mode/config from a branch composer must not affect other branches. After inheriting Waggle config into a child branch, the user can change the Waggle mode/config again inline (for example via `/`) before sending from that branch.
- Q97: Changing Waggle config via `/` in the composer persists as the branch’s future-run setting until changed again; it is not a one-shot override.
- Q98: `/` should remain a generic slash command system; Waggle is a first-class command group within it whose selections can persistently mutate branch mode/config.
- Q99 revised: Waggle v1 configuration is edited through a simple visible branch-scoped UI control in the composer chrome, not via `/`. Once a Waggle run starts, that branch’s visible Waggle config is locked for the duration of the run and unlocks again after completion/stop so the user can adjust it for future runs.
- Q100: If Waggle is enabled on a branch but not currently running, the composer should still show a persistent visible Waggle state/control so the branch mode is always clear and editable before sending.
- Q101: Reuse the current preset-first Waggle configuration model to reduce migration scope. In v1, the branch composer should remain lightweight: preset/team selection plus max-turn editing, while deeper team customization stays in Settings or a richer editor later.
- Q102: Standard-mode and Waggle-mode turns both write into the same canonical Pi branch path. Enabling Waggle must not create an automatic hidden sub-branch or separate run branch.
- Q103: Branch future mode/config is OpenWaggle-owned product metadata in the DB/projection, not Pi-owned runtime truth. Pi executes runs; OpenWaggle owns branch-level future-mode state for composer/UI/persistence behavior.
- Q104: Unless explicitly decided otherwise, Waggle should preserve standard-mode behavior across surrounding product integrations (composer feel, settings, diffs, git integration, and related UX). The only intentional behavioral difference is the two-agent Waggle runtime itself.
- Q105: Pi session creation is the first identity event. OpenWaggle projects product sessions from Pi-native session origin rather than inventing a separate pre-Pi session identity.
- Q106: For the first full migration, keep Pi JSONL as internal runtime persistence for migration safety. OpenWaggle SQLite remains canonical product truth and Pi JSONL stays an implementation detail, not product truth.
- Q107: Project-local runtime config and project-local resources should be user-facing under `.openwaggle/`, not `.pi/`. Migrate to `.openwaggle/settings.json` with OpenWaggle-owned top-level settings plus a nested `pi` object for Pi runtime settings. Project-local skills, prompts, extensions, and related resources should also live under `.openwaggle/` and be wired into Pi through custom storage/loader adapters.
- Q108: Support legacy project-local Pi-era directories without making them primary. Discovery/config precedence should be `.openwaggle/` first, then `.pi/`, then `.agents/`. Do not force migration in v1; just support loading them.

## Notes for continuation

- Scope discipline: keep migration focus on Pi migration/runtime, Waggle runtime, sessions/trees/branches, and the integrations that must keep working with the new model (composer, settings, diff changes, git integration).
- Treat current presets/team configuration as stable unless a Pi-native runtime constraint forces a change.
- Preserve current user-facing behavior where possible; change only what must change to support the Pi-native runtime/tree model and the decisions already locked.
- Continue grilling on Waggle details next.
- Do not re-ask obvious questions already implied by prior decisions.
- Use this file as the continuity anchor if context compacts or the session is interrupted.
