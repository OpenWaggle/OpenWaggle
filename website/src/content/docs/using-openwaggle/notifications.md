---
title: "Notifications"
description: "Hear when a session needs you or is ready to read, even with OpenWaggle in the background."
section: "Using OpenWaggle"
kind: "guide"
---

OpenWaggle tells you when a session needs you or has finished, so you can work in another app while it runs. You get a desktop notification with a sound, and the app icon counts the sessions waiting for you. Notifications are on when you install OpenWaggle. Change them in **Settings** > **Notifications**.

The Session Host decides when to notify, so notifications keep coming after you close every window. A heartbeat that fails overnight still tells you.

## What notifies

| Kind | When |
| --- | --- |
| **Needs you** | A session waits for your approval or your answer, or a worker is stuck and no agent will pick it up. This includes workers. |
| **Ready to read** | A run you started, or a scheduled task started, finished. |
| **Failed or interrupted** | A run failed, stopped waiting for your answer, or was cut off when the Session Host stopped. A scheduled task that OpenWaggle turned off because it needs your attention notifies here too. |
| **Agent errors** | An agent or an extension reported an error, at most once per run. |

For a session with [workers](/docs/using-openwaggle/hives-and-sessions), **Ready to read** waits until no worker below the session is running, unless you sent your message while they were already running.

Some things never notify:

- A run you stopped yourself.
- A worker's finished or failed run. Its parent session hears about it instead.
- A run that another agent started, for example through the `hive` tool, the CLI with an agent's access profile, or MCP. Only its **Needs you** notifies.
- A scheduled task set to notify on failures only, when its run finishes. Its failures still notify.

A session has at most one notification. A newer one replaces it, except that nothing replaces **Needs you** until you answer. The notification goes away when you open the session, answer the request, or archive the session.

## Change what notifies

Open **Settings** > **Notifications**.

- **Desktop notifications** turns all of them on or off.
- Each kind has its own switch and its own sound. Pick one of six sounds, **System default** or **None**. The play button previews the sound.
- **While OpenWaggle is focused** decides what happens for a session other than the one on screen: **Sound only**, **Show notifications too** or **Nothing**. The session on screen never notifies while OpenWaggle has focus.
- **Show badge** counts the sessions that need you or are ready to read on the Dock icon. On Windows the taskbar icon shows a red dot instead.
- **Show previews** adds the start of the reply, question or error. It is off, so message text stays off your lock screen.

When no OpenWaggle window is open, the Session Host shows the notification itself with the system sound, or none if you picked **None**. There is no badge then. Clicking the notification opens OpenWaggle on that session.

## Mute a session or a project

Right-click a session in the sidebar and choose **Mute notifications**. For a whole project, open the project's **...** menu and choose **Mute notifications**. A muted session shows a crossed-out bell in the sidebar.

A mute stops **Ready to read**, **Failed or interrupted** and **Agent errors**. **Needs you** still notifies, because the session cannot go on without you. Muting a Queen does not mute her workers. Unmute from the same menu, or from the **Muted** list in **Settings** > **Notifications**.

## Allow notifications on macOS

macOS asks whether OpenWaggle may show notifications the first time you start a run. If you choose **Don't Allow**, OpenWaggle tells you once and stops asking. Sounds, the badge and the sidebar still work.

**Settings** > **Notifications** shows what macOS allows. **Open System Settings** goes to the page where you can change it, and **Send test notification** shows a sample. Focus modes and Do Not Disturb still apply to OpenWaggle.
