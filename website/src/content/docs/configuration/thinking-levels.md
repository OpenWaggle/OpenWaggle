---
title: "Thinking Levels"
description: "Pi-native reasoning depth selection in OpenWaggle."
order: 3
section: "Configuration"
---

Thinking levels are Pi-native reasoning-depth values:

- `off`
- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`

The composer selector writes the selected level to settings and sends it to Pi when creating the run. Pi applies the level for thinking-capable models.

OpenWaggle no longer supports custom quality tiers, TOML `[quality.*]` sections, or per-project temperature/top-p/max-token overrides. Those fields were legacy OpenWaggle sampling abstractions and are not part of the Pi-native runtime surface.
