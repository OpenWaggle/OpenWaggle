---
title: "Keyboard shortcuts"
description: "Default shortcuts for conversations, terminals, browser preview, and navigation."
order: 9
section: "Customize"
kind: "reference"
---

This page lists the default keyboard shortcuts. To see or change them, open **Settings > Shortcuts**.

![Settings > Shortcuts with the search field, Add binding, Reset defaults, and the Panels group listing each panel and its binding](/screenshots/settings-shortcuts.png)

## Default shortcuts

The names are the ones **Settings > Shortcuts** shows. **Where** says when the shortcut works: **Anywhere**, **Outside a terminal** (not while you type in a terminal), **In a terminal**, or **In the browser preview** (while it has focus).

| Command | macOS | Windows and Linux | Where |
| --- | --- | --- | --- |
| **Command palette** | `Cmd+K` | `Ctrl+K` | Outside a terminal |
| **Go to file** | `Cmd+P` | `Ctrl+P` | Outside a terminal |
| **New session** | `Cmd+N` or `Cmd+Shift+O` | `Ctrl+N` or `Ctrl+Shift+O` | Outside a terminal |
| **Toggle sidebar** | `Cmd+B` | `Ctrl+B` | Anywhere |
| **Toggle terminal** | `Cmd+J` | `Ctrl+J` | Anywhere |
| **Toggle right panel** | `Cmd+Option+B` | `Ctrl+Alt+B` | Anywhere |
| **Maximize right panel** | Unassigned | Unassigned | Anywhere |
| **Close right panel** | `Cmd+W` | `Ctrl+W` | Outside a terminal |
| **Toggle diff** | `Cmd+D` | `Ctrl+D` | Outside a terminal |
| **Toggle session tree** | `Cmd+Shift+Y` | `Ctrl+Shift+Y` | Outside a terminal |
| **Toggle preview** | `Cmd+Shift+J` | `Ctrl+Shift+J` | Anywhere |
| **Go to pending request** | `Cmd+Shift+A` | `Ctrl+Shift+A` | Anywhere |
| **Copy session link** | `Cmd+Option+L` | `Ctrl+Alt+L` | Anywhere |
| **New terminal** | `Cmd+N` | `Ctrl+N` | In a terminal |
| **Split terminal side by side** | `Cmd+D` | `Ctrl+D` | In a terminal |
| **Split terminal vertically** | `Cmd+Shift+D` | `Ctrl+Shift+D` | In a terminal |
| **Close terminal** | `Cmd+W` | `Ctrl+W` | In a terminal |
| **Focus preview address** | `Cmd+L` | `Ctrl+L` | In the browser preview |
| **Refresh preview** | `Cmd+R` | `Ctrl+R` | In the browser preview |
| **Zoom preview in** | `Cmd+=` or `Cmd++` | `Ctrl+=` or `Ctrl++` | In the browser preview |
| **Zoom preview out** | `Cmd+-` | `Ctrl+-` | In the browser preview |
| **Reset preview zoom** | `Cmd+0` | `Ctrl+0` | In the browser preview |

**Toggle diff** shows the **Changes** panel. **Split terminal vertically** adds a pane below the active one. **Close terminal** closes the active pane. **Close right panel** closes the panel that is showing. When no panel is open, OpenWaggle passes the key on to whatever has focus.

**Go to pending request** moves focus to a request waiting for you, without moving your cursor in the message box. It never answers the request. Press `Escape` to go back to your message.

**Copy session link** copies a link to the session you have open. Some Linux desktops lock the screen on `Ctrl+Alt+L`. If yours does, choose another key.

**Command palette**, **Go to file** and **New session** must always keep at least one shortcut.

Shortcuts also work inside the browser preview page, but ordinary typing stays in the page field that has focus.

On keyboards where `Ctrl+Alt` (AltGr) with a key types a character, such as `Ctrl+Alt+L` for `ł` on a Polish keyboard or `Ctrl+Alt+B` for `{` on Czech and Hungarian keyboards on Windows, the character goes to the field or terminal you are typing in, and the shortcut works everywhere else. In the browser preview on Windows, a letter such as `ł` always goes to the page, while a symbol such as `{` can still run a matching `Ctrl+Alt` shortcut.

## Panel shortcuts

Each view the right panel can show has a command. Its shortcut shows that panel, or closes the right panel when that panel is already showing, the same as clicking its icon on the panel rail. Panel shortcuts work everywhere except while you type in a terminal.

| Panel | Command | Default |
| --- | --- | --- |
| **All panels** | **Toggle All panels** | Unassigned |
| **Changes** | **Toggle diff** | `Cmd/Ctrl+D` |
| **Project Actions** | **Toggle Project Actions** | Unassigned |
| **Scheduled** | **Toggle Scheduled** | Unassigned |
| **Browser** | **Toggle preview** | `Cmd/Ctrl+Shift+J` |
| **Files** | **Toggle Files** | Unassigned |
| **Session Tree** | **Toggle session tree** | `Cmd/Ctrl+Shift+Y` |
| **Resources** | **Toggle Resources** | Unassigned |
| **Hive** | **Toggle Hive** | Unassigned |
| Extension side panels | The panel's name | Unassigned |

