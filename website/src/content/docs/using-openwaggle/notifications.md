---
title: "Notifications"
description: "Hear when a session needs you or is ready to read, even with OpenWaggle in the background."
section: "Using OpenWaggle"
kind: "guide"
---

OpenWaggle tells you when a session needs you or has finished, so you can work in another app while it runs. You get a desktop notification with a sound, and the app icon counts your notifications. Notifications are on when you install OpenWaggle. Change them in **Settings** > **Notifications**.

The Session Host decides when to notify, so notifications keep coming after you close every window. A heartbeat that fails overnight still tells you.

## What notifies

| Kind | When |
| --- | --- |
| **Needs you** | A session waits for your approval or your answer, or a worker is stuck and no agent will pick it up. This includes workers. |
| **Ready to read** | A run you started, or a scheduled task started, finished. |
| **Failed or interrupted** | A run failed, stopped waiting for your answer, or was cut off when the Session Host stopped. A scheduled task that OpenWaggle turned off because it needs your attention notifies here too, unless it is a heartbeat whose session you archived. |
| **Agent errors** | An agent or an extension reported an error, at most once per run. |

For a session with [workers](/docs/using-openwaggle/hives-and-sessions), **Ready to read** waits until no worker below the session is running, unless you sent your message while they were already running.

Some things never notify:

- A run you stopped yourself.
- A worker's finished or failed run. Its parent session hears about it instead.
- A run that another agent started, for example through the `hive` tool, the CLI with an agent's access profile, or MCP. Only its **Needs you** notifies.
- A scheduled task set to notify on failures only, when its run finishes. Its failures still notify.

A session has at most one notification. A newer one replaces it, except that only another **Needs you** replaces a **Needs you**. Opening the session clears its notification, except **Needs you**, which stays until you answer the request or the worker is no longer stuck. Archiving the session clears it too.

## Change what notifies

Open **Settings** > **Notifications**.

- **Desktop notifications** turns all of them on or off.
- Each kind has its own switch and its own sound. Pick one of six sounds, **System default** or **None**. The play button previews the sound.
- **While OpenWaggle is focused** decides what happens for a session other than the one on screen: **Sound only**, **Show notifications too** or **Nothing**. The session on screen never notifies while OpenWaggle has focus.
- **Show badge** counts your notifications on the Dock icon, for every kind you have turned on. On Windows the taskbar icon shows a red dot instead.
- **Show previews** adds the start of the reply, question or error. It is off, so message text stays off your lock screen.

With no OpenWaggle window open, a notification plays the system sound instead of the sound you picked, or none if you picked **None**. When OpenWaggle isn't running, the Session Host shows the notification itself, and there is no badge. Clicking a notification about a session opens OpenWaggle on that session. Clicking one about a scheduled task opens that task, or only opens OpenWaggle when the Session Host showed it.

## Mute a session or a project

Right-click a session in the sidebar and choose **Mute notifications**. For a whole project, open the project's **...** menu and choose **Mute notifications**. A muted session shows a crossed-out bell in the sidebar.

A mute stops **Ready to read**, **Failed or interrupted** and **Agent errors**. **Needs you** still notifies, because the session cannot go on without you. Muting a Queen does not mute her workers. Unmute from the same menu, or from the **Muted** list in **Settings** > **Notifications**.

## Allow notifications on macOS

macOS asks whether OpenWaggle may show notifications the first time you start a run. If you choose **Don't Allow**, OpenWaggle tells you once and stops asking. Sounds, the badge and the sidebar still work.

**Settings** > **Notifications** shows what macOS allows. **Open System Settings** goes to the page where you can change it, and **Send test notification** shows a sample. Focus modes and Do Not Disturb still apply to OpenWaggle.
