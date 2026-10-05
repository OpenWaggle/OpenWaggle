---
status: proposed
---

# Installing an update releases the Session Host

The detached Session Host runs from the app bundle, so macOS counts it as a running instance of OpenWaggle. Squirrel.Mac's installer waits for every instance to exit and then refuses with "App Still Running" if one is there; the Windows installer kills it. Restart to update therefore stops the Host before the app quits: the desktop app sends the `local-host-v1` stop that `openwaggle host stop` uses (ADR 0039), with a 10-second deadline, and waits up to 15 seconds for the process to exit. Restart to update has already let Runs finish or stopped them, so the deadline only ends work such as a running Action, a CLI wait, or an export, which a restart ends anyway. The desktop app may send this stop only as the local user, and its stops always carry the deadline. An ordinary quit still leaves the Host running for background work.

The same investigation found that the Host never exited when idle. It re-read its idle grace setting every second and each read restarted the timer, and semantic discovery held it open for a moment every two seconds, which also restarted it. Only a changed setting now reschedules the timer, and that kind of background polling no longer counts as activity.

Restart to update shows **Installing** at once and records the attempt. On the next launch the app compares its version with the record and, if the update did not install, says why, naming another running OpenWaggle process when macOS's installer log shows that was the reason.

## Considered options

- **Stop the Host in the installer, not the app.** Squirrel.Mac has no such hook, and killing the process marks every active Run `interrupted-by-host-loss`.
- **A stop with no deadline.** A dev server started as an Action never ends on its own, so the Host would never exit and the update would never install.
- **A new `local-host-v1` field for the deadline.** It would be more explicit, but a desktop app newer than its Host would send a field the Host rejects. Tying the deadline to the desktop app's caller works with every Host that has the stop command; an older Host refuses the desktop app, which then quits and lets the next launch report the outcome.
- **Stage the update with Squirrel as soon as it downloads**, so Restart to update quits at once (as VS Code does). Then any quit installs the update, which ADR 0040 rules out, because installing is always a user action and the Update channel is re-read just before.

## Consequences

- ADR 0039 refused the desktop app's caller. It may now stop the Host, only with the deadline.
- An `openwaggle` command still running from the bundle, such as `openwaggle mcp serve` for another agent or `openwaggle sessions wait` in a terminal, still makes macOS refuse the install. The app reports it on the next launch instead of failing silently.
