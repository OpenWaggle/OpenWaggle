---
title: "Hives and sessions"
description: "Split a task across independent worker sessions, choose their workspaces, and review the results."
order: 1
section: "Multiple agents"
---

Use a Hive when a task has parts that can be assigned to independent agents. For example, one agent can investigate a bug while another reviews the related tests. This is optional; a normal conversation is enough for many tasks.

A Hive is a family of sessions. The session that starts it is the **Queen**; its descendants are **Workers**. These names describe lineage, not blanket authority. A Worker can create more Workers when permitted, and the Queen does not automatically gain permission to control every session.

Each Worker is a saved, independent session with its own transcript, active run, message queue, model settings, and workspace. It can continue after the Queen's current run ends. Workers appear in the normal sidebar. The header shows the Hive role and optional [agent definition](/docs/extending/agent-definitions).

For two agents taking sequential turns in the *same* conversation, use [Waggle Mode](/docs/using-openwaggle/waggle-mode) instead.

![A Queen Session coordinating three Worker Sessions in the OpenWaggle sidebar and Session Summary](/screenshots/hive-sessions.png)

_The Queen and all three Workers remain ordinary Sessions in the left sidebar. The Session Summary's Hive section shows Worker state and provides quick navigation._

## Try a Hive

Start in a normal Session and ask the agent to split a concrete job:

```text
Create two Workers to investigate this repository's login flow.
Have one trace the implementation and one review the tests for missing cases.
Do not edit files or commit anything. Give each Worker the relevant paths.
Review their findings here and identify which claims are supported by code or tests.
```

The current Session becomes the Queen. OpenWaggle creates each Worker as a durable Session, adds it to the normal sidebar, and keeps its Run active when you navigate elsewhere. Workers report results to their parent agent. The Queen reviews those reports and returns one combined answer in the original Session.

You can keep working in the Queen Session while Workers run. The Hive section in Session Summary shows which direct Workers are active and which have finished; it is a navigation and status view, not a separate approval queue. If a Worker needs a correction, tell the Queen what to change. The parent agent can request a revision of that Worker's submission. You can also open any Worker Session and talk to it directly.

Click a Worker in the sidebar or the Session Summary's Hive section to inspect its full transcript. In a Worker Session, the same section links back to its immediate parent. Collapsing the section hides these shortcuts without hiding or stopping any Session. The Summary is available even before a newly spawned Worker has sent its first message.

The Queen's summary is a starting point for review, not a substitute for the Worker transcripts, changed files, or test results. Instructions such as "do not edit" are not access controls. Check each session's approval settings before assigning work, and remember that concurrent Workers can make separate billable provider calls.

## Workspace placement

Workers share the parent's exact workspace by default. They can read and change the same files you and other sessions are using. For independent edits, ask for a **new worktree** and give each Worker a clear scope. A separate worktree isolates the checkout; it does not grant new filesystem or Git permissions.

You can also choose a specific local checkout. Launches and forks have explicit workspace choices too. OpenWaggle does not silently substitute another checkout when a worktree is missing.

A new worktree can run configured workspace preparation before the agent starts. Setup must finish successfully, or receive an explicit continue decision, before execution proceeds. If setup has failed or its previous result is uncertain, inspect **Workspace preparation** in Session Summary rather than repeatedly sending the task. See [Project actions](/docs/configuration/project-actions) for preparation and managed-run controls.

Sharing a workspace makes it harder to attribute changes. OpenWaggle records advisory scope claims and conflicts, but those claims do not lock files. Review overlapping edits yourself.

## Session and message actions

A **run** is one active execution of the agent in a session. Use a **Follow-up** for work that should start after it finishes; use **Steer** for guidance that belongs in the current run. Steer does not cancel a tool already running.

These names have precise meanings in the GUI, CLI, MCP adapter, and native `sessions` tool:

| Action | Meaning |
|---|---|
| **Create** | Create an idle independent root Session. It has no initial Run. |
| **Launch** | Atomically create an independent root Session and start its first Run. |
| **Spawn** | Atomically create and start a Worker beneath a parent, including its lineage and Delegation Contract. |
| **Fork** | Create a new Session from a stable point in an existing transcript. |
| **Message** | Adaptive convenience action: start immediately when idle, otherwise append a durable Follow-up. |
| **Start** | Start a new Run on an idle Session. It never queues behind an active Run. |
| **Follow-up** | Submit a durable, separate next Run. It remains queued while the current Run finishes; if that Run has just settled, it starts immediately as the next Run. |
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

