---
status: accepted
---

# The Session Host decides Desktop notifications

Date: 2026-11-06

Amended by: [ADR 0065](0065-parents-show-their-running-workers.md). A root Session's Ready to read waits until no Worker below it is running, unless the person asked while Workers were already running.

OpenWaggle needs Desktop notifications before v1, so the person learns when a Session needs them (**Needs you**) or has something to read, without watching the window. T3 Code decides and shows its notifications in the renderer, and Codex's TUI does both in the terminal, so either one is silent once its window is gone. OpenWaggle's work does not stop with the window. The Session Host is detached and keeps Runs going after the app quits, does not idle-exit while a Scheduled task is enabled, and with Background start runs at login with no window at all (ADR 0057). A Heartbeat that fails at 3 a.m. after the person quit the app is exactly what a notification is for. So the Session Host decides when a Desktop notification is due, the desktop app shows it while connected, and the Host shows it itself when no desktop app is connected.

## Decision

- **The Host decides.** It already owns Runs, parked requests, Delegations, visit receipts and Scheduled tasks, so it applies the rules in CONTEXT.md (Notification categories, the Next actor, Scheduled task notification policies, the person's switches) to every Run, whether the app, the CLI, MCP or a Scheduled task started it. One decision per event means two open copies of the app cannot both show a notification for it.
- **The desktop app shows it while connected.** Only the app knows whether a window is focused and which Session is on screen, and only a window can play OpenWaggle's Notification sounds. It receives the Host's decision and applies the focus rule, the sound, the Notification badge and the click, which opens that Session.
- **The Host shows it when no desktop app is connected.** The Host is an Electron process with the app's bundle id (run as an `accessory` process), so it can use Electron's `Notification` directly. A notification it shows uses the system default sound, or none when the person chose none, and clicking it opens the app on that Session through its `openwaggle://sessions/…` link (ADR 0056). There is no Notification badge then, because the Host has no Dock tile.
- **Push notifications stay out of v1.** Reaching a phone needs a hosted relay, accounts and a mobile client, as T3 Connect has. The Host-side decision is the part a relay could subscribe to later without changing what notifies.

## Considered Options

- **Decide and show in the renderer (T3 Code).** It is simplest, but it is silent whenever the app is not running, which is when Scheduled tasks and long Runs most need it. Every renderer would also apply the rules on its own.
- **Decide in the Host, show only in the desktop app.** This gives one rule, but quitting the app would still silence a Heartbeat failure or a Worker that became Stuck overnight.

## Consequences

The Host has to know whether a desktop app is connected and hand each notification to exactly one presenter. Withdrawing a notification whose situation ended (a request answered from the CLI, a Session read or archived) is also the Host's job, for notifications either side showed. The Local Session protocol gains a notification event the app receives; the focus rule stays in the app, so the Host never needs to know which Session is on screen.

## Implementation notes

- Local Session protocol revision 31 adds the sessionless `desktop-notification-shown` and `desktop-notification-withdrawn` events and the read-only `desktop-notifications:list` Host UI channel (capability `host-ui:desktop-notifications-v1`). The app reads the list after it connects, for the badge, and never shows a listed notification again.
- A desktop app counts as connected while it holds an unscoped event subscription as the desktop caller. Each notification records whether the desktop app or the Host presents it (`presentedBy`), so exactly one of them shows it.
- One notification stands per Session (or per Launch schedule with no Session), with a revision. A newer one replaces it, except that nothing less urgent displaces a standing Needs you. A visit receipt newer than the event withdraws Ready to read, Failed or interrupted and Agent errors; answering the request withdraws Needs you; a Stuck Worker's notice goes when it stops being Stuck; archiving or deleting withdraws them all.
- Runs that recovery marked `interrupted-by-host-loss` are announced shortly after the Host starts, so an app that started the Host has connected and shows them. A Host stopped for an update drains first and interrupts what is left, which settles as `interrupted`, so an update is not announced as a failure.
- Electron has no macOS notification-permission API. macOS asks the first time the app shows a notification, so the app shows one, "Notifications are on", at the first Run the person starts, and reads the status from whether notifications show or fail.
