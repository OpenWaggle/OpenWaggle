---
title: "Right panel and panel rail"
description: "Open Changes, Project Actions, Scheduled, Browser, Files, the Session Tree, Resources, the Hive panel and extension panels from one rail, and arrange it the way you work."
order: 3
section: "Using OpenWaggle"
kind: "guide"
---

The right panel shows one panel at a time beside the conversation: Changes, Project Actions, Scheduled (the project's [scheduled tasks](/docs/using-openwaggle/scheduled-tasks)), Browser, Files, the Session Tree, Resources, the Hive panel, or a panel from an extension. The panel rail on its right edge is how you move between them.

## Show and hide the panel

Click the panel button at the right end of the header, or press `Cmd+Option+B` on macOS or `Ctrl+Alt+B` on Windows and Linux. The panel opens on whatever it showed last in this session. In a session where you haven't opened it yet, it opens on the panel you used most recently anywhere.

Each session remembers its own panel. If one session has Changes open and another has the panel closed, switching between them brings each back as you left it. Each session also remembers whether its panel is maximized. Use the maximize button in a panel's header, or the **Maximize right panel** command. The panel's width and the rail's layout are the same in every session. Settings pages hide the panel, and it comes back as you left it when you return to a session.

## Use the rail

Click an icon to show that panel. Click the icon of the panel that is already showing to close the panel. Hover over an icon to see its name and shortcut. An icon that can't work yet, such as Session Tree before the first message, stays in place, dimmed, and its tooltip says why.

The first icon, **All panels**, lists every panel you can open here, with its shortcut. Use it to learn the shortcuts and to reach panels you took off the rail. When the window is too short for every icon, the All panels icon shows how many didn't fit, and the list marks those panels **No room on rail**.

![The All panels list beside the rail, with workspace panels, session panels, an empty Extensions group, and Reset rail and Manage extensions](/screenshots/right-panel-all-panels.png)

Some panels open from elsewhere. A file link in the conversation opens Files, a change request opens under Changes, **Add action** opens under Project Actions, and a page the agent opens appears in Browser. The rail highlights the icon each one belongs to.

Files shows changes on disk as they happen, except in files Git ignores and inside a folder that is a symbolic link, such as a linked package in a monorepo.

The terminal is not on the rail. The terminal button in the header, or `Cmd+J` / `Ctrl+J`, shows or hides it wherever its tabs are, in the bottom drawer or in the right panel.

## Arrange the rail

To move an icon, press and hold it until it lifts, then drag it. A quick click only opens the panel. With an icon focused, `Option+Up` and `Option+Down` (`Alt+Up` and `Alt+Down`) move it too.

To take a panel off the rail, or put it back, use its pin in All panels, or right-click its icon and choose **Remove from rail**. A panel you remove stays in All panels.

To go back to the default order, choose **Reset rail** in All panels or in the right-click menu. The default order is Changes, Project Actions, Scheduled, Browser, Files, Session Tree, Resources, Hive, then extension panels in the order you installed them.

## Keep the rail visible

By default the rail stays on the window's right edge when the panel is closed, so every panel is one click away. To hide it along with the panel, open **Settings > Appearance > Right panel** and choose **Hide rail**. The rail's right-click menu has the same choice, **Keep rail visible when panel is closed**.

## Extension panels

A panel from an extension joins the end of the rail, with a dot and a **New** marker the first time you see it. Its tooltip and the All panels list name the extension, so you can tell it from the built-in panels.

All panels lists a panel whose extension can't run yet, dimmed, with what it needs, such as **Needs trust** or **Needs update**. Choosing it tells you where to fix that in **Settings > Extensions**. Panels you turned off, or that don't apply to the current project, are hidden and keep their place on the rail for when they come back.

Every panel, including extension panels, can have a keyboard shortcut. Set them in **Settings > Shortcuts**, as [Panel shortcuts](/docs/getting-started/keyboard-shortcuts#panel-shortcuts) describes. Extensions can't set shortcuts for you.

## Use the panel in a narrow window

Below about 1180 pixels wide, the panel opens over the conversation instead of beside it. The rail stays at the edge, and clicking the icon of the panel that is showing closes it.
