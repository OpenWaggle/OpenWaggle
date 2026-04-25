# Pi SDK Migration Sequencing for Issue #87

> Historical migration document. This file records sequencing notes from the old migration and is not the current product/runtime contract. Current behavior is described in `README.md`, `docs/architecture.md`, `docs/system-architecture.md`, and the user guide.

_Status: draft_
_Date: 2026-04-22_
_Issue: #87 — Explore replacing TanStack AI runtime with Pi as the agent kernel_

## Purpose

Define an implementation sequence with milestones, risk ordering, and acceptance checkpoints for the Pi migration.

## Sequencing principles

- Resolve highest architectural leverage first.
- Replace runtime and persistence foundations before doing visual polish.
- Reuse current UX behavior where explicitly requested.
- Avoid parallel migrations that depend on each other’s unfinished abstractions.
- Preserve hexagonal architecture at every step: Pi SDK must be introduced via adapters/ports, never as a direct dependency of application services, IPC handlers, or shared IPC/domain types.

---

# Milestone 1 — Pi runtime foundation

## Goal
Replace TanStack runtime execution with Pi-native session runtime for standard single-agent flows.

## Deliverables
- Pi-backed main-process run service
- new OpenWaggle-native runtime event protocol
- renderer no longer depends on TanStack `useChat` transport assumptions
- first-send persistence preserved

## Risks reduced
- TanStack runtime dependency
- AG-UI stream-shape coupling
- continuation behavior coupled to TanStack quirks

## Acceptance checkpoint
- Standard send works in the app via Pi runtime
- first-send failure still leaves a durable session in history
- no regressions in composer feel or basic send flow

---

# Milestone 2 — Session/tree projection schema

## Goal
Introduce the new SQLite session/node/branch projection model.

## Deliverables
- DB migrations for sessions/nodes/branches
- repositories/projector over new schema
- Pi session origin projected into SQLite

## Risks reduced
- flat conversation model lock-in
- inability to support Pi-native tree UX honestly

## Acceptance checkpoint
- full Pi session tree can be represented in SQLite
- active session/branch/node are readable from DB

---

# Milestone 3 — Tree-first navigation

## Goal
Ship the new session sidebar + branch tree + active-node transcript path model.

## Deliverables
- double-left-sidebar layout
- branch tree navigation
- root-to-active-node transcript rendering
- tree UI persistence (expand/collapse, active branch)

## Risks reduced
- hidden flattening of Pi tree semantics
- late UI rewrite after runtime is already entrenched

## Acceptance checkpoint
- users can switch sessions and branches confidently
- transcript always matches active node/path

---

# Milestone 4 — Transcript truthfulness

## Goal
Render structural/system nodes, tool chronology, compaction summaries, and branch divergence truthfully.

## Deliverables
- structural/system node rendering
- live tool timeline rendering
- branch divergence markers
- compaction/branch summary transcript rows

## Risks reduced
- misleading transcript abstraction
- hidden runtime behavior

## Acceptance checkpoint
- transcript accurately reflects the projected node graph and tool chronology

---

# Milestone 5 — Waggle on Pi

## Goal
Rebuild Waggle runtime on Pi while preserving standard-mode behavior everywhere else.

## Deliverables
- thick Pi-native Waggle runtime/extension
- two-agent sequential-only v1
- waiting-for-user + resume semantics
- branch-scoped future mode/config in product DB
- truthful Waggle attribution in transcript/tree

## Risks reduced
- current Waggle runtime drift from UI truth
- TanStack-era Waggle transport assumptions

## Acceptance checkpoint
- Waggle can be toggled per branch
- Waggle writes to same canonical branch path
- surrounding UX behaves like standard mode

---

# Milestone 6 — Context simplification

## Goal
Remove the old context/pinned complexity and keep only Pi-native essentials.

## Deliverables
- context meter
- manual compact action
- removal of pinned context/messages and context inspector UX

## Acceptance checkpoint
- compaction UI is lightweight and Pi-aligned
- no pinned context dependencies remain in runtime or renderer

---

# Milestone 7 — Provider/auth/settings cleanup

## Goal
Finalize Pi-native backend truth for provider/model/auth while preserving curated OpenWaggle settings UX.

## Deliverables
- Pi-aligned provider/auth wiring
- truthful settings surfaces
- compact model picker preserved

## Acceptance checkpoint
- settings behavior matches Pi capabilities
- model/provider/auth flows still feel coherent in OpenWaggle

---

# Milestone 8 — Delete legacy runtime debris

## Goal
Remove remaining TanStack files, docs, and dead code.

## Deliverables
- delete patches/adapters/devtools/docs
- remove obsolete continuation and stream-mapping layers
- prune deprecated learnings/docs references

## Acceptance checkpoint
- build/test graph is TanStack-runtime free
- docs describe Pi-native architecture only

---

# Recommended PR / implementation slicing

## Slice 1
Runtime boundary + IPC contract

## Slice 2
DB schema + projector + repositories

## Slice 3
Renderer tree navigation + transcript base

## Slice 4
Waggle runtime on Pi

## Slice 5
Context simplification + provider/settings cleanup + deletions

This keeps the high-risk dependency order sane.

---

# Verification plan by milestone

## Renderer/main/IPC touching milestones
Must include:
- React Doctor if renderer touched
- Electron QA in the real app
- targeted prompt matrix for standard send / branch navigation / Waggle if relevant

## Persistence milestones
Must include:
- projector/repository tests
- startup/reload/reconciliation scenarios
- first-send failure durability scenario

## Waggle milestone
Must include:
- standard mode parity smoke checks
- waiting-for-user resume check
- branch inheritance of future mode/config
- active run lock/unlock config behavior

---

# Stop-and-grill rule

If implementation reveals a real conflict in any of these areas, stop and re-open grilling only for that specific conflict:
- Pi JSONL runtime persistence assumptions
- Pi session/tree event availability vs projector design
- branch identity derivation from Pi tree in ways that affect product semantics
- Waggle runtime metadata needed for truthful UI that Pi cannot emit cleanly

Otherwise proceed without reopening settled product questions.
