---
title: "OpenWaggle Extensions"
description: "Author OpenWaggle extension packages that add desktop surfaces and Pi-native runtime behavior."
order: 4
section: "Extending"
---

OpenWaggle extensions are local packages that can add OpenWaggle desktop contributions and optionally include Pi runtime resources.

This page is the source of truth for the current extension author contract. Use it when a user or agent needs to create, build, install, trust, update, disable, or remove an extension package. If an extension needs a host capability that is not documented here, the user must update OpenWaggle before the extension can rely on that capability.

## Basic Extension How-To

A basic extension is a directory with an `openwaggle.extension.json` manifest and one or more declared runtime files.

For a project-local install, place it under the project:

```text
my-project/
  .openwaggle/
    extensions/
      example-extension/
        openwaggle.extension.json
        package.json
        src/
          settings.js
          side-panel.js
        modules/
          settings.js
          side-panel.js
        docs/
          README.md
```

The directory name must match the manifest `id`. Global extensions are discovered from OpenWaggle's app-data `extensions/` directory and should be managed through Settings > Extensions or the approved package workflow, because they can affect every project where they are enabled.

Create the manifest first:

```json
{
  "manifestVersion": 1,
  "id": "example-extension",
  "name": "Example Extension",
  "version": "0.1.0",
  "description": "A small extension with settings and a side panel.",
  "sdk": {
    "openwaggle": ">=0.1.0 <0.2.0"
  },
  "sourceFiles": ["package.json", "src/settings.js", "src/side-panel.js"],
  "builtArtifacts": ["package.json", "modules/settings.js", "modules/side-panel.js"],
  "install": {
    "source": "prebuilt"
  },
  "capabilities": [
    {
      "id": "openwaggle.storage",
      "methods": ["get", "set", "list"],
      "scopes": ["project"]
    }
  ],
  "contributions": {
    "settingsSections": [
      {
        "id": "example.settings",
        "title": "Example Settings",
        "runtime": "federated-module",
        "execution": "host-renderer",
        "entry": "modules/settings.js",
        "capability": "openwaggle.storage",
        "methods": ["get", "set", "list"]
      }
    ],
    "sidePanels": [
      {
        "id": "example.panel",
        "title": "Example Panel",
        "runtime": "federated-module",
        "execution": "host-renderer",
        "entry": "modules/side-panel.js",
        "capability": "openwaggle.storage",
        "methods": ["get", "list"]
      }
    ]
  }
}
```

Then build or copy the entry modules listed in `builtArtifacts`. A federated-module entry exports `mount(context)`:

```js
export async function mount(context) {
  const root = document.createElement('section')
  root.textContent = `Mounted ${context.contribution.id}`
  context.root.append(root)

  return () => {
    root.remove()
  }
}
```

## Lifecycle Checklist

Use this checklist for a basic package:

1. Create a complete package proposal with the manifest and every file that should exist in the package directory.
2. Choose the package scope. Project-local packages live under `<project>/.openwaggle/extensions/<extension-id>/`. Global packages live under OpenWaggle app data `extensions/<extension-id>/` and affect every project unless a project opts out.
3. For agent-created or agent-updated packages, approve the exact proposal before OpenWaggle writes files. Approval is tied to the extension id, scope, operation, file paths, and file contents. Global package writes require a second global-impact confirmation.
4. Ensure `openwaggle.extension.json` lists every source file, built artifact, capability, network origin, runtime requirement, Pi resource root, docs topic, and contribution.
5. Build the package. If `install.source` is `prebuilt`, ship the built files already present in `builtArtifacts`. If `install.source` is `local-build`, declare `build.command` and `build.outputs`, then use Settings > Extensions to approve and run the build.
6. Install the package by writing it to the chosen extension root through Settings > Extensions or the approved package workflow. Manual project-local development can place files directly under `.openwaggle/extensions/<extension-id>/`, but user-local trust, enablement, build approval, storage, and project opt-outs are not committed with the package.
7. Open Settings > Extensions and refresh discovery.
8. Inspect the package path, SDK range, content hash, install source, build command, capabilities, network origins, trusted local code, runtime requirements, docs topics, Pi resource roots, and diagnostics.
9. Trust the extension. Trust pins the current package identity, SDK range, version, granted privileges, and content hash.
10. Enable the extension.
11. Reload the extension registry so eligible contributions can appear on their surfaces.
12. Update the extension by replacing the package with a new approved proposal and bumping the version. OpenWaggle treats the changed content hash as an explicit update; approve the update, then enable and reload again if the update flow disables runtime loading.
13. Disable the extension from Settings > Extensions to stop all contributions without deleting files. This unregisters contributions, tears down mounted sandbox frames and runtime subscriptions as surfaces unmount, revokes module access, and marks the package as not reloaded. For global extensions, use project availability controls to disable only one project.
14. Remove the extension from Settings > Extensions by choosing Remove and approving the confirmation. Project-local removal deletes `<project>/.openwaggle/extensions/<extension-id>/`; global removal deletes the app-data `extensions/<extension-id>/` package and requires explicit global-impact confirmation. The approved remove workflow unregisters contributions, tears down runtime/module access, deletes lifecycle trust and enablement pins, and removes the package directory. Extension-owned storage cleanup should be a separate explicit user choice when data deletion matters.
15. Agents must not delete extension package directories directly as a shortcut. They should propose the removal, get user approval for the exact extension id and scope, then call the host remove workflow so OpenWaggle can perform lifecycle cleanup before the files disappear.

