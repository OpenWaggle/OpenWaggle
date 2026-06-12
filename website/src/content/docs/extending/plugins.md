---
title: "Plugins"
description: "Current plugin status in OpenWaggle."
order: 4
section: "Extending"
---

OpenWaggle does not currently expose an end-user plugin marketplace or plugin manager.

The active extension points today are:

- Pi-native project resources loaded with `.openwaggle > .pi > .agents` precedence for skills, extensions, prompts, and themes
- project instructions through `AGENTS.md`
- Pi-native runtime extension work behind main-process adapter/port boundaries
- local OpenWaggle extension packages for desktop contributions and optional Pi runtime resources

## OpenWaggle Extensions

OpenWaggle extension packages are the current local package model for Settings sections, side panels, dialogs, extension routes, transcript/tool renderers, status widgets, command palette entries, slash commands, and Pi runtime/resource additions.

Use [OpenWaggle Extensions](/docs/extending/openwaggle-extensions/) for the package format and lifecycle. The public marketplace and remote discovery service remain out of scope; local packages are installed, trusted, updated, disabled, and removed through the Extension Manager or the approved package workflow.