Assign them under **Settings > Shortcuts > Panels**. That group lists the built-in panels, **Toggle right panel**, and each installed extension's side panels under the extension's name. Record a key combination, then click **Save**. The reset button returns a built-in panel to its default, and the clear button unassigns it.

Extensions cannot choose shortcuts for their panels. Only you can. A panel shortcut must be unique. OpenWaggle refuses one that a built-in command, a reserved key or another panel already uses, and names what uses it.

An extension panel's shortcut does nothing while the panel cannot be shown, for example while its extension is disabled, untrusted or waiting for an update, and the key goes to whatever has focus. The shortcut is kept when you uninstall the extension. It is listed under **Extensions not installed**, where you can remove it, and it works again if you reinstall the extension.

## Fixed keys

These keys cannot be changed. If you give another command `Cmd/Ctrl+F` or `Cmd/Ctrl+1` to `Cmd/Ctrl+9`, **Settings > Shortcuts** marks it as a conflict with the sidebar.

| Action | macOS | Windows and Linux | Where |
| --- | --- | --- | --- |
| Send message | `Enter` | `Enter` | Message box |
| New line | `Shift+Enter` | `Shift+Enter` | Message box |
| Recall your previous message | `ArrowUp` | `ArrowUp` | Message box, cursor at the start |
| Recall your next message | `ArrowDown` | `ArrowDown` | Message box, cursor at the end |
| Stop editing a queued message | `Escape` | `Escape` | Message box, while editing a queued message |
| Filter projects and sessions | `Cmd+F` | `Ctrl+F` | Outside Settings |
| Clear the filter | `Escape` | `Escape` | Sidebar filter field |
| Open pinned session 1 to 9 | `Cmd+1` to `Cmd+9` | `Ctrl+1` to `Ctrl+9` | Main window |
| Move a panel up or down the rail | `Option+ArrowUp`, `Option+ArrowDown` | `Alt+ArrowUp`, `Alt+ArrowDown` | Panel rail icon |
| Submit a diff comment or review | `Cmd+Enter` | `Ctrl+Enter` | Diff comment field |
| Cancel a diff comment or review | `Escape` | `Escape` | Diff comment field |

`Cmd/Ctrl+F` focuses the filter field at the top of the sidebar, and opens the sidebar first if it is collapsed. `Escape` in that field clears both the text and any state chip.

`Cmd/Ctrl+1` to `Cmd/Ctrl+9` open the first nine rows of the **Pinned** section, in the order the section shows now, so they follow a reorder or a sort change. Positions count the whole section before any filter, so a pin's badge and its shortcut always mean the same session, even while a filter hides rows. You can pin a tenth session, but it gets no shortcut.

## Session Tree keys

Open the Session Tree from **Session Tree** on the panel rail, with `Cmd/Ctrl+Shift+Y`, or from **Session Tree** in the command palette's **Panels** section. These keys work while focus is in the tree:

| Action | Key |
| --- | --- |
| Move focus | `ArrowUp`, `ArrowDown` |
| Expand the focused node, or move to its first child | `ArrowRight` |
| Collapse the focused node, or move to its parent | `ArrowLeft` |
| Select the focused node | `Enter` |
| Close the Session Tree | `Escape` |

## How bindings combine

**Settings > Shortcuts** lists built-in commands and project action shortcuts together, with a search field. A command can have several bindings, in order. You record a key combination, then use the condition builder or its expression field to say where it applies. Settings highlights conflicts, but you can save one on purpose. You can edit and reset default bindings, and remove custom ones.

| Rule | What it means |
| --- | --- |
| Project actions first | A matching project action shortcut wins over a built-in command, however recently you edited the built-in. |
| Last match wins | Within each ordered list of bindings, the last one that matches applies. |
| Same key, different places | Bindings can share a key when their conditions do not overlap. |

Conditions use these names, combined with `!`, `&&`, `||` and parentheses:

| Condition | True when |
| --- | --- |
| `terminalFocus` | You are typing in a terminal. |
| `terminalOpen` | The terminal is open. |
| `previewFocus` | The browser preview has focus. |
| `previewOpen` | The browser preview is open. |
| `modelPickerOpen` | The model selector is open. |

OpenWaggle keeps an unknown condition name, so a binding made for a newer version still loads, and the condition counts as false.

You can also edit a project action's shortcuts with the action itself in **Settings > Project actions**. A binding can apply everywhere or only under a condition. See [Project actions](/docs/configuration/project-actions#add-a-keyboard-shortcut).