## Model

OpenWaggle is manifest-first. The manifest is the contract the host reads before running extension code. If a contribution, capability, file, network origin, runtime requirement, or build step is not declared in the manifest, OpenWaggle should not treat it as available at runtime.

Static manifest contributions are the current public author path. The host has internal authorization guards for future runtime contribution registration, and those guards only allow registration under contribution families already declared in the manifest. Runtime code cannot request new capabilities, methods, or scopes beyond the manifest declaration. Until a public SDK method for runtime registration exists, authors should express contributions statically in `openwaggle.extension.json`.

An extension package can declare multiple contribution families:

- `settingsSections` for Settings content owned by the extension.
- `sidePanels` for right-side or auxiliary panels.
- `dialogs` for host-owned modals and dialog content.
- `routes` for extension-owned route content inside an OpenWaggle route container.
- `transcriptRenderers` for durable transcript rendering.
- `toolRenderers` for Pi-native tool call/result cards.
- `customMessageRenderers` for Pi custom message records.
- `interactionRenderers` for Pi interaction requests such as `confirm`, `select`, `input`, `editor`, `notify`, and typed custom interactions.
- `statusWidgets` for compact status surfaces.
- `commands` and `slashCommands` for command palette and composer-adjacent launchers.

OpenWaggle owns the container: placement, chrome, sizing, docking, fallback behavior, and persistence rules. The extension owns the content mounted inside that container.

Visual contributions use the federated module runtime. The extension exports `mount(context)` from its entry module. The module can use React, Vue, Preact, Svelte, plain DOM, or another UI stack. The required contract is the mount context, not a framework.

Composer-adjacent contributions are compact actions, slash commands, or launchers. They can open host-owned dialogs, side panels, or interaction surfaces, but they must not inject arbitrary input controls into the composer text flow.

Extensions add to or augment OpenWaggle-owned surfaces. They cannot replace the core shell layout, replace global navigation, or install app-wide OpenWaggle themes. Use `context.theme` and scoped extension styles for mounted content only.

## Contribution Surfaces At A Glance

Choose the surface by the job the extension is doing, not by the framework used to render it.

- `settingsSections` are for extension configuration, account setup, feature toggles, and diagnostics that belong in Settings. They should read and write settings through brokered SDK capabilities.
- `sidePanels` are for auxiliary workspace content that benefits from staying open while the user works, such as issue lists, project metadata, logs, or package state shared with other contributions.
- `dialogs` are for focused host-owned modals, confirmations, pickers, and forms that should temporarily interrupt the current workflow.
- `routes` are for larger extension-owned views mounted inside an OpenWaggle route container. They should not replace core shell navigation.
- `commands` and `slashCommands` launch actions from the command palette or composer. Composer contributions are compact launchers or selectors, not arbitrary controls inside the composer text input.
- `transcriptRenderers` render durable Pi session records in the chat transcript. They must be reconstructable from the mount context and Pi session data after remount or restart.
- `toolRenderers` render Pi-native tool calls and results. They customize desktop presentation for Pi tools; they do not create a separate OpenWaggle tool runtime.
- `customMessageRenderers` render Pi custom message records while preserving the Pi-native custom message type as the binding identity.
- `interactionRenderers` collect feedback for pending Pi interactions such as `confirm`, `select`, `input`, `editor`, `notify`, or typed custom interactions, then return the typed response through the SDK.
- `statusWidgets` are compact status surfaces for live progress, connection state, or extension-owned indicators.

