---
status: accepted
---

# The Session Host runs Scheduled tasks

Amended 2026-10-27: Heartbeats have a Wake check, a way to finish, Run outcomes and Auto-pause (see the Amendment below).

OpenWaggle needs Scheduled tasks (Heartbeats and Launch schedules) before v1. The Session Host schedules them, because it already owns Runs, Follow-up queues, and authorization (ADR 0030), and it outlives the GUI. A Scheduled task run calls the same Session Control operations a person would: Message submission for a Heartbeat, Session launch for a Launch schedule. While any Scheduled task is enabled, the Host does not idle-exit; with none enabled, the ADR 0047 idle exit is unchanged. To survive a reboot or logout, the user can turn on **Background start**, which starts only the Host, with no window, at login. It is opt-in, because a process that spends tokens with no window open should be the user's choice; OpenWaggle offers it when the first Scheduled task is created. A sleeping machine runs nothing: v1 has no keep-awake setting and no tray icon, and `openwaggle host status` lists the enabled Scheduled tasks and when each fires next.

## Considered options

- **Schedule in Electron main, while a window is open (Codex).** Quitting the window would silently stop every task, and the GUI would become a second owner of Run starts, which ADR 0030 removed.
- **Host-owned without Background start.** Covers a closed window but not a reboot; tasks would resume only when some client next starts the Host.
- **Register each task with the OS scheduler (launchd, Task Scheduler, systemd timers).** Three platform implementations and schedule state outside OpenWaggle's database, out of reach of Session Control authorization and CLI profile revocation.
- **A user service like `t3 service install`.** Needs per-platform service management (T3 Code has no Windows support), and OpenWaggle's Host is already started on demand from the app bundle.

## Consequences

- The Host can now stay up for days with no client attached. Update installs still stop it (ADR 0047), and the next GUI or CLI start, or Background start at the next login, brings it back.
- Scheduled task runs happen only while the Host is running and the machine is awake. What happens to runs that were due while it was not is a separate decision.

## Amendment (2026-10-27): Heartbeats must be cheap and finite (#388)

A Heartbeat babysitting the v1 pipeline fired eight times with nothing to do, each a full agent turn in a very large Queen Session. Its prompt had no exit condition, it had no end date or run limit, and nothing made an open-ended, always-waking Heartbeat hard to create. Decided with the maintainer on 2026-10-27:

- **Wake check.** A Heartbeat may carry a shell command that the Host runs before each firing, in the Heartbeat Session's Workspace and as a Project action runs a command: the interactive terminal environment with app-control and code-injection variables removed, no input and no chat context, a 30-second limit after which its whole process tree is killed, and 16 KiB of output per stream. The Host runs it only once the Session is idle. Exit 0 with nothing on standard output records the firing as `skipped` (`wake-check-idle`) and starts no Session Run and no model call; anything else starts the Run with the output in its Run identity. A check that cannot start, times out, is killed by a signal, or whose shell cannot run its command (126, 127) is `wake-check-failed`, never "nothing to do", and wakes the Run unless the task says `skip`. The skipped status already existed; the new causes are run reasons, and each run records what its check decided.
- **Approval.** A Wake check runs under the Heartbeat Session's Effective authorization mode. Under Ask for Approval, a command anyone but the user set holds the Heartbeat (it waits, like a busy Session) until the user approves that exact command (`approve-wake-check`): in the app, with the CLI as themselves, or through the Hive tool's confirmation in the Session, which no Authorization mode may answer. A changed command asks again; a CLI client profile is refused. The user setting a command approves it by that act.
- **A way to finish.** Creating a Heartbeat needs `stopWhen`, `endsAt`, `maxRuns` or `indefinite: true` (`stop_condition_required`), and an update may not remove the last of them. App migration 75 (`heartbeat-efficiency`) marks the Heartbeats created before with no end date or run limit as indefinite. MCP clients cannot create Scheduled tasks at all, so they need no check of their own.
- **Run identity.** A Heartbeat Run is told its run count, consecutive idle runs, Stop condition, end, run limit, remaining runs and the Wake check output, and the instruction to pause the task with `schedule_update` and end with a Run outcome. These are snapshotted on the run row when the firing is sent, not read back from bookkeeping that settles after.
- **Run outcome and Auto-pause.** A Heartbeat Run reports `acted`, `idle` or `done` through the Hive tool's `schedule_outcome` (the `report-outcome` operation, accepted only from that Run's own Session); a Run that reports none is `acted` if it used any tool other than a read-only query, else `idle`. `done` pauses the Heartbeat at once. Consecutive idle runs, a skipped Wake check included, pause it at its threshold (1 to 20, 3 by default); `acted` resets the count; a failed Run or check changes nothing. Each Auto-pause records its reason and the app announces it once, with Resume.
- **Cheaper runs.** A Heartbeat may set its own model and thinking level, which apply to its Runs only; the Session's own settings are unchanged. Heartbeat semantics are otherwise unchanged: it still delivers into an existing Session.

The Local Session protocol moved to revision 28 because clients decode Scheduled tasks exactly. Considered and rejected: a new `wake_check_failed` run status (the existing `failed` means the firing failed, and a failed check usually wakes), counting a failed check as idle (it would hide a broken check behind Auto-pause), and asking for the approval through the Authorization channel (an Authorization mode could answer it, and the rule is that only the user approves).
