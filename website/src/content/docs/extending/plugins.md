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

## Planned OpenWaggle Extensions

The planned OpenWaggle extension host uses first-class extension packages for desktop contributions and optional Pi runtime resources. Visual desktop contributions are expected to mount into OpenWaggle-owned containers through a framework-neutral federated-module runtime, while extension integration goes through the public SDK/API and brokered capabilities.

Do not document plugin installation flows until they exist in the app.