The same extension can contribute to multiple surfaces. Shared package state can coordinate those live surfaces, while the transcript remains the durable audit trail for agent-loop activity.

## Federated Modules, SDK Context, And Theme

Some early design notes called the visual path a "module-federation lane." The public author contract is now the `federated-module` runtime. OpenWaggle may implement that runtime with module federation, import maps, versioned runtime URLs, or another loader, but extension authors target the same framework-neutral `mount(context)` entry point.

`mount(context)` receives the only OpenWaggle objects a visual contribution should use:

- `context.root`: the host-owned DOM root where the extension attaches content.
- `context.contribution`: package id, contribution id, contribution family, and manifest-declared metadata for the mounted contribution.
- `context.surface`: surface-specific data such as the active settings section, side panel container, transcript record, tool event, or pending interaction.
- `context.sdk`: typed capability calls for package storage, selected OpenWaggle state/actions/settings/docs discovery, and surface behavior such as sending surface actions or responding to pending interactions.
- `context.theme`: semantic host theme data, including tokens and CSS-variable-shaped values for color, typography, spacing, radius, focus, and elevation.

Use theme tokens from `context.theme` instead of importing OpenWaggle CSS internals or hard-coding app colors. The host owns token values and can adapt them to user settings, high-contrast modes, and future themes. The extension owns only its mounted content and should keep styles scoped to that content.

The SDK/context boundary is also the safety boundary. A renderer module can request brokered actions through `context.sdk`, but it must not import writable OpenWaggle stores, renderer feature files, Electron IPC helpers, or Pi SDK internals.

## Optional Shared Author Modules

The required runtime contract is still `mount(context)`. OpenWaggle also exposes framework-neutral shared author modules for extensions that want typed helpers:

- `extension-sdk` exports the broker SDK factory, operation result types, storage helpers, OpenWaggle state/actions/settings/docs helpers, and the public `OpenWaggleExtensionMountContext` / `OpenWaggleFederatedModule` types.
- `extension-theme` exports semantic theme tokens, CSS variable names, fallback token creation, and helpers for serializing host theme values.
- `extension-ui` exports framework-neutral class names, data attributes, a class-name join helper, and a small CSS stylesheet generator built from OpenWaggle theme variables.

These modules are plain TypeScript and DOM helpers. They do not import React, React DOM, renderer feature code, Zustand stores, Electron IPC helpers, or Pi SDK internals.

The modules are optional. Extension modules can ignore them and use only the objects passed in `context`. If an extension build consumes the helpers, keep them bundled into the extension artifact or resolve them through the OpenWaggle-provided author-module mechanism for that installed SDK version. Do not import source paths from an arbitrary OpenWaggle checkout as a runtime dependency for a distributed extension.

Plain DOM example:

```js
import {
  createOpenWaggleExtensionUiStylesheet,
  OPENWAGGLE_EXTENSION_UI_CLASS_NAMES as ui,
} from 'openwaggle/extension-ui'

export async function mount(context) {
  const style = document.createElement('style')
  style.textContent = createOpenWaggleExtensionUiStylesheet({
    theme: context.theme,
  })

  const panel = document.createElement('section')
  panel.className = `${ui.root} ${ui.panel} ${ui.stack}`

  const heading = document.createElement('h2')
  heading.className = ui.heading
  heading.textContent = context.contribution.title

  const body = document.createElement('p')
  body.className = ui.text
  body.textContent = `Mounted for ${context.extension.name}`

  panel.append(heading, body)
  context.root.append(style, panel)

  return () => {
    style.remove()
    panel.remove()
  }
}
```

