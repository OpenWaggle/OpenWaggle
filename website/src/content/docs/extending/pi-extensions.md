---
title: "Pi extensions"
description: "Use Pi extension APIs for agent tools and hooks, and understand OpenWaggle's desktop integration boundaries."
order: 8
section: "Developer docs"
kind: "guide"
---

A Pi extension adds an agent tool, registers a provider, or reacts to events in an agent session. Pi is the coding-agent runtime inside OpenWaggle, so a Pi extension changes what the agent can do. It does not add any desktop UI by itself. Start with Pi's [extension reference](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md). If you also want a settings page, a panel, or a custom look for a tool, declare those in an [OpenWaggle extension](/docs/extending/openwaggle-extensions).

## Choose between a skill and an extension

A [skill](/docs/extending/skills-system) gives the agent instructions. A Pi extension runs code and can change which tools the agent has. If all you need is a prompt you can repeat, write a skill, not code.

## Know where Pi finds your extension

OpenWaggle gives Pi the project's resource folders for skills, extensions, prompts, and themes, in this order:

```text
.openwaggle > .pi > .agents
```

An enabled OpenWaggle package can add the Pi resource folders it declares, ahead of `.pi`. OpenWaggle does not load everything in `.openwaggle/extensions` as Pi code. Only eligible packages, and the folders they declare, reach Pi. Pi then applies its own loading and conflict rules. OpenWaggle packages have their own manifest and trust steps. See [Install extensions](/docs/extending/plugins).

When you type `/` in the composer, the **Pi extensions** group lists the commands a Pi extension registers, and Pi's own `/mcp`, in a session or in a new session for a project.

## Show your tool in the app

Pi's terminal UI renderers do not run in the desktop app. The standard questions a tool can ask, such as `confirm` and `select`, have OpenWaggle's own UI as a fallback. A custom question needs a matching desktop renderer. See [Answer a question from Pi](/docs/extending/openwaggle-extensions#answer-a-question-from-pi).

To register a custom provider, see Pi's [`pi.registerProvider()` reference](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/custom-provider.md).

## Connect MCP servers

You do not need a Pi extension to connect an MCP server. Set it up in [MCP settings](/docs/configuration/mcp).

OpenWaggle loads Pi's built-in MCP, codemode, and tool-search extensions into every session, so MCP works as it does in the `pi` command. In Pi, an extension that registers its own `/mcp` command, such as `pi-mcp-adapter`, replaces Pi's built-in MCP. OpenWaggle does not load `pi-mcp-adapter`, because the built-in support already covers it.

OpenWaggle also does not load an installed `@openwaggle/pi-waggle` package, because OpenWaggle has Waggle built in. The `pi` command still loads it.

Extensions can still add servers to a session with `pi.registerMcpServer()`, as in Pi.

## Change OpenWaggle itself

When you change OpenWaggle's own code, keep Pi SDK imports in `src/main/adapters/pi/`. The application and IPC layers call OpenWaggle's own ports, and the renderer receives OpenWaggle's own data and events. The dedicated `packages/pi-*` packages may use the Pi SDK inside their own package.

New tools should use Pi's extension APIs, not a second way of running tools. How a tool looks in the app, and any new host capability, needs support in OpenWaggle's public contracts.

For MCP work in the app, keep transports, configuration files, and sign-in storage in `src/main/adapters/mcp/`, and the code that loads Pi's extensions in `src/main/adapters/pi/`.
