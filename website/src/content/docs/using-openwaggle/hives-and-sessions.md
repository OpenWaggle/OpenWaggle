---
title: "Hives & Sessions"
description: "Spawn independent agent Sessions, coordinate Workers, and choose the right message action."
order: 2
section: "Using OpenWaggle"
---

OpenWaggle can run several independent agent Sessions through one local Session Host. A connected family of spawned Sessions is a **Hive**. Its root is the **Queen Session** and every descendant is a **Worker Session**. Queen and Worker describe lineage, not authority: a Worker can spawn more Workers, and the Queen does not receive automatic permission to control everything.

Every Worker is a normal durable Session with its own transcript, Run lifecycle, queue, model settings, and Workspace binding. Workers appear in the existing flat Session sidebar rather than in a separate orchestration panel. A `ChessQueen` icon marks a Hive root and a `Pickaxe` icon marks a Worker; the tooltip identifies the relationship. The Session header shows its Hive role and optional Agent definition. The collapsible Hive block above the composer links to the immediate parent and direct Workers without duplicating their transcripts.

![A Queen Session coordinating three Worker Sessions in the OpenWaggle sidebar and Hive navigator](/screenshots/hive-sessions.png)

_The Queen and all three Workers remain ordinary Sessions in the left sidebar. The expanded Hive block above the composer shows Worker state and provides quick navigation._

## Try a Hive

Start in a normal Session and ask the agent to split a concrete job:

> Create a Hive to prepare the Sessions release. Have one Worker verify queue and steering behavior, another check CLI and GUI synchronization, and a third review the user guide. Use separate worktrees where edits may overlap. Review their reports here and ask for revisions when evidence is missing.

The current Session becomes the Queen. OpenWaggle creates each Worker as a durable Session, adds it to the normal sidebar, and keeps its Run active when you navigate elsewhere. Workers report results to their parent agent. The Queen reviews those reports and returns one combined answer in the original Session.

Click a Worker in the sidebar or the Hive block to inspect its full transcript. In a Worker Session, the Hive block links back to its immediate parent. Collapsing the block hides these shortcuts without hiding or stopping any Session.

## Session and message actions

These names have precise meanings in the GUI, CLI, MCP adapter, and native `sessions` tool:

| Action | Meaning |
|---|---|
| **Create** | Create an idle independent root Session. It has no initial Run. |
| **Launch** | Atomically create an independent root Session and start its first Run. |
| **Spawn** | Atomically create and start a Worker beneath a parent, including its lineage and Delegation Contract. |
| **Fork** | Create a new Session from a stable point in an existing transcript. |
| **Message** | Adaptive convenience action: start immediately when idle, otherwise append a durable Follow-up. |
| **Start** | Start a new Run on an idle Session. It never queues behind an active Run. |
| **Follow-up** | Append a durable next Run to the Session queue. It remains queued while the current Run finishes. |
| **Steer** | Append guidance to one exact active Run without interrupting it. It requires that Run's identity. |
| **Replace** | Interrupt one exact active Run and start the supplied message as a new Run. |
| **Promote** | Remove one queued Follow-up and deliver it as Steering to the exact active Run. |
| **Withdraw** | Remove a pending Follow-up before delivery. |
| **Reorder** | Change pending Follow-up order against an expected queue revision. |
| **Pause / Resume** | Stop or restart automatic delivery of queued Follow-ups. Pausing does not interrupt a Run. |
| **Interrupt** | Stop one exact active Run without starting another. |
| **Wait** | Perform one bounded observation until a Session condition is reached or the timeout expires. It uses Host events internally but does not create a persistent subscription or consume an agent Run slot. |
| **Watch** | Stream authorized Session Host events, with a cursor for reconnect and resynchronization. |
| **Report** | Deliver explicit context upstream, to the Queen, or to a named Worker without starting or steering a Run. |
| **Handoff** | Move a Session to another authorized Workspace binding. |
| **Export** | Stream or create a Markdown, JSONL, or bundle artifact from an authorized transcript scope. |

Pi's internal steering queue is an adapter detail. The durable **Follow-up queue** above is the product queue: it survives renderer disconnects and host recovery, can remain pending after the active Run, and is delivered one entry at a time when resumed.

## Workspace placement

Spawning defaults to sharing the parent's exact Workspace. Choose a new worktree when Workers should edit independently, or local placement for a specific local checkout. Launches and forks have equivalent explicit choices. A Session never silently falls back from a missing worktree to another checkout.

Sharing a Workspace improves coordination but does not make file authorship unambiguous. OpenWaggle records advisory Delegation scope claims and conflicts; an isolated worktree provides stronger attribution. Workspace placement does not grant new filesystem or Git authority.

## Authorization and capacity

A child inherits the parent's execution profile by default. Any specialization can keep or reduce approval, tool, MCP, and native Session capabilities; it cannot widen them through the Sessions API. `YOLO (Full access)` is available only when the caller and resolved authorization ceiling already permit it.

Session capabilities constrain the native `sessions` tool and authenticated Session Host requests. They are not an operating-system sandbox. A Worker that still has an unrestricted shell, process access, and the same desktop-user credentials can act with that user's authority outside the native tool, including calling the CLI directly. For strong containment, remove shell/process tools from the Agent definition or run the agent in a separate OS sandbox, account, or container. Named CLI profiles are useful for attribution and least privilege only when the caller cannot also access the owner's credentials.

Settings > Agent Access controls whether hosted agents may launch or spawn Sessions, the maximum active direct Workers per parent (default `4`), and the app-wide active Run ceiling (default `16`). These limits count active Runs, not saved Sessions, queues, searches, exports, waits, or watchers.

## Delegation lifecycle

Each spawn creates one durable Delegation Contract. The Worker submits a revision with evidence; the parent agent normally reviews it, asks for revision, or accepts it. The GUI shows state and navigation but does not make the human approve every submission. A normally completed Worker that did not submit explicitly receives a host-captured submission so its result is not lost.

Use [Agent Definitions](/docs/extending/agent-definitions) for optional reusable roles. No definition is required: the parent agent may decide the Worker approach for each assignment.

## External control and live UI updates

The Electron app, CLI, MCP server, and in-process agent tool all use the same Session Host authority. A CLI-created Worker therefore appears in the GUI sidebar, and queue, Run, request, delegation, and lineage changes update open windows through the Host event stream. If an event cursor is too old or the Host restarts, clients reload a canonical snapshot before continuing.

An agent already running in OpenWaggle uses the native `sessions` tool directly rather than spawning the CLI. External coding agents use the [Sessions CLI](/docs/developer-workflow/sessions-cli) or the versioned `openwaggle_sessions` MCP tool.

## Related guides

- [Sessions CLI](/docs/developer-workflow/sessions-cli) covers discovery, messaging, waiting, watching, transcript reads, and exports for external agents.
- [Agent Definitions](/docs/extending/agent-definitions) explains optional Markdown roles and capability restrictions for Workers.
- [App Settings](/docs/configuration/app-settings) covers agent access, Worker limits, active Run capacity, and Session Host controls.
- [Session Recovery](/docs/configuration/session-recovery) explains the one-time alpha migration and recovery behavior.