The import specifier shown above names the public helper module conceptually. First-party fixtures in this repository resolve the same helpers from `@shared/extension-ui`. Distributed extensions should either bundle the compatible helper code or resolve the versioned helper module supplied by the installed OpenWaggle SDK. The stable part for runtime compatibility is the mount context and brokered SDK capability contract.

## How An Extension Appears On Screen

Think of an extension like a toy that needs a safe play table.

OpenWaggle owns the table: where the extension appears, how big the container is, when it can run, and which APIs it can call. The extension owns the toy: the UI and behavior inside that container.

```mermaid
flowchart TD
  A["1. User installs or edits an extension package"] --> B["2. OpenWaggle reads the manifest"]
  B --> C["3. OpenWaggle checks files, SDK range, paths, hashes, and lifecycle state"]
  C --> D{"Does it need a local build?"}
  D -- "Yes" --> E["4a. User approves the build"]
  E --> F["4b. OpenWaggle runs build.command and checks build outputs"]
  D -- "No" --> G["5. User trusts, enables, and reloads the extension"]
  F --> G
  G --> H["6. OpenWaggle builds the contribution registry"]
  H --> I["7. A surface asks for the contribution: settings, side panel, transcript, tool card, dialog, etc."]
  I --> J["8. OpenWaggle creates the owned iframe/container"]
  J --> K["9. The iframe imports the extension module"]
  K --> L["10. OpenWaggle calls mount(context)"]
  L --> M["11. The extension renders UI; OpenWaggle observes mounted state and size"]
```

The important split is:

- OpenWaggle decides whether the extension is allowed to render.
- OpenWaggle creates and sizes the container.
- The extension decides what to render inside `mount(context)`.
- The extension can render immediately or show its own skeleton while it does async work.

## Readiness And Loading

An extension contribution is ready to be rendered only after all lifecycle checks pass:

- manifest schema is valid
- referenced files exist
- SDK range is compatible
- content hash matches the trusted pin
- local build is approved and succeeded, when required
- extension is trusted
- extension is enabled
- extension has been reloaded after the last trust, enable, build, or update change
- project opt-outs do not block the current project

OpenWaggle builds the contribution registry from that state. The registry is the menu of extension contributions that the app can actually use. If a contribution is not in the registry, the UI treats it as unavailable and uses an OpenWaggle-owned fallback when one exists.

Mount readiness is separate from registry readiness:

- Registry readiness means OpenWaggle knows the contribution is allowed and available.
- Mount readiness means the iframe loaded the module and the module's `mount(context)` function resolved.

OpenWaggle shows a generic mounting state only until `mount(context)` resolves. If an extension needs to fetch data, call storage, or wait for a network API, it should render a lightweight shell or skeleton first and continue the async work after the initial render.

## Local Builds

Most extensions can ship already-built JavaScript in `builtArtifacts`. Those extensions do not compile at render time.

Extensions that need a local build declare it in the manifest:

```json
{
  "install": {
    "source": "local-build"
  },
  "build": {
    "command": "pnpm build",
    "outputs": ["dist/index.js"]
  },
  "builtArtifacts": ["dist/index.js"]
}
```

Local builds are intentionally explicit:

- The user approves the build before OpenWaggle runs it.
- The command runs in the extension package directory.
- OpenWaggle stores the build status and a capped build log.
- Build outputs must also be listed in `builtArtifacts`.
- A failed build blocks the extension from being trusted/enabled for runtime use.
- Changing source files changes the build-plan hash, so the build must be approved again.

Build time is whatever the extension's build command takes. Runtime rendering does not run that build again.

## Trust And Capabilities

OpenWaggle extensions are trusted local software after explicit user approval. Trust is not implied by package discovery.

Before trust, OpenWaggle reads the manifest, validates declared files, checks SDK compatibility, calculates the content hash, checks runtime requirements, and shows diagnostics. After trust, runtime loading is still gated by enablement, update state, build status, reload status, project opt-outs, and contribution-level eligibility.

The trust review should make these privileges visible:

- Trusted visual modules: federated-module entries can run inside OpenWaggle-owned contribution containers after trust, enablement, and reload.
- Trusted local main code: manifests may declare trusted local main code when the extension needs host-side behavior. This is privileged local code and should require explicit trust.
- Network access: `network.origins` declares external origins such as `https://api.github.com`. Undeclared network origins should not be treated as approved.
- Build scripts: `install.source: "local-build"` plus `build.command` asks the user to run local code during build. Build approval is separate from runtime trust.
- External runtime requirements: `runtimeRequirements` declares required binaries or commands. Missing requirements block trust or runtime eligibility until fixed.
- Brokered capabilities: `capabilities` declares SDK capabilities, methods, and scopes such as `openwaggle.storage` with `get`, `set`, and `list` for `project` scope.

Trust pins the current package content hash. Editing manifest files, source files, built artifacts, or the build plan changes the hash and creates an explicit update path. Extension updates are user-approved; they are not silent runtime swaps.

Current v1 enforcement is capability-specific:

- Frame-mounted visual contributions run with iframe sandboxing and a CSP that restricts network `connect-src` to declared `network.origins`.
- Trusted main-process code is trusted local Node code. It receives only the public broker SDK for OpenWaggle integration, but OpenWaggle does not provide a process-level network firewall for that code. Declare network origins so the user can review them before trust.
- `trusted.renderer` is represented as a privileged manifest requirement for user review. The current visual contribution path still uses the federated-module container contract; do not rely on direct imports from renderer internals.

## Agent-Created And Agent-Updated Packages

Agents may help author project-local or global extension packages, but package writes are not an extension SDK capability. Extension code cannot directly modify another extension package through OpenWaggle. The supported path is an OpenWaggle-owned workflow:

1. The agent proposes the package id, scope, operation (`create`, `update`, or `remove`), manifest, declared permissions, build plan, and full file list.
2. OpenWaggle calculates a proposal hash from the operation, extension id, scope, file paths, and file contents.
3. The user reviews the proposal and approves that exact hash.
4. For global packages, the user also confirms the global impact because the package can affect every project where it is enabled.
5. OpenWaggle writes, replaces, or removes the package, then refreshes discovery and lifecycle state.

For create and update package writes, OpenWaggle first returns a proposal view with the operation, normalized file paths, per-file content hashes, byte counts, the full proposal hash, and whether global-impact confirmation is required. Create proposals are valid only when the package does not already exist; update proposals are valid only when the package already exists. If the package state changes between proposal and apply, OpenWaggle rejects the stale operation before writing files. Global write approval must include a second confirmation tied to the same proposal hash and the `global-extension-package-write` risk marker.

Project-local extension source can be committed and shared with the project. Trust records, enablement, permission grants, build approvals, project opt-outs, lifecycle pins, and extension storage remain user-local.

An approved update replaces the package directory as a full package. Stale files that are not in the new package proposal are removed. Runtime loading is disabled until the updated package is reviewed, trusted or update-approved, enabled, and reloaded again.

An approved remove tears down the runtime path before returning the new Extension Manager view. Registered contributions disappear from the contribution registry, sandboxed module access is denied, and Pi runtime package selection no longer includes the removed package.

## State And Actions

Extensions must not import writable OpenWaggle stores, renderer feature internals, Pi SDK internals, or Electron app internals. They use the public SDK and brokered capabilities.

The state model is:

- OpenWaggle state is read-only through typed capabilities such as `openWaggle.state.get(scope)`.
- OpenWaggle mutations use typed action capabilities such as `openWaggle.actions.selectProject(scope, projectPath)`.
- Settings access uses typed settings capabilities such as `openWaggle.settings.get(scope)` and `openWaggle.settings.update(scope, settings)`.
- Extension package state is extension-owned and can be shared by every contribution from the same package.
- `storage.packageState.global` and `storage.packageState.project` are for persistent package state.
- `storage.packageConfig.global` and `storage.packageConfig.project` are for persistent package configuration.
- Contribution instance state stays local to one mounted contribution and should not be required to reconstruct historical transcript rendering.
- Pi session data remains the durable source of truth for historical agent-loop records.

Use package state when settings, side panels, transcript renderers, tool renderers, interaction renderers, and status widgets from the same extension need to coordinate. Use instance state for temporary UI state such as focused tabs, expanded rows, or an in-progress form in one mounted surface.

## Safe Startup And Failure Isolation

Extension failures must not prevent OpenWaggle from starting.

Expected failure behavior:

- Invalid manifests, missing files, incompatible SDK ranges, missing runtime requirements, failed builds, and stale trust pins become diagnostics and keep the affected package or contribution out of the contribution registry.
- A failed contribution registration does not remove unrelated contributions from other extensions.
- A failed mount is isolated to that contribution container where practical.
- Standard Pi interaction primitives keep OpenWaggle-owned fallback UI so tools do not hang when a custom renderer is unavailable.
- A `custom` Pi interaction without a matching desktop renderer shows an explicit unsupported-interaction fallback with a reject action instead of silently waiting forever.
- Disable, untrust, project-disable, approve update, approve build, and reload controls remain OpenWaggle-owned recovery paths.
- Extensions should mount a lightweight shell quickly, then perform slower work such as storage reads or network requests after initial render.

## What Can Make Loading Feel Slow

The fastest path is a prebuilt local module that renders immediately from cached state. That should usually feel near-instant.

Loading can take longer when:

- the extension has not been trusted, enabled, or reloaded yet
- a local build is required
- the extension changed and needs update approval
- many extension roots or project scopes must be discovered
- the module is large or imports a large UI framework
- the extension performs async work inside `mount(context)`
- the extension fetches network data
- dev mode is running Vite/Electron rebuilds or stale main-process CSP state

The extension author controls the experience after `mount(context)` starts. If the extension has slow work, it should render a useful initial state first, then update when the async work finishes.

## Pi Runtime Parity

Runtime behavior stays Pi-native.

Use Pi extension APIs for tools, runtime resources, session hooks, and user interaction. OpenWaggle provides desktop renderers for those Pi events instead of creating a separate OpenWaggle tool runtime.

Common Pi APIs used by extensions include:

- `pi.registerTool()` for LLM-callable tools
- `renderCall` and `renderResult` for Pi TUI tool rendering
- `pi.registerMessageRenderer()` for Pi TUI custom messages
- `ctx.ui.confirm()`, `ctx.ui.select()`, `ctx.ui.input()`, `ctx.ui.editor()`, `ctx.ui.notify()`, and `ctx.ui.custom()` for user interaction

OpenWaggle desktop renderers bind to Pi-native identifiers such as tool names, custom message types, standard interaction kinds, and custom interaction types. This keeps Pi TUI and OpenWaggle desktop rendering aligned to the same runtime event.

## Agent-Loop Contributions

Agent-loop contributions render or collect feedback during an active Pi agent loop.

They can be display-only, such as a tool progress card, or interactive, such as an approval dialog. Interactive contributions return typed responses to the pending Pi interaction through OpenWaggle's brokered extension path.

A contribution should bind to a Pi-native identity:

```json
{
  "contributions": {
    "toolRenderers": [
      {
        "id": "github.issue-tool-card",
        "title": "GitHub Issues Tool Card",
        "runtime": "federated-module",
        "execution": "host-renderer",
        "entry": "dist/github-issue-tool-card.js",
        "matches": {
          "toolNames": ["openwaggle.github.listIssues"]
        },
        "capability": "openwaggle.storage",
        "methods": ["get", "list"]
      }
    ]
  }
}
```

A single Pi tool or custom message can have multiple OpenWaggle renderers across different surfaces. The transcript is the durable audit trail; dialogs, side panels, status widgets, and composer actions are auxiliary live surfaces.

```mermaid
flowchart LR
  A["Pi agent loop"] --> B["Pi tool call, custom message, or interaction request"]
  B --> C["OpenWaggle projects a public event DTO"]
  C --> D{"Matching extension renderer?"}
  D -- "Yes" --> E["OpenWaggle mounts federated module with context"]
  D -- "No" --> F["OpenWaggle fallback renderer"]
  E --> G["User sees progress, result, or prompt"]
  F --> G
  G --> H{"Does Pi need feedback?"}
  H -- "No" --> I["Transcript keeps durable record"]
  H -- "Yes" --> J["Renderer calls sdk.surface.respondInteraction(response)"]
  J --> K["OpenWaggle broker validates and returns response to Pi"]
  K --> A
```

The feedback path is intentionally one-way through OpenWaggle-owned surface actions. Extension UI collects the user's response through `context.sdk.surface.respondInteraction(response)`, then OpenWaggle validates that response against the pending interaction before returning it to Pi. Renderer modules do not mutate Pi sessions or OpenWaggle internal stores directly.

