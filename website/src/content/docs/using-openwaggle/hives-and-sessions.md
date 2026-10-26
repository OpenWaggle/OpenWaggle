---
title: "Hives and sessions"
description: "Split a task across independent worker sessions, choose their workspaces, and review the results."
order: 1
section: "Multiple agents"
---

Use a Hive when a task has parts that can be assigned to independent agents. For example, one agent can investigate a bug while another reviews the related tests. This is optional; a normal conversation is enough for many tasks.

A Hive is a family of sessions. The session that starts it is the **Queen**; its descendants are **Workers**. These names describe lineage, not blanket authority. A Worker can create more Workers when permitted, and the Queen does not automatically gain permission to control every session.

Each Worker is a saved, independent session with its own transcript, active run, message queue, model settings, and workspace. It can continue after the Queen's current run ends. Workers live in the **Hive** panel, a built-in Right panel surface, rather than the left sidebar. The header shows the Hive role and optional [agent definition](/docs/extending/agent-definitions).

For two agents taking sequential turns in the *same* conversation, use [Waggle Mode](/docs/using-openwaggle/waggle-mode) instead.

![A Queen Session with the Hive panel open on the right: a tree of its Workers, one under the Worker that spawned it, each with its workspace and a State that says who acts next](/screenshots/hive-sessions.png)

_The Queen stays in the left sidebar; the Hive panel on the right lists the whole Hive from the Queen down, each Worker under the Session that spawned it._

## Try a Hive

Start in a normal Session and ask the agent to split a concrete job:

```text
Create two Workers to investigate this repository's login flow.
Have one trace the implementation and one review the tests for missing cases.
Do not edit files or commit anything. Give each Worker the relevant paths.
Review their findings here and identify which claims are supported by code or tests.
```

The current Session becomes the Queen. OpenWaggle creates each Worker as a durable Session, lists it in the Hive panel, and keeps its Run active when you navigate elsewhere. Workers report results to their parent agent. The Queen reviews those reports and returns one combined answer in the original Session.

You can keep working in the Queen Session while Workers run. The Hive row in Session Summary counts the direct Workers by who acts next: those that need you, those waiting for this Session, those working, and those closed. It is a navigation and status view, not a separate approval queue. If a Worker needs a correction, tell the Queen what to change. The parent agent can request a revision of that Worker's submission. You can also open any Worker Session and talk to it directly.

Open the **Hive** panel from the chess queen icon on the Panel rail (or select the **Hive** row in the Session Summary). It is available for any Session in a Hive and lists every Session of that Hive from its Queen down, at any depth, as a table of **Session**, **Workspace** and **State**. By default it is a tree: each Worker sits under the Session that spawned it, and a parent shows how many Workers it has. Collapse a parent with its arrow; while collapsed it still shows how many of its Workers need you and, muted, how many wait for an agent, and the panel remembers it. Archived Workers are hidden and counted on their parent until you turn on **Show archived**. With the keyboard, the arrow keys move through the tree and open or close a parent, and Enter opens a Session. Click a row to open that Session; the panel stays open so you can move across the Hive. While a Worker is open, its Queen's sidebar row keeps a secondary highlight.

### Who acts next

Each row's **State** says who acts next and why. **By next actor** groups the same Sessions that way, each deeper row naming its parent as **Spawned by** with a link to it:

![The Hive panel's By next actor view: a Needs you group with a stuck Worker, Waiting for groups for the Queen and for a Worker with a Worker of its own, then Working and Closed, with archived Workers folded at the end](/screenshots/hive-next-actor.png)

_**By next actor** groups the Hive into Needs you, Waiting for ‹parent› (one group per parent), Working and Closed._

| Group | Who acts next | What a row says |
| --- | --- | --- |
| **Needs you** | you | Waiting for your approval · Waiting for your answer · Stuck — no agent will pick it up |
| **Waiting for ‹parent›**, for example **Waiting for Queen** | the agent that spawned the Worker | Ready for review · Run failed, ‹parent› notified · Asked ‹parent› for help · Finished its turn |
| **Working** | the Worker | Working · Revising · Connecting |
| **Closed** | nobody | Accepted · Cancelled |
| **Archived · n** | — | collapsed until you open it |

**Needs you** holds only what you must unblock: a Worker, or the Queen herself, waiting for your approval or your answer, and a Worker that is stuck. A Worker is stuck when its last Run failed or was interrupted, or it asked its parent for help, and its parent has no Run going and nothing queued, so no agent will pick it up. While the parent is running, the same Worker waits for it instead. When its parent asks a Worker to revise, the Worker is working on it.

These labels clear when the situation ends. "Run failed" clears as soon as a new Run starts on the Worker, whoever starts it. "Asked ‹parent› for help" clears when the parent sends the Worker anything (a message, a Follow-up or steering), or when the Worker says it is working again. The failure stays in the Worker's transcript and its Delegation history, and the parent agent still gets every update.

Only **Needs you** reaches you outside the panel: the rail icon's dot, the Queen's sidebar line ("1 needs you"), and the Session Summary's count. The Queen's sidebar line also shows a muted "2 waiting for ‹Queen›" for her Workers that wait for her, with no dot.

Each row has the same ⋯ and right-click menu as a sidebar row. **Pin session** brings a Worker into the sidebar's Pinned section, where its second line names its project and **Spawned by** its parent (the Queen, for a direct Worker); **Unpin** returns it to the panel only. Status filters and search in the sidebar still find Workers, listing them flat with their parent named. A Queen row in the sidebar reports hidden Workers that need you. The Summary is available even before a newly spawned Worker has sent its first message.

The Queen's summary is a starting point for review, not a substitute for the Worker transcripts, changed files, or test results. Instructions such as "do not edit" are not access controls. Check each session's approval settings before assigning work, and remember that concurrent Workers can make separate billable provider calls.

## Workspace placement

Workers share the parent's exact workspace by default. They can read and change the same files you and other sessions are using. For independent edits, ask for a **new worktree** and give each Worker a clear scope. A separate worktree isolates the checkout; it does not grant new filesystem or Git permissions.

You can also choose a specific local checkout. Launches and forks have explicit workspace choices too. OpenWaggle does not silently substitute another checkout when a worktree is missing.

A new worktree can run configured workspace preparation before the agent starts. Setup must finish successfully, or receive an explicit continue decision, before execution proceeds. If setup has failed or its previous result is uncertain, inspect **Workspace preparation** in Session Summary rather than repeatedly sending the task. See [Project actions](/docs/configuration/project-actions) for preparation and managed-run controls.

Sharing a workspace makes it harder to attribute changes. OpenWaggle records advisory scope claims and conflicts, but those claims do not lock files. Review overlapping edits yourself.

## Session and message actions

A **run** is one active execution of the agent in a session. Use a **Follow-up** for work that should start after it finishes; use **Steer** for guidance that belongs in the current run. Steer does not cancel a tool already running.

These names have precise meanings in the GUI, CLI, MCP adapter, and native `hive` tool:

| Action | Meaning |
|---|---|
| **Create** | Create an idle independent root Session. It has no initial Run. |
| **Launch** | Atomically create an independent root Session and start its first Run. |
| **Spawn** | Atomically create and start a Worker beneath a parent, including its lineage and Delegation Contract. An optional title names it; without one it is titled from its objective. |
| **Fork** | Create a new Session from a stable point in an existing transcript. |
| **Message** | Adaptive convenience action: start immediately when idle, otherwise append a durable Follow-up. An idle Session whose queue is paused still starts the message; the paused Follow-ups stay queued. |
| **Start** | Start a new Run on an idle Session. It never queues behind an active Run. |
| **Follow-up** | Submit a durable, separate next Run. It remains queued while the current Run finishes; if that Run has just settled, it starts immediately as the next Run. A Follow-up sent to an idle Session whose queue is paused waits in the queue; the result says so with `queueState` and, when known, `pauseReason`. |
| **Steer** | Append guidance to one exact active Run without interrupting it. It requires that Run's identity. |
| **Replace** | Interrupt one exact active Run and start the supplied message as a new Run. |
| **Promote** | Remove one queued Follow-up and deliver it as Steering to the exact active Run. |
| **Withdraw** | Remove a pending Follow-up before delivery. The result lists the Follow-ups it removed as `withdrawnFollowUpIds` and those still queued as `remainingFollowUpIds`. |
| **Reorder** | Change pending Follow-up order against an expected queue revision. |
| **Pause / Resume** | Stop or restart automatic delivery of queued Follow-ups. Pausing does not interrupt a Run. A failed, interrupted, or timed-out Run pauses the queue only for Follow-ups accepted before the Run ended; one accepted after that starts at settlement. `queue list` reports why a paused queue paused. |
| **Interrupt** | Stop one exact active Run without starting another. |
| **Wait** | Perform one bounded observation until a Session condition is reached or the timeout expires. It uses Host events internally but does not create a persistent subscription or consume an agent Run slot. |
| **Watch** | Stream authorized Session Host events, with a cursor for reconnect and resynchronization. |
| **Report** | Deliver explicit context upstream, to the Queen, or to a named Worker without starting or steering a Run. |
| **Handoff** | Move a Session to another authorized Workspace binding. |
| **Export** | Stream or create a Markdown, JSONL, or bundle artifact from an authorized transcript scope. |

Stopping or interrupting a Run before the agent wrote anything leaves no empty reply in the transcript; whatever it had already written stays.

Pi's internal steering queue is an adapter detail. The durable **Follow-up queue** above is the product queue: it survives renderer disconnects and host recovery, can remain pending after the active Run, and is delivered one entry at a time when resumed.

When you promote a Follow-up, its preview moves into the conversation while the Host processes it. During compaction it shows that it is waiting. Acceptance can precede delivery while a tool is still running, so the preview remains until the actual user message arrives. Switching Sessions does not discard it. If the Host refuses the promotion, the Follow-up remains in its queue.

A steered message the agent has not read yet is not lost when its Run ends first. If you stop, interrupt, or replace the Run, or it ends without reading the message, the message returns to the front of the Follow-up queue, in the order it was steered. A promoted Follow-up keeps its identity, text, attachments, and options. A message steered directly, for example by an agent or the Hive CLI, becomes a new Follow-up from the same caller, with its text, attachments, and visualization context; like any steer it has no Waggle, thinking level, or authorization override of its own, so it runs with the Session's settings. The queue list marks it as a returned steer with the steer's Run and idempotency key, so the caller can find it instead of sending it again. Because returned steers can push the queue past its usual capacity, a direct steer is refused while the queue is full, and one Run holds a bounded number of them. A stopped Run pauses the queue as usual, so you can resume, steer, or dismiss it. A message the agent had already started reading stays in the transcript and is not returned. After a Host crash, OpenWaggle cannot tell which steered messages were read, so it returns none of them.

## Authorization and capacity

A child inherits the parent's execution profile by default. Any specialization can keep or reduce approval, tool, MCP, and native Session capabilities; it cannot widen them through the Sessions API. `YOLO (Full access)` is available only when the caller and resolved authorization ceiling already permit it.

A Session's model and thinking level are Session settings. A Run uses them when it starts, and they can change only while no Run is starting, running, or stopping. A Session that is only waiting on its queue can change. An agent or CLI caller can set a thinking level when it creates, launches, or spawns a Session, or with a `message` or `start` that starts a Run on an idle Session. It can pass a Run authorization override on `launch`, `spawn`, or such a `message` or `start`; `create` starts no Run, so it takes none. The override applies only to that Run and stays within the caller's ceiling. Neither is accepted while a Run is active, so a queued Follow-up, steer, or replacement never carries its own thinking level or access; a Follow-up runs with the Session's settings when its turn comes.

If the access a Follow-up was queued under is revoked or no longer covers the Session, the Follow-up waits in the queue marked as needing attention. In the app, **Send as me** sends it under your own access instead. The queue keeps who originally queued it, and the message can no longer be edited. You can also dismiss it.

Session capabilities constrain the native `hive` tool and authenticated Session Host requests. They are not an operating-system sandbox. A Worker that still has an unrestricted shell, process access, and the same desktop-user credentials can act with that user's authority outside the native tool, including calling the CLI directly. For strong containment, remove shell/process tools from the Agent definition or run the agent in a separate OS sandbox, account, or container. Named CLI profiles are useful for attribution and least privilege only when the caller cannot also access the owner's credentials.

**Settings > Agents > Hive controls** contains **Agent-created Workers**, **Workers per parent**, default `4`, and **Active agent runs**, default `16`. These control agent-created sessions, concurrent direct Workers under one parent, and the app-wide active run limit. Both limits are configurable without a fixed product maximum; high values may strain the machine or provider. A new Run at capacity receives a retryable rejection, not a queued slot. These limits count active Runs, not saved Sessions, queues, searches, exports, waits, or watchers.

## Delegation lifecycle

Each spawn creates one durable Delegation Contract. The Worker submits a revision with evidence; the parent agent normally reviews it, asks for revision, or accepts it. The GUI shows state and navigation but does not make the human approve every submission. A normally completed Worker that did not submit explicitly receives a host-captured submission so its result is not lost. A Worker that marks its Delegation `needs_attention` itself, asking its parent for help, keeps that state when that Run ends, even if it replied with text: that reply explains what it needs and is not submitted as a result. Once the parent answers, a later Run that completes with a reply is captured for review as usual.

Use [Agent Definitions](/docs/extending/agent-definitions) for optional reusable roles. No definition is required: the parent agent may decide the Worker approach for each assignment.

### Automatic cleanup of finished Workers

When the parent agent accepts or cancels a Worker's delegation, OpenWaggle archives that Worker on the parent's behalf if you never interacted with it. A Worker that is still busy is archived once it becomes idle: no active run, no queued Follow-ups, and no pending question or approval request. Interacting includes sending it a message or Follow-up, steering or replacing its run, answering one of its questions or approval requests, reviewing its delegation yourself (accepting, cancelling, reopening, or asking for a revision), branching its conversation, and renaming, archiving, or restoring it, whether from the app or the CLI. Any Worker you have interacted with stays out of cleanup; interacting does not add it to the sidebar, only pinning does. A pinned Worker is not archived while it is pinned. Archiving is recorded as the parent agent's action, and nothing is deleted.

Reading a Worker's transcript is not interaction, but OpenWaggle leaves a Worker alone while it is open in the app, and while it has a terminal, a browser preview, or a running project service that archiving would stop. A Worker you leave while it runs stops counting as open once its run ends. OpenWaggle checks a Worker it kept this way again on its own, 15 seconds later and then at growing intervals up to every 5 minutes, so closing the Worker is enough; you do not need to start another run. Whatever its workspace, a shared checkout or its own worktree, a finished Worker is archived the same way.

Archived Workers stay listed under **Archived · n** in the Hive panel and in **Settings > Archived items**. Choose **Unarchive session** from an archived row's menu in the Hive panel, or **Restore** in Settings, to bring it back and continue the conversation. Work sent to a Worker that cleanup archived restores it in the same step, so it is back among the Hive panel's live rows and out of its **Archived** list while it runs. That covers a message, Follow-up, `start`, steer, or replace, and reopening or asking for a revision of its delegation, whether you do it or an agent does. The restore is recorded as whoever sent the work. OpenWaggle does not archive a Worker you restored again. A Worker an agent restored stays visible until its delegation is accepted or cancelled again; after that, cleanup can archive it once more. A Worker that you or an agent archived explicitly stays archived when it gets new work, and the parent agent can restore it with `unarchive`.

## How hosted agents coordinate

An agent running inside OpenWaggle uses its native `hive` tool. It can list or search available Agent definitions, then spawn a Worker with a specific objective, an optional definition, and an explicit Workspace choice. Without a definition, the Worker is a normal agent. A spawned Worker starts with its own context: the parent must include the task and any necessary references rather than assuming the Worker can see the parent's transcript.

By default `list`, `search`, and `delegations_list` look at the caller's current project: its main checkout and every worktree of it, so a Queen finds a Worker that runs in a new worktree. `catalogScope: "project"` with a `projectPath` looks at another project, and `catalogScope: "all"` at every Session the caller can reach. A Worker's discovery stays inside its grant, which never reaches past its own Hive; asking for another project is refused with `target_scope_denied`. `list` leaves archived Sessions out, as `search` does; `archived: true` lists only archived ones, and `parentSessionId` lists only that Session's direct Workers. `delegations_list` shows Delegations in every state, newest first, unless `states` narrows it. Each listed or read Session reports its `depth` in its Hive, `0` for a root.

The native tool offers each agent only the actions its Session's grant allows, and its instructions name only those. A call to any other action fails with the capability it needs, for example `capability_denied: the hive action fork requires sessions:create and sessions:read`.

After spawning, the parent can use `wait` for a bounded observation, read the Worker's Session or Delegation history, and review its submitted revision. The native tool's `wait` is not a permanent subscription; external CLI/MCP clients can use `watch` for a continuing event stream. The parent may ask for revision or accept the submission. An agent can use `report` to pass context to its parent, the Queen, or another Worker without starting a Run in the recipient. A user can ask a Worker to report a finding upstream; no separate reporting UI is required.

### Sessions in other repositories

An agent is not limited to its own repository. A Session you started from the app can list, search, and read Sessions in any project that has a Session or Workspace in OpenWaggle, report to them, send them Follow-ups, steer, interrupt, or archive them, and launch or create a new Session in another of those projects, without sharing a Hive. A project you only opened, without sending a message, does not count yet; start a Session there first. This applies to turns you started, or that another such agent started; a turn started by a restricted CLI profile, or by a Worker's Follow-up, stays in the Session's own project, and a restricted profile cannot steer a turn that reaches other projects. For example:

```text
Find the open OpenWaggle session about the release checklist and report this failing
check to it. If there isn't one, launch a session in ~/Projects/OpenWaggle on a new
worktree with this report as its objective.
```

To start work elsewhere, the agent passes that repository's path with `workspace` set to `local` or `new-worktree`. Leaving `workspace` out, or passing `current`, uses the other project's main checkout. The native Session capabilities and the Authorization ceiling apply in every project, exactly as they do in the agent's own. Workers keep their narrower grants, and a Session started from a [named CLI profile](/docs/developer-workflow/hive-cli#restricted-external-agent-profiles) stays inside its own project unless the profile covers every project. When the Host refuses a request, the tool reports why, such as the missing capability.

### Scratch files

Each Session has a private scratch directory for temporary files. OpenWaggle sets `TMPDIR`, `TMP`, and `TEMP` to it for the agent's shell tools and names it in the agent's instructions, so two agents writing `push.log` at the same time cannot overwrite or read each other's file. On macOS and Linux only your user account can open it. OpenWaggle deletes it when you archive or delete the Session, or when the running turn ends if you archive it mid-turn; keep anything you need in the workspace instead. Screenshots and other files an agent wants to show you or another Session go to a separate evidence directory, `$OPENWAGGLE_EVIDENCE_DIR`, which is kept after archiving, so a Queen can still show a finished Worker's screenshots. OpenWaggle removes a Session's evidence once nothing has been added to it for a week.

Keep a later instruction as a **Follow-up** when it should start after the current Run. Use **Steer** only when it belongs in that exact active Run. Navigating between Sessions does not interrupt either Run. See the [Hive CLI](/docs/developer-workflow/hive-cli) for the corresponding external-agent commands.

## External control and live UI updates

The Session Host is the local process that owns session execution and saved state. The desktop app, CLI, MCP server, and native agent tool all use it. A CLI-created Worker therefore appears in the GUI's Hive panel, and queue, Run, request, delegation, and lineage changes update open windows through the Host event stream. If an event cursor is too old or the Host restarts, clients reload a canonical snapshot before continuing.

An agent already running in OpenWaggle uses the native `hive` tool directly rather than spawning the CLI. External coding agents use the [Hive CLI](/docs/developer-workflow/hive-cli) or the versioned `openwaggle_hive` MCP tool.

### Older Hive history

Sessions created by the older MCP task feature keep their parent and Worker links after the one-time Session Host upgrade. These historical relationships support navigation, not new control permissions or delegation grants. New Workers use the current delegation model.

## Related guides

- [Hive CLI](/docs/developer-workflow/hive-cli) covers discovery, messaging, waiting, watching, transcript reads, and exports for external agents.
- [Agent Definitions](/docs/extending/agent-definitions) explains optional Markdown roles and capability restrictions for Workers.
- [App Settings](/docs/configuration/app-settings) covers Hive controls, Worker limits, active Run capacity, and permissions.
- [Session Recovery](/docs/configuration/session-recovery) explains the one-time alpha migration and recovery behavior.
