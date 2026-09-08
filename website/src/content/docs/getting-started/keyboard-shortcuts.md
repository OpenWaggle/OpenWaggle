---
title: "Keyboard Shortcuts"
description: "Quick reference for all keyboard shortcuts available in OpenWaggle."
order: 4
section: "Getting Started"
---

## Shortcuts Reference

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| Send message | `Enter` | `Enter` |
| New line | `Shift+Enter` | `Shift+Enter` |
| New session | `Cmd+N` | `Ctrl+N` |
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
| Submit diff comment or review | `Cmd+Enter` | `Ctrl+Enter` |
| Cancel diff comment or review | `Escape` | `Escape` |

## Terminal Shortcuts

These actions apply while focus is inside a terminal pane:

| Action | macOS | Windows/Linux |
|--------|-------|---------------|
| New terminal tab | `Cmd+N` | `Ctrl+N` |
| Split terminal side by side | `Cmd+D` | `Ctrl+D` |
| Split terminal below | `Cmd+Shift+D` | `Ctrl+Shift+D` |
| Close active terminal pane | `Cmd+W` | `Ctrl+W` |

Terminal focus makes these bindings contextual. Outside a terminal, `Cmd/Ctrl+N` creates a session
and `Cmd/Ctrl+D` toggles the diff panel.

## Right Panel and Browser Preview

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

Native preview content and the rest of the app use the same resolver, so an override runs once and
ordinary page typing stays inside the page.

## Customize Bindings

Open **Settings > Shortcuts** to search built-in and Project Action bindings in one place. Each
command may have more than one ordered binding. Record a chord, then use the visual condition
builder or its expression field to control where it applies. Conflicts are highlighted but may be
saved intentionally; the newest active rule matching the chord wins globally. Default bindings can
be edited and reset, while custom rules can also be removed.

Conditions can use `terminalFocus`, `terminalOpen`, `previewFocus`, `previewOpen`, and
`modelPickerOpen`, combined with `!`, `&&`, `||`, and parentheses. Unknown context names are kept for
forward compatibility and evaluate to false until the runtime provides them.

## Project Action Bindings

Open **Settings > Project actions** to edit an action and its bindings directly, or use the unified
browser under **Settings > Shortcuts**. A binding can be unconditional or contextual.

Project Action bindings participate in the same ordered resolution as built-ins. A later active
Project Action rule can intentionally override a built-in command, and context-specific rules can
reuse the same chord without colliding at runtime.

## Sidebar

`Cmd+F` focuses the filter field at the top of the sidebar, opening the sidebar first if it is
collapsed. `Escape` while the field has focus clears both the text filter and any active state
chip, which is the way out of a narrowed sidebar without reaching for the mouse.

`Cmd+1` through `Cmd+9` open the first nine rows of the **Pinned** section. The mapping is
positional against the section as currently ordered, so it follows a reorder or a sort change.
Positions are assigned over the whole section before any filtering, so a badge and its shortcut
always refer to the same session even while a state chip or the text filter is hiding rows. A tenth
pin is still allowed, it simply has no shortcut.

## Session Tree

Open the Session Tree from the header tree icon or the global command palette action **Open Session Tree**. When focus is inside the tree:

| Action | Shortcut |
|--------|----------|
| Move focus | `ArrowUp` / `ArrowDown` |
| Expand focused node or move to first child | `ArrowRight` |
| Collapse focused node or move to parent | `ArrowLeft` |
| Select focused node | `Enter` |
| Close Session Tree | `Escape` |