## Interaction Primitives

OpenWaggle supports Pi interaction primitives as public typed request/response schemas.

Standard primitives have OpenWaggle-owned fallback UI:

- `confirm`: prominent confirmation UI plus transcript record
- `select`: choice UI plus transcript record
- `input`: short text input UI plus transcript record
- `editor`: multiline editor UI plus transcript record
- `notify`: notification/status UI, with transcript record when relevant

`custom` is the escape hatch for interactions that do not fit the standard primitives. OpenWaggle does not execute Pi TUI components inside Electron. A custom interaction needs a matching desktop renderer, or OpenWaggle shows an unsupported-interaction fallback with a reject action instead of silently hanging the tool.

Interaction renderer matching uses:

- standard primitives: `matches.interactionKinds` values such as `confirm`, `select`, `input`, `editor`, and `notify`
- custom interactions: `matches.interactionKinds` set to the interaction `customType`

Renderer modules return responses by calling `sdk.surface.respondInteraction(response)`. For standard primitives, `response` must match the public interaction response schema, for example `{ "kind": "confirm", "accepted": true }`. For custom interactions, the response value is passed back as the custom interaction result.

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

## What Requires An OpenWaggle App Update

Extension authors can ship independently when they stay inside the existing public contract:

- Add or change manifest-declared contributions in existing families.
- Add or update federated-module renderer entries that still export `mount(context)`.
- Add assets, CSS, package-local docs, and built artifacts declared in the manifest.
- Add or change Pi-native tools, custom messages, resource roots, and runtime behavior supported by Pi and declared in the extension package.
- Add or change usage of existing brokered SDK capabilities, methods, and scopes already supported by the installed OpenWaggle SDK.
- Add or change package-owned storage keys and package-owned configuration.
- Add or change extension-owned UI code that uses existing optional SDK/theme/UI helper modules and still mounts through the same `mount(context)` contract.
- Add or remove declared network origins, local build commands, or runtime requirements, subject to user approval.

An OpenWaggle app update is required when the extension needs a new host contract:

- A new contribution family or a new host-owned surface/container.
- A new visual runtime besides `federated-module`.
- A new execution placement besides the supported placements.
- A new SDK capability, method, scope, DTO shape, action, or settings schema.
- A new shared SDK/theme/UI helper export that must be supplied by OpenWaggle instead of being bundled with the extension.
- A new fallback renderer for an OpenWaggle-owned standard interaction primitive.
- A new Pi interaction primitive that OpenWaggle must understand as a first-class desktop interaction.
- A change to extension trust semantics, package discovery roots, content-hash calculation, network approval, CSP/protocol behavior, or build approval rules.
- A packaged-app distribution change, such as shipping a first-party extension as production content or changing how installed OpenWaggle and Pi docs are generated.

If the installed app reports `sdk.openwaggle` as incompatible, the extension cannot fix that by changing runtime code alone. Either the extension must target the installed SDK range or the user must update OpenWaggle.

## Development Fixture

The development-only GitHub Issues Overview fixture is the proving extension for the vertical slice.

It should demonstrate:

- settings and side-panel contributions sharing package state
- a Pi-native tool such as `openwaggle.github.listIssues`
- standard Pi interactions such as `confirm`
- a custom desktop interaction or transcript tool renderer
- fallback behavior when the custom renderer is disabled or unavailable

Development fixtures live under `fixtures/extensions/`. They are for tests, demos, and local QA only, and must not be shipped as product content.

Use `pnpm extension:qa:install` to copy fixture packages into the current checkout's project-local `.openwaggle/extensions/` directory for QA. That command is a development helper, not a production packaging step.

## Extension Host QA Proof

The repeatable automated Electron proof is:

```bash
pnpm test:e2e:headless:quick e2e/extension-host.e2e.test.ts
```

Use the full build-backed variant when the built app may be stale:

```bash
pnpm test:e2e:headless e2e/extension-host.e2e.test.ts
```

The E2E test creates an isolated user-data directory and temporary project, installs the `openwaggle-github-issues-overview` fixture into that project's `.openwaggle/extensions/`, seeds a project-scoped session so Settings discovers the project scope, then drives Settings > Extensions through trust, enable, reload, iframe render, SDK-backed configuration save, disable, and package removal from discovery.