When you promote a Follow-up, its preview moves into the conversation while the Host processes it. During compaction it shows that it is waiting. Acceptance can precede delivery while a tool is still running, so the preview remains until the actual user message arrives. Switching Sessions does not discard it. If the Host refuses the promotion, the Follow-up remains in its queue.

## Authorization and capacity

A child inherits the parent's execution profile by default. Any specialization can keep or reduce approval, tool, MCP, and native Session capabilities; it cannot widen them through the Sessions API. `YOLO (Full access)` is available only when the caller and resolved authorization ceiling already permit it.

Session capabilities constrain the native `sessions` tool and authenticated Session Host requests. They are not an operating-system sandbox. A Worker that still has an unrestricted shell, process access, and the same desktop-user credentials can act with that user's authority outside the native tool, including calling the CLI directly. For strong containment, remove shell/process tools from the Agent definition or run the agent in a separate OS sandbox, account, or container. Named CLI profiles are useful for attribution and least privilege only when the caller cannot also access the owner's credentials.

**Settings > Agents > Hive controls** contains **Agent-created Workers**, **Workers per parent**, default `4`, and **Active agent runs**, default `16`. These control agent-created sessions, concurrent direct Workers under one parent, and the app-wide active run limit. Both limits are configurable without a fixed product maximum; high values may strain the machine or provider. A new Run at capacity receives a retryable rejection, not a queued slot. These limits count active Runs, not saved Sessions, queues, searches, exports, waits, or watchers.

## Delegation lifecycle

Each spawn creates one durable Delegation Contract. The Worker submits a revision with evidence; the parent agent normally reviews it, asks for revision, or accepts it. The GUI shows state and navigation but does not make the human approve every submission. A normally completed Worker that did not submit explicitly receives a host-captured submission so its result is not lost.

Use [Agent Definitions](/docs/extending/agent-definitions) for optional reusable roles. No definition is required: the parent agent may decide the Worker approach for each assignment.

## How hosted agents coordinate

An agent running inside OpenWaggle uses its native `sessions` tool. It can list or search available Agent definitions, then spawn a Worker with a specific objective, an optional definition, and an explicit Workspace choice. Without a definition, the Worker is a normal agent. A spawned Worker starts with its own context: the parent must include the task and any necessary references rather than assuming the Worker can see the parent's transcript.

After spawning, the parent can use `wait` for a bounded observation, read the Worker's Session or Delegation history, and review its submitted revision. The native tool's `wait` is not a permanent subscription; external CLI/MCP clients can use `watch` for a continuing event stream. The parent may ask for revision or accept the submission. An agent can use `report` to pass context to its parent, the Queen, or another Worker without starting a Run in the recipient. A user can ask a Worker to report a finding upstream; no separate reporting UI is required.

Keep a later instruction as a **Follow-up** when it should start after the current Run. Use **Steer** only when it belongs in that exact active Run. Navigating between Sessions does not interrupt either Run. See the [Sessions CLI](/docs/developer-workflow/sessions-cli) for the corresponding external-agent commands.

## External control and live UI updates

The Session Host is the local process that owns session execution and saved state. The desktop app, CLI, MCP server, and native agent tool all use it. A CLI-created Worker therefore appears in the GUI sidebar, and queue, Run, request, delegation, and lineage changes update open windows through the Host event stream. If an event cursor is too old or the Host restarts, clients reload a canonical snapshot before continuing.

An agent already running in OpenWaggle uses the native `sessions` tool directly rather than spawning the CLI. External coding agents use the [Sessions CLI](/docs/developer-workflow/sessions-cli) or the versioned `openwaggle_sessions` MCP tool.

### Older Hive history

Sessions created by the older MCP task feature keep their parent and Worker links after the one-time Session Host upgrade. These historical relationships support navigation, not new control permissions or delegation grants. New Workers use the current delegation model.

## Related guides

- [Sessions CLI](/docs/developer-workflow/sessions-cli) covers discovery, messaging, waiting, watching, transcript reads, and exports for external agents.
- [Agent Definitions](/docs/extending/agent-definitions) explains optional Markdown roles and capability restrictions for Workers.
- [App Settings](/docs/configuration/app-settings) covers Hive controls, Worker limits, active Run capacity, and permissions.
- [Session Recovery](/docs/configuration/session-recovery) explains the one-time alpha migration and recovery behavior.
