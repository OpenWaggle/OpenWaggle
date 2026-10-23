---
status: accepted
---

# The Session Host runs Scheduled tasks

OpenWaggle needs Scheduled tasks (Heartbeats and Launch schedules) before v1. The Session Host schedules them, because it already owns Runs, Follow-up queues, and authorization (ADR 0030), and it outlives the GUI. A Scheduled task run calls the same Session Control operations a person would: Message submission for a Heartbeat, Session launch for a Launch schedule. While any Scheduled task is enabled, the Host does not idle-exit; with none enabled, the ADR 0047 idle exit is unchanged. To survive a reboot or logout, the user can turn on **Background start**, which starts only the Host, with no window, at login. It is opt-in, because a process that spends tokens with no window open should be the user's choice; OpenWaggle offers it when the first Scheduled task is created. A sleeping machine runs nothing: v1 has no keep-awake setting and no tray icon, and `openwaggle host status` lists the enabled Scheduled tasks and when each fires next.

## Considered options

- **Schedule in Electron main, while a window is open (Codex).** Quitting the window would silently stop every task, and the GUI would become a second owner of Run starts, which ADR 0030 removed.
- **Host-owned without Background start.** Covers a closed window but not a reboot; tasks would resume only when some client next starts the Host.
- **Register each task with the OS scheduler (launchd, Task Scheduler, systemd timers).** Three platform implementations and schedule state outside OpenWaggle's database, out of reach of Session Control authorization and CLI profile revocation.
- **A user service like `t3 service install`.** Needs per-platform service management (T3 Code has no Windows support), and OpenWaggle's Host is already started on demand from the app bundle.

## Consequences

- The Host can now stay up for days with no client attached. Update installs still stop it (ADR 0047), and the next GUI or CLI start, or Background start at the next login, brings it back.
- Scheduled task runs happen only while the Host is running and the machine is awake. What happens to runs that were due while it was not is a separate decision.