Manual real-Electron QA uses the same path:

1. Run `pnpm extension:qa:install openwaggle-github-issues-overview`.
2. Start Electron with CDP using `pnpm dev:debug`.
3. Verify CDP with `curl -s http://127.0.0.1:9222/json/version`.
4. Open Settings > Extensions and click Refresh.
5. Trust `GitHub Issues Overview`, enable it, then click Reload.
6. Confirm `GitHub Issues Settings` appears under Extension settings and the frame titled `Extension module: GitHub Issues Settings` renders the fixture form.
7. Save the configuration from inside the frame to prove the brokered storage SDK path.
8. Disable the extension and confirm the settings contribution disappears.
9. Remove the extension with the Settings > Extensions Remove action and confirm the package card, contribution registry entry, and sandbox frame disappear. Extension-owned storage is retained unless a separate data deletion flow is explicitly offered.
10. Check console errors through the Electron QA DevTools path before signing off.

## Agent-Discoverable Installed Docs

This page is the repository source of truth for OpenWaggle extension authoring. Packaged builds should derive Pi-style package-local docs from the full user-facing documentation set so self-modifying agents can inspect installed OpenWaggle product, extension, and runtime contracts without relying on a source checkout.

Do not maintain separate hand-written copies for agents. The repository mechanism is `pnpm docs:generate`, which generates `build/openwaggle-docs` from `website/src/content/docs/**` plus installed Pi package docs. If installed package-local docs diverge, fix the build copy step or the source documentation.

Generated installed docs must be easy to navigate:

- A root `README.md` explains what the docs bundle contains and where it was generated from.
- A topic index maps common questions to stable paths, such as extensions, tools, interactions, sessions, settings, providers, MCP, Pi runtime, and QA fixtures.
- OpenWaggle docs and Pi docs are grouped predictably, so agents do not need to inspect the package layout by trial and error.
- Important extension authoring entries should have obvious aliases or index links for manifest schema, SDK surface, agent-loop contributions, interaction schemas, and federated module mounting.

Agents should resolve installed docs through a typed docs discovery capability instead of hardcoding source or packaged paths. The same topic map is available to extension code through `context.sdk.openWaggle.docs.discover(scope, input)` and `context.sdk.openWaggle.docs.resolveTopic(scope, input)`, provided the manifest declares `openwaggle.docs` with the requested method and scope. OpenWaggle's self-modifying agent context should use the same broker-backed topic map. The generated index is the manual fallback for tools that only have filesystem access.

Docs discovery should return lightweight metadata rather than file content by default:

```typescript
{
  topic: 'openwaggle:extending/openwaggle-extensions',
  source: 'openwaggle',
  group: 'OpenWaggle Docs',
  title: 'Agent-loop contributions',
  path: '/path/to/openwaggle/docs/extending/openwaggle-extensions.md',
  bundlePath: 'topics/openwaggle/extending/openwaggle-extensions.md',
  sourcePath: 'website/src/content/docs/extending/openwaggle-extensions.md',
  aliases: ['tool renderers', 'transcript cards'],
  keywords: ['ctx.ui.confirm', 'Pi tools', 'custom interaction'],
  contentHash: 'sha256...'
}
```

First-party topics should be closed and typed so generated indexes and SDK calls can be validated. Extension packages can also ship Pi-style package-local docs in `docs/`. Those docs are exposed through a structured extension namespace with provenance metadata and cannot override first-party OpenWaggle or Pi topics. Extension docs are discoverable regardless of trust or enablement; trust and lifecycle state are metadata, not visibility gates.

```typescript
{
  topic: 'extension:openwaggle-github-issues-overview/configuration',
  localTopic: 'configuration',
  provenance: {
    extensionId: 'openwaggle-github-issues-overview',
    trust: 'trusted',
    lifecycle: 'enabled'
  }
}
```

## Local Pi Reference

Agents and developers can inspect the installed Pi docs in a checkout for exact Pi runtime semantics:

- `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`
- `node_modules/@earendil-works/pi-coding-agent/docs/tui.md`

OpenWaggle docs define how those Pi concepts are exposed in the desktop product.
