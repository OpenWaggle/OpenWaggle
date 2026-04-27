---
title: "Pi Extensions"
description: "Where future runtime extensions belong in the Pi-native architecture."
order: 3
section: "Extending"
---

OpenWaggle runtime capabilities are routed through Pi adapter boundaries.

Future runtime capabilities should be implemented as Pi-native extensions or adapter-backed ports:

- Pi SDK imports stay in `src/main/adapters/pi/`.
- Application and IPC layers consume vendor-free OpenWaggle ports.
- Renderer code displays OpenWaggle-owned DTOs and runtime events.
- New tools should use Pi-native extension points and OpenWaggle-owned IPC DTOs.

This keeps OpenWaggle extensible without leaking vendor SDK types across the app.

Pi reference: [Extensions](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md).

## Skills vs Runtime Extensions

Skills are instruction packages. OpenWaggle supports `.openwaggle/skills/` by adding it to Pi's loader, while Pi continues to load `.pi/skills/` and `.agents/skills/`.

Runtime extensions change what the agent can actually do. Those belong behind Pi adapter boundaries and need explicit product support in IPC and the renderer.

For custom provider registration, see Pi's [`pi.registerProvider()` documentation](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md).
