---
title: "OpenWaggle Extensions"
description: "Author OpenWaggle extension packages that add desktop surfaces and Pi-native runtime behavior."
order: 4
section: "Extending"
---

OpenWaggle extensions are local packages that can add OpenWaggle desktop contributions and optionally include Pi runtime resources.

The extension host is being implemented under issue #113. This page documents the target author contract so extension packages, QA fixtures, and agents use the same vocabulary while the implementation lands.

## Model

An extension package can declare multiple contributions:

- settings sections
- side panels
- dialogs
- routes
- transcript cards
- status widgets
- compact composer actions
- agent-loop contributions for Pi tools, custom messages, and user interactions

OpenWaggle owns the container: placement, chrome, sizing, docking, fallback behavior, and persistence rules. The extension owns the content mounted inside that container.

Visual contributions use the federated module runtime. The extension exports `mount(context)` from its entry module. The module can use React, Vue, Preact, Svelte, plain DOM, or another UI stack. The required contract is the mount context, not a framework.

## Pi Runtime Parity

Runtime behavior stays Pi-native.

Use Pi extension APIs for tools, runtime resources, session hooks, and user interaction. OpenWaggle provides desktop renderers for those Pi events instead of creating a separate OpenWaggle tool runtime.

Common Pi APIs used by extensions include:

- `pi.registerTool()` for LLM-callable tools
- `renderCall` and `renderResult` for Pi TUI tool rendering
- `pi.registerMessageRenderer()` for Pi TUI custom messages
- `ctx.ui.confirm()`, `ctx.ui.select()`, `ctx.ui.input()`, `ctx.ui.editor()`, `ctx.ui.notify()`, and `ctx.ui.custom()` for user interaction

OpenWaggle desktop renderers bind to Pi-native identifiers such as tool names and custom message types. This keeps Pi TUI and OpenWaggle desktop rendering aligned to the same runtime event.

## Agent-Loop Contributions

Agent-loop contributions render or collect feedback during an active Pi agent loop.

They can be display-only, such as a tool progress card, or interactive, such as an approval dialog. Interactive contributions return typed responses to the pending Pi interaction through OpenWaggle's brokered extension path.

A contribution should bind to a Pi-native identity:

```json
{
  "contributions": {
    "agentLoop": [
      {
        "id": "github.issue-tool-card",
        "renders": {
          "kind": "tool",
          "toolName": "openwaggle.github.listIssues"
        },
        "surface": "transcript-card",
        "runtime": "federated-module",
        "entry": "dist/github-issue-tool-card.js"
      }
    ]
  }
}
```

A single Pi tool or custom message can have multiple OpenWaggle renderers across different surfaces. The transcript is the durable audit trail; dialogs, side panels, status widgets, and composer actions are auxiliary live surfaces.

## Interaction Primitives

OpenWaggle supports Pi interaction primitives as public typed request/response schemas.

Standard primitives have OpenWaggle-owned fallback UI:

- `confirm`: prominent confirmation UI plus transcript record
- `select`: choice UI plus transcript record
- `input`: short text input UI plus transcript record
- `editor`: multiline editor UI plus transcript record
- `notify`: notification/status UI, with transcript record when relevant

`custom` is the escape hatch for interactions that do not fit the standard primitives. OpenWaggle does not execute Pi TUI components inside Electron. A custom interaction needs a matching desktop renderer, or OpenWaggle reports the interaction as unsupported instead of silently hanging the tool.

## Public Data Boundary

Extension renderer modules receive OpenWaggle public DTOs, not Pi package types or OpenWaggle renderer internals.

DTOs preserve Pi semantics such as:

- tool name
- custom message type
- tool call id
- interaction id
- input parameters
- partial and final result state
- structured details
- error state
- session and project identity

Do not import OpenWaggle stores, renderer feature internals, Pi SDK internals, or Electron app internals from visual contribution modules. Use the public extension SDK surface and brokered capabilities.

## State

Pi session data is the durable source of truth for historical agent-loop rendering.

Extension package state can coordinate live surfaces from the same package. Contribution instance state can hold UI-local details for one mounted contribution. Persistent extension data must use typed storage capabilities.

Historical transcript entries must be reconstructable from the mount context and Pi session data after remount, route change, or app restart.

## Development Fixture

The development-only GitHub Issues Overview fixture is the proving extension for the vertical slice.

It should demonstrate:

- settings and side-panel contributions sharing package state
- a Pi-native tool such as `openwaggle.github.listIssues`
- standard Pi interactions such as `confirm`
- a custom desktop interaction or transcript tool renderer
- fallback behavior when the custom renderer is disabled or unavailable

Development fixtures live under `fixtures/extensions/`. They are for tests, demos, and local QA only, and must not be shipped as product content.

## Agent-Discoverable Installed Docs

This page is the repository source of truth for OpenWaggle extension authoring. Packaged builds should derive Pi-style package-local docs from the full user-facing documentation set so self-modifying agents can inspect installed OpenWaggle product, extension, and runtime contracts without relying on a source checkout.

Do not maintain separate hand-written copies for agents. If installed package-local docs diverge, fix the build copy step or the source documentation.

Generated installed docs must be easy to navigate:

- A root `README.md` explains what the docs bundle contains and where it was generated from.
- A topic index maps common questions to stable paths, such as extensions, tools, interactions, sessions, settings, providers, MCP, Pi runtime, and QA fixtures.
- OpenWaggle docs and Pi docs are grouped predictably, so agents do not need to inspect the package layout by trial and error.
- Important extension authoring entries should have obvious aliases or index links for manifest schema, SDK surface, agent-loop contributions, interaction schemas, and federated module mounting.

Agents should resolve installed docs through a typed docs discovery capability instead of hardcoding source or packaged paths. The same topic map should be available to extension code and to OpenWaggle's self-modifying agent context. The generated index is the manual fallback for tools that only have filesystem access.

Docs discovery should return lightweight metadata rather than file content by default:

```typescript
{
  topic: 'openwaggle.extensions.agentLoop',
  title: 'Agent-loop contributions',
  path: '/path/to/openwaggle/docs/extending/openwaggle-extensions.md',
  anchors: ['agent-loop-contributions', 'interaction-primitives'],
  aliases: ['tool renderers', 'transcript cards'],
  keywords: ['ctx.ui.confirm', 'Pi tools', 'custom interaction'],
  source: 'openwaggle'
}
```

First-party topics should be closed and typed so generated indexes and SDK calls can be validated. Extension packages can also ship Pi-style package-local docs in `docs/`. Those docs are exposed through a structured extension namespace with provenance metadata and cannot override first-party OpenWaggle or Pi topics. Extension docs are discoverable regardless of trust or enablement; trust and lifecycle state are metadata, not visibility gates.

```typescript
{
  source: 'extension',
  extensionId: 'openwaggle-github-issues-overview',
  topic: 'configuration'
}
```

## Local Pi Reference

Agents and developers can inspect the installed Pi docs in a checkout for exact Pi runtime semantics:

- `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/tui.md`

OpenWaggle docs define how those Pi concepts are exposed in the desktop product.
