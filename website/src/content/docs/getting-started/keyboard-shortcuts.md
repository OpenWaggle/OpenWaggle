---
title: "Keyboard shortcuts"
description: "Default shortcuts for conversations, terminals, browser preview, and navigation."
order: 9
section: "Customize"
---

These are the default bindings. Open **Settings > Shortcuts** to see or change configurable bindings. Sidebar filtering and pinned-session number keys are reserved rather than configurable. Some shortcuts depend on where focus is: for example, `Cmd/Ctrl+D` splits a terminal when you are typing in it, but toggles Changes elsewhere.

## Shortcuts reference

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Send message | `Enter` | `Enter` |
| New line | `Shift+Enter` | `Shift+Enter` |
| New session | `Cmd+N` or `Cmd+Shift+O` | `Ctrl+N` or `Ctrl+Shift+O` |
| Command palette | `Cmd+K` | `Ctrl+K` |
| Go to file | `Cmd+P` | `Ctrl+P` |
| Toggle sidebar | `Cmd+B` | `Ctrl+B` |
| Filter projects and sessions | `Cmd+F` | `Ctrl+F` |
| Open pinned session 1 to 9 | `Cmd+1` … `Cmd+9` | `Ctrl+1` … `Ctrl+9` |
| Toggle terminal | `Cmd+J` | `Ctrl+J` |
| Toggle Changes | `Cmd+D` | `Ctrl+D` |
| Toggle right panel | `Cmd+Option+B` | `Ctrl+Alt+B` |
| Toggle Browser | `Cmd+Shift+J` | `Ctrl+Shift+J` |
| Toggle Session Tree | `Cmd+Shift+Y` | `Ctrl+Shift+Y` |
| Focus a pending request | `Cmd+Shift+A` | `Ctrl+Shift+A` |
| Submit diff comment or review | `Cmd+Enter` | `Ctrl+Enter` |
| Cancel diff comment or review | `Escape` | `Escape` |

Focusing a pending request does not approve it. Read the action and choose a response; use `Escape` to return to your message.

## Terminal shortcuts

These actions apply while focus is inside a terminal pane:

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| New terminal tab | `Cmd+N` | `Ctrl+N` |
| Split terminal side by side | `Cmd+D` | `Ctrl+D` |
| Split terminal below | `Cmd+Shift+D` | `Ctrl+Shift+D` |
| Close active terminal pane | `Cmd+W` | `Ctrl+W` |

Terminal focus makes these bindings contextual. Outside a terminal, `Cmd/Ctrl+N` creates a session
and `Cmd/Ctrl+D` toggles Changes.

## Panel shortcuts

Every panel the right panel can show has its own shortcut command. Pressing a panel's shortcut
shows that panel, or closes the right panel when that panel is already showing, just like clicking
its icon on the panel rail.

| Panel | Default |
|-------|---------|
| All panels | Unassigned |
| Changes | `Cmd/Ctrl+D` |
| Project Actions | Unassigned |
| Browser | `Cmd/Ctrl+Shift+J` |
| Files | Unassigned |
| Session Tree | `Cmd/Ctrl+Shift+Y` |
| Resources | Unassigned |
| Extension side panels | Unassigned |

Assign the unassigned ones under **Settings > Shortcuts > Panels**. That group lists the built-in
panels, the right panel toggle, and each installed extension's side panels under the extension's
name. Record a combination, then **Save**; use the reset button to return a built-in panel to its
default or the clear button to unassign it.

Extensions cannot choose shortcuts for their panels; only you can. A panel shortcut must be unique:
OpenWaggle refuses one that a built-in command, a reserved combination, or another panel already
uses, and names what uses it. Panel shortcuts work everywhere except while you type in a terminal.

An extension panel's shortcut does nothing while the panel cannot be shown, for example while its
extension is disabled, untrusted, or waiting for an update, and the key goes to whatever has focus.
The binding is kept when you uninstall the extension. It is listed under **Extensions not
installed** so you can remove it, and it works again if you reinstall the extension.

## Right panel and browser preview

`Cmd/Ctrl+W` closes the active right panel outside a terminal. When no panel is open, OpenWaggle
leaves that shortcut to the focused application or browser content instead of swallowing it.

These actions apply while focus is inside a Browser preview:

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Focus address | `Cmd+L` | `Ctrl+L` |
| Refresh | `Cmd+R` | `Ctrl+R` |
| Zoom in | `Cmd+=` or `Cmd++` | `Ctrl+=` or `Ctrl++` |
| Zoom out | `Cmd+-` | `Ctrl+-` |
| Reset zoom | `Cmd+0` | `Ctrl+0` |

Shortcuts also work inside the preview page. Ordinary typing stays in the focused page field.

## Customize bindings

Open **Settings > Shortcuts** to search built-in and Project Action bindings in one place. Each
command may have more than one ordered binding. Record a chord, then use the visual condition
builder or its expression field to control where it applies. Conflicts are highlighted but may be
saved intentionally. Matching Project Action rules take precedence over built-in rules. Within each
ordered list, the last matching rule wins. Default bindings can be edited and reset, while custom
rules can also be removed.

Conditions can use `terminalFocus`, `terminalOpen`, `previewFocus`, `previewOpen`, and
`modelPickerOpen`, combined with `!`, `&&`, `||`, and parentheses. Unknown context names are kept for
forward compatibility and evaluate to false until the runtime provides them.

## Project Action bindings

Open **Settings > Project actions** to edit an action and its bindings directly, or use the unified
browser under **Settings > Shortcuts**. A binding can be unconditional or contextual.

Project Action bindings form the final project-scoped layer over built-ins, so a matching Project
Action rule overrides a built-in command regardless of when the built-in was edited. Context-specific
rules can reuse the same chord when their conditions do not overlap.

## Sidebar

`Cmd/Ctrl+F` focuses the filter field at the top of the sidebar, opening the sidebar first if it is
collapsed. `Escape` while the field has focus clears both the text filter and any active state
chip, which is the way out of a narrowed sidebar without reaching for the mouse.

`Cmd/Ctrl+1` through `Cmd/Ctrl+9` open the first nine rows of the **Pinned** section. The mapping is
positional against the section as currently ordered, so it follows a reorder or a sort change.
Positions are assigned over the whole section before any filtering, so a badge and its shortcut
always refer to the same session even while a state chip or the text filter is hiding rows. A tenth
pin is still allowed, it simply has no shortcut.

## Session tree

Open the Session Tree from **Session tree** on the panel rail, with `Cmd+Shift+Y` / `Ctrl+Shift+Y`, or from **Session Tree** in the command palette's **Panels** section. When focus is inside the tree:

| Action | Shortcut |
|--------|----------|
| Move focus | `ArrowUp` / `ArrowDown` |
| Expand focused node or move to first child | `ArrowRight` |
| Collapse focused node or move to parent | `ArrowLeft` |
| Select focused node | `Enter` |
| Close Session Tree | `Escape` |
