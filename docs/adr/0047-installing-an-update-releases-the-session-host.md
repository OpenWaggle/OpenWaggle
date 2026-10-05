---
status: proposed
---

# Installing an update releases the Session Host

The detached Session Host runs from the app bundle, so macOS counts it as a running instance of OpenWaggle. Squirrel.Mac's installer waits for every instance to exit, checks again after verifying the update, and refuses with "App Still Running" if one is there. Restart to update therefore stops the Host before the app quits. The desktop app sends the `local-host-v1` stop that `openwaggle host stop` uses (ADR 0039), and the Host gives that stop a 10-second deadline. At the deadline the Host interrupts any Run still active through normal cancellation, so it ends as interrupted, and gives Runs 3 more seconds to settle. Anything else still holding it, such as a running Action, a CLI wait, or an export, ends with the Host, as a restart ends it anyway. The answer to the desktop app carries the Host's process id, and on macOS the app waits up to 20 seconds for that process to exit (the deadline, the settle, and 7 seconds for the Host to shut down), because the Host closes its socket before the process is gone. On Windows and Linux the app only requests the stop: the NSIS installer closes leftover processes itself, and the AppImage updater starts the new version at once, so a longer quit only gets in the way. An ordinary quit still leaves the Host running for background work.

The same investigation found that the Host never exited when idle. It re-read its idle grace setting every second and each read restarted the timer, and semantic discovery held it open for a moment every two seconds, which also restarted it. Only a changed setting now reschedules the timer. Semantic preparation still holds the Host open while it works, but no longer counts as activity, and it no longer shortens the startup grace or the client handoff grace.

Restart to update shows **Installing** at once and records the attempt. If the installer reports an error, or the app has not quit after 3 minutes, the update shows as ready again with the reason. Any quit the installer starts later, announced by Electron's `before-quit-for-update`, still releases the Host. On the next launch the app compares its version with the record. If the update did not install, it says so when that update is ready to install again, naming another running OpenWaggle process when macOS's installer log shows that was the reason. A newer update supersedes the old explanation.

## Considered options

- **Stop the Host in the installer, not the app.** Squirrel.Mac has no such hook, and killing the process marks every active Run `interrupted-by-host-loss`.
- **A stop with no deadline.** A dev server started as an Action never ends on its own, so the Host would never exit and the update would never install.
- **A new `local-host-v1` request field for the deadline.** It would be more explicit, but a desktop app newer than its Host would send a field the Host rejects. Tying the deadline to the desktop app's caller works with every Host that has the stop command; an older Host refuses the desktop app, which then quits and lets the next launch report the outcome. The process id is an optional response field that only the desktop app receives, so no older client ever decodes it.
- **Stage the update with Squirrel as soon as it downloads**, so Restart to update quits at once (as VS Code does). Then any quit installs the update, which ADR 0040 rules out, because installing is always a user action and the Update channel is re-read just before.

## Consequences

- ADR 0039 refused the desktop app's caller. It may now stop the Host, only with the deadline. The desktop app's caller is any local-user client that says it is the desktop app, so a CLI could ask for the same bounded stop; that is the same person, who can already stop the Host, and named profiles and agents are still refused.
- A Run that starts while the update shows as installing, between Restart to update seeing no active Run and the Host's drain, is interrupted at the deadline instead of finishing. The drain refuses new Runs, so that window lasts only as long as macOS takes to unpack the update, and the app shows that it is restarting.
- An `openwaggle` command still running from the bundle, such as `openwaggle mcp serve` for another agent or `openwaggle sessions wait` in a terminal, still makes macOS refuse the install. The app reports it on the next launch instead of failing silently.
- Updating from a version without this change still runs that version's Restart to update, which leaves its Host running. Users on those versions should run `openwaggle host stop` before Restart to update, or quit and use the installer script.
