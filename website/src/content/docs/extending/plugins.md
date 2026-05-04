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

Do not document plugin installation flows until they exist in the app.
