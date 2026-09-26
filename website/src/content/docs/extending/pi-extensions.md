---
title: "Pi extensions"
description: "Use Pi extension APIs for agent tools and hooks, and understand OpenWaggle's desktop integration boundaries."
order: 8
section: "Developer docs"
---

Use a Pi extension when you need to add an agent tool, register a provider, or respond to agent-session events. Pi is the coding-agent runtime inside OpenWaggle. A Pi extension changes runtime behavior; it does not automatically add desktop UI.

Start with Pi's [extension reference](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md). If you also need a settings page, panel, or custom tool display, use the [OpenWaggle extension package format](/docs/extending/openwaggle-extensions) to declare those desktop contributions.

## Skills vs runtime extensions

A [skill](/docs/extending/skills-system) provides instructions. A runtime extension executes code and can change the tools available to the agent. Do not install runtime code merely to provide a repeatable prompt.

OpenWaggle supplies project resource roots to Pi in this order:

```text
.openwaggle > .pi > .agents
```

OpenWaggle supplies roots for skills, extensions, prompts, and themes in that order. Enabled OpenWaggle packages can insert declared Pi resource roots before `.pi`. The managed `.openwaggle/extensions` package directory is not blindly loaded as executable Pi code: package eligibility controls which packages and declared roots reach Pi. Pi applies its own loading and conflict rules to the supplied resources. OpenWaggle packages have their own manifest and trust lifecycle; use [Install extensions](/docs/extending/plugins) for that workflow.

Pi terminal UI renderers do not run as desktop UI. Standard interactions have OpenWaggle fallbacks, while custom interactions need a matching desktop renderer. See [Interaction primitives](/docs/extending/openwaggle-extensions#interaction-primitives).

For custom provider registration, see Pi's [`pi.registerProvider()` reference](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md).

## Integrating with the app

When changing OpenWaggle itself, keep Pi SDK imports in `src/main/adapters/pi/`. Application and IPC layers call OpenWaggle-owned ports; the renderer receives OpenWaggle-owned data and events. Dedicated `packages/pi-*` packages may use Pi SDKs within their package boundaries.

New tools should use Pi extension APIs rather than a second tool execution system. Desktop presentation and any new host capabilities need explicit support in OpenWaggle's public contracts.

## MCP

You do not need a Pi extension to connect an MCP server. Configure it through [MCP settings](/docs/configuration/mcp).

OpenWaggle owns MCP configuration, trust, authentication, and server lifecycle. An internal extension exposes its compact `mcp` gateway and optional direct tools to Pi; users do not install a separate MCP adapter package into Pi settings.

For app development, keep MCP protocol behavior in `src/main/adapters/mcp/`. Pi-facing code belongs in `src/main/adapters/pi/` and consumes the OpenWaggle MCP port instead of owning server lifecycle or configuration.
