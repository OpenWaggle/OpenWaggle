---
title: "Right panel and panel rail"
description: "Open Changes, Project Actions, Browser, Files, the Session tree, Resources and extension panels from one rail, and arrange it the way you work."
order: 3
section: "Using OpenWaggle"
---

The right panel shows one panel at a time beside the conversation: Changes, Project Actions, Browser, Files, the Session tree, Resources, or a panel added by an extension. The **panel rail** on its right edge is how you move between them.

## Showing and hiding the panel

Click the panel button at the right end of the header, or press `Cmd+Option+B` on macOS or `Ctrl+Alt+B` on Windows and Linux. The panel comes back on whatever it showed last in this session. A session you have not opened the panel in yet starts on the panel you used most recently anywhere.

Each session remembers its own panel. If one session has Changes open and another has the panel closed, switching between them restores each one as you left it. Each session also remembers whether its panel is maximized: use the maximize button in any panel's header, or the **Maximize right panel** command. The panel width and the rail layout are yours and stay the same in every session.

## Using the rail

Click an icon to show that panel. Click the icon of the panel that is already showing to close the panel. Hover an icon to see its name and shortcut; an icon that cannot work yet, for example Session tree before the first message, stays in place, dimmed, and its tooltip says why.

The first icon, **All panels**, opens a list of every panel you can open here, with its keyboard shortcut. Use it to learn shortcuts and to reach panels you took off the rail. When the window is too short for every icon, the All panels icon shows how many did not fit, and those panels are marked "No room on rail" in the list.

Some panels open from elsewhere: a file link in the conversation opens Files, a change request opens under Changes, **Add action** opens under Project Actions, and a page the agent opens appears in Browser. The rail highlights the icon each one belongs to.

The terminal is not on the rail. The terminal button in the header and `Cmd+J` / `Ctrl+J` show or hide it wherever its tabs are, in the bottom drawer or in the right panel.

## Arranging the rail

- **Reorder:** press and hold an icon until it lifts, then drag it. A quick click only opens the panel. With an icon focused, `Option+Up` / `Option+Down` (`Alt+Up` / `Alt+Down`) moves it too.
- **Remove or add:** use the pin in All panels, or right-click an icon and choose **Remove from rail**. A removed panel stays in All panels.
- **Reset:** choose **Reset rail** in All panels or in the right-click menu to return to the default order: Changes, Project Actions, Browser, Files, Session tree, Resources, then extension panels in the order you installed them.

## Keeping the rail visible

By default the rail stays on the window's right edge when the panel is closed, so every panel is one click away. To hide it together with the panel, open **Settings > Appearance > Right panel** and choose **Hide rail**. The rail's right-click menu has the same choice as **Keep rail visible when panel is closed**.

## Extension panels

When an extension adds a panel, it joins the end of the rail with a dot and a **New** marker the first time you see it. Its tooltip and the All panels list name the extension, so you can tell it apart from built-in panels.

A panel whose extension cannot run yet is listed in All panels, dimmed, with what it needs, such as **Needs trust** or **Needs update**. Choosing it explains where to fix that in **Settings > Extensions**. Panels you turned off, or that do not apply to the current project, are hidden and keep their place on the rail for when they come back.

Every panel, including extension panels, can have a keyboard shortcut. Assign them in **Settings > Shortcuts**. Extensions cannot assign shortcuts for you.

## Narrow windows

Below about 1180 pixels wide the panel opens over the conversation instead of beside it. The rail stays at the edge, and clicking the icon of the panel that is showing closes it.
