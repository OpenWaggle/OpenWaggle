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
| Toggle sidebar | `Cmd+B` | `Ctrl+B` |
| Filter projects and sessions | `Cmd+F` | `Ctrl+F` |
| Open pinned session 1 to 9 | `Cmd+1` … `Cmd+9` | `Ctrl+1` … `Ctrl+9` |
| Toggle terminal | `Cmd+J` | `Ctrl+J` |
| Toggle diff panel | `Cmd+D` | `Ctrl+D` |
| Toggle Session Tree | `Cmd+Shift+Y` | `Ctrl+Shift+Y` |
| Submit diff comment or review | `Cmd+Enter` | `Ctrl+Enter` |
| Cancel diff comment or review | `Escape` | `Escape` |
| Command palette | `Cmd+K` | `Ctrl+K` |

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

Open the Session Tree from the header tree icon or the command palette action **Open Session Tree**. When focus is inside the tree:

| Action | Shortcut |
|--------|----------|
| Move focus | `ArrowUp` / `ArrowDown` |
| Expand focused node or move to first child | `ArrowRight` |
| Collapse focused node or move to parent | `ArrowLeft` |
| Select focused node | `Enter` |
| Close Session Tree | `Escape` |
