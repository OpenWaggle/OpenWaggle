---
title: "Keyboard shortcuts"
description: "Default shortcuts for conversations, terminals, browser preview, and navigation."
order: 9
section: "Customize"
---

These are the default bindings. Open **Settings > Shortcuts** to see or change configurable bindings. Sidebar filtering and pinned-session number keys are reserved rather than configurable. Some shortcuts depend on where focus is: for example, `Cmd/Ctrl+D` splits a terminal when you are typing in it, but opens the diff panel elsewhere.

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
| Toggle diff panel | `Cmd+D` | `Ctrl+D` |
| Toggle right panel | `Cmd+Option+B` | `Ctrl+Alt+B` |
| Toggle browser preview | `Cmd+Shift+J` | `Ctrl+Shift+J` |
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
and `Cmd/Ctrl+D` toggles the diff panel.

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

Open the Session Tree from the header tree icon or the global command palette action **Open Session Tree**. When focus is inside the tree:

| Action | Shortcut |
|--------|----------|
| Move focus | `ArrowUp` / `ArrowDown` |
| Expand focused node or move to first child | `ArrowRight` |
| Collapse focused node or move to parent | `ArrowLeft` |
| Select focused node | `Enter` |
| Close Session Tree | `Escape` |
