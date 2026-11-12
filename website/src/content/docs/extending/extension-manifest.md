---
title: "Extension manifest reference"
description: "Every field, limit, capability, and rule of an OpenWaggle extension's openwaggle.extension.json manifest and SDK."
order: 9
section: "Developer docs"
kind: "reference"
---

This page lists the fields of `openwaggle.extension.json`, what OpenWaggle checks before an extension runs, and the SDK capabilities an extension may call. To build your first extension, see [Build an extension](/docs/extending/openwaggle-extensions). The generated [`@openwaggle/extension-sdk` API reference](/docs/packages/extension-sdk) lists every exported type.

## Manifest fields

| Field | Type | Required | Default | What it does |
| --- | --- | --- | --- | --- |
| `manifestVersion` | `1` | Yes | | Manifest format version |
| `id` | string | Yes | | Package id, the same as the package folder's name. See [Limits](#limits) |
| `name` | string | Yes | | Display name |
| `version` | semver string | Yes | | Package version, raised with each update |
| `description` | string | No | | Short description |
| `sdk.openwaggle` | semver range | Yes | | OpenWaggle SDK versions the package works with, such as `">=0.1.0 <0.2.0"` |
| `sourceFiles` | paths | Yes | | Every source file in the package |
| `builtArtifacts` | paths | Yes | | Every built file OpenWaggle loads, local build outputs included |
| `install.source` | `prebuilt` or `local-build` | No | `prebuilt` | Whether the package ships built files or builds on the user's machine |
| `build.command` | string | With `local-build` | | Command that builds the package, run in the package folder |
| `build.outputs` | paths | No | `builtArtifacts` | Files the build writes |
| `docs.topics` | list | No | | Docs the package ships. See [Docs topics](#docs-topics) |
| `network.origins` | list of origins | No | | External origins the package may reach, each an exact HTTPS origin with no path, such as `https://api.github.com` |
| `capabilities` | list | No | | SDK capabilities, methods, and scopes. See [Capabilities](#capabilities) |
| `contributions` | object | No | | Contributions by family. See [Contribution families](#contribution-families) |
| `pi.resourceRoots` | paths | No | | Folders of Pi resources (skills, extensions, prompts, themes) the package adds, loaded ahead of `.pi` |
| `trusted.main` | path | No | | Trusted local code that runs in the main process |
| `trusted.renderer` | path | With `trusted-renderer` contributions | | Privileged renderer code, which every contribution with `runtime: "trusted-renderer"` needs |
| `runtimeRequirements` | list | No | | Programs the package needs. See [Runtime requirements](#runtime-requirements) |

Paths are relative to the package folder.

## Runtime requirements

Each entry in `runtimeRequirements` names one program the package needs. OpenWaggle checks for it and shows an error on the package card when it is missing. It never installs a missing program.

| Field | Required | What it does |
| --- | --- | --- |
| `id` | Yes | Requirement id inside the package |
| `label` | Yes | Name shown in the error, at most 120 characters |
| `binary` | One of `binary` or `command` | A program name, such as `git`, looked up on `PATH`. A name, not a path |
| `command` | One of `binary` or `command` | A file inside the package, relative to the package folder |
| `kind` | No | `binary` or `command`, matching the field you set |

## Limits

| Value | Limit |
| --- | --- |
| Package `id` | 96 lowercase letters, digits, `.`, `_`, and `-`, starting with a letter or digit |
| Contribution `id` | 128 characters. Lowercase letters, digits, `.`, `_`, `/`, and `-` |
| `name`, `title`, `label`, `badge`, `category` | 120 characters |
| `description`, row `value`, state `message` | 2,000 characters |
| A relative path | 260 characters |
| A network origin | 300 characters, `https` only, with no path, query, fragment or trailing slash |
| A runtime requirement `binary` | 120 characters |
| `build.command` | 500 characters |
| Build time | 10 minutes |
| Build log kept | The last 4,000 characters |
| Storage key | 160 characters |
| Side panel SVG icon | 32 KiB |

## Package folders

| Scope | Folder |
| --- | --- |
| Project | `<project>/.openwaggle/extensions/<extension-id>/` |
| Global | `extensions/<extension-id>/` in the [app data folder](/docs/reference/data-locations#what-is-in-the-app-data-folder) |

The package files can be committed with a project. Trust, enablement, permission grants, build approvals, project opt-outs, lifecycle records, and extension storage stay on the user's machine.

## Contribution families

| Family | Where it appears | Has an entry module |
| --- | --- | --- |
| `settingsSections` | **Settings > Extensions**, under **Extension settings** | Yes |
| `sidePanels` | The right sidebar, opened from the Panel rail or **All panels** | Yes |
| `dialogs` | A modal OpenWaggle draws | Yes |
| `routes` | A route container inside OpenWaggle | Yes |
| `transcriptRenderers` | The chat transcript, for Pi session records | Yes |
| `toolRenderers` | The card of a Pi tool call and its result | Yes |
| `customMessageRenderers` | Pi custom message records | Yes |
| `interactionRenderers` | A pending Pi question | Yes |
| `statusWidgets` | A small status display | Yes |
| `commands` | The slash command menu and launchers next to the composer | No |
| `slashCommands` | The slash command menu and launchers next to the composer | No |
| `sessionSummarySections` | The floating Session Summary. OpenWaggle draws the rows | No |

## Contribution fields

Contributions with an entry module take these fields:

| Field | Values | What it does |
| --- | --- | --- |
| `id` | string | Contribution id, unique within the package |
| `title` | string | Title OpenWaggle shows |
| `runtime` | `federated-module` or `trusted-renderer` | How the module loads. Both mount in the sandboxed extension frame and get the same SDK |
| `execution` | `host-renderer` or `frame` | Where it runs. A `trusted-renderer` contribution must use `host-renderer` |
| `entry` | path | The module that exports `mount(context)` |
| `target.projectPaths`, `target.sessionIds` | lists | Limits the contribution to these projects or sessions |
| `matches.toolNames` | list | Pi tool names a renderer draws |
| `matches.customMessageNames` | list | Pi custom message types a renderer draws |
| `matches.interactionKinds` | list | Standard question kinds, or a custom question's `customType` |
| `capability` | capability id | The capability the contribution calls |
| `method`, `methods` | method ids | The methods of that capability it calls |
| `icon` | Lucide name or `{ "svg": "<path>" }` | Side panels only. See [Side panel icons](#side-panel-icons) |

`commands` and `slashCommands` take `id`, `title`, an optional `category`, `target`, `capability`, and `method` or `methods`, with no `entry`.

A package that registers contributions at run time must declare the `openwaggle.runtime` capability with `register-contribution`, `unregister-contribution`, or both, and must list each family it registers in `contributions`, even as an empty array.

## Side panel icons

| Form | Example | Rules |
| --- | --- | --- |
| Lucide name | `"ticket"`, `"git-pull-request"` | A kebab-case [Lucide](https://lucide.dev/icons/) name, checked against the Lucide version OpenWaggle ships |
| SVG file | `{ "svg": "assets/panel-icon.svg" }` | A path relative to the package folder, ending in `.svg`, at most 260 characters |

An SVG path may not start with `/` or `\`, name a drive, have an empty, `.` or `..` segment, have leading or trailing whitespace, or hold a NUL byte.

OpenWaggle reads an SVG icon once for each installed version of the package content and keeps only its shapes, painted in the rail's colors:

- It rejects a file with `<script>` or `<foreignObject>` elements, characters XML does not allow, or no shapes left after cleaning.
- It drops `<style>` elements, `style` and `class` attributes, event handlers, external `href` references, embedded images, and attribute values that name any resource other than a `url(#id)` inside the file.
- The file counts toward the package's content hash.
- A side panel registered at run time may use a Lucide name, or an SVG file that a side panel in the manifest already declares. Any other SVG file fails, as does an `icon` that does not match the schema.
- A missing or unusable icon shows a letter tile with the first letter of the title, and a `panel-icon-invalid` warning under the contribution registry diagnostics in **Settings > Extensions**.

## Session Summary sections

| Field | Values | Default | What it does |
| --- | --- | --- | --- |
| `id` | string | | Section id |
| `title` | string | | Section title |
| `placement` | `context`, `coordination`, `details` | `details` | Where the section goes. See below |
| `target` | `projectPaths`, `sessionIds` | | Limits the section to these projects or sessions |
| `disclosure.defaultExpanded` | boolean | | Whether the section starts expanded |
| `disclosure.collapsible` | boolean | | Whether it can collapse |
| `disclosure.autoCollapseAfterMs` | 1,000 to 300,000 | | Collapses the section after this many milliseconds |
| `state.status` | `ready`, `loading`, `live`, `failure` | | The section's state. See below |
| `state.message` | string | | A message, required for `failure` and optional for `loading` and `live` |
| `rows` | list | | The rows, below |

`placement` decides where the section goes. `context` comes after Environment, Actions, Scheduled, workspace setup, and pull or merge request details, before Hive. `coordination` comes after Hive, before Outputs and Sources. `details` comes last, after Sources.

OpenWaggle hides an empty `ready` section. A `loading`, `live` or `failure` section stays visible without rows.

| Row field | Values | What it does |
| --- | --- | --- |
| `id` | string | Row id |
| `label` | string | Row label |
| `value` | string | Text value |
| `badge` | string | Badge text |
| `count` | whole number, 0 or more | A count |
| `resourceId` | resource id | Opens a resource published with `openWaggle.resources`. Cannot go with `action` |
| `action.family` | `commands`, `sidePanels`, `dialogs` | Family of the target contribution, in the same package |
| `action.contributionId` | contribution id | The target contribution. A command also needs a capability and method |

OpenWaggle rejects a section whose action target is missing, has the wrong family, is not eligible, or is out of scope, and reports a contribution diagnostic. See [Add to the Session Summary](/docs/extending/extension-session-summary) for how sections behave.

## Capabilities

A capability declaration has an `id`, the `methods` the package may call, and the `scopes` it may call them in: `app`, `project`, `session`, or `branch`. Calls outside the declaration fail.

| Capability | Methods | SDK calls |
| --- | --- | --- |
| `openwaggle.host.context` | `get-scope` | `hostContext.getScope(scope)` |
| `openwaggle.storage` | `get`, `set`, `delete`, `list` | `storage.packageState.global`, `storage.packageState.project`, `storage.packageConfig.global`, `storage.packageConfig.project`, each with `get`, `set`, `delete`, and `list` |
| `openwaggle.state` | `get-state`, `read-state` | `openWaggle.state.get`, `readCurrentProject`, `readCurrentSession`, `readCurrentBranch`, `readRecentProjects`, `readModelPreferences` |
| `openwaggle.actions` | `select-project` | `openWaggle.actions.selectProject(scope, projectPath)` |
| `openwaggle.settings` | `get-settings`, `update-settings`, `get-setting`, `update-setting` | `openWaggle.settings.get`, `update`, `getModelPreferences`, `updateModelPreferences`, `getProjectDisplayName`, `setProjectDisplayName` |
| `openwaggle.docs` | `discover-docs`, `resolve-docs-topic` | `openWaggle.docs.discover(scope, input)`, `openWaggle.docs.resolveTopic(scope, input)` |
| `openwaggle.runtime` | `register-contribution`, `unregister-contribution` | `runtime.registerContribution(scope, registration)`, `runtime.unregisterContribution(scope, unregistration)` |
| `openwaggle.resources` | `list-resources`, `publish-resource` | `openWaggle.resources.list(scope, { limit, cursor })`, `openWaggle.resources.publish(scope, resource)`, in `session` scope |

Notes on some calls:

- The state selectors are `current-project`, `current-session`, `current-branch`, `recent-projects`, and `model-preferences`. The settings keys are `model-preferences` and `project-display-name`.
- Model preferences report Pi's global default thinking level as `thinkingLevel`. An update cannot set it, because the thinking level belongs to each session and only the user changes it.
- Runtime registrations use the manifest's schemas. They cannot add capabilities, methods, or scopes, and cannot replace or remove a manifest contribution. Project and session registrations stay in the scope that made them. Registering the same family, id, and scope again replaces the earlier one. Branch scope fails.
- `resources.publish` accepts `image` and `link` resources with credential-free HTTPS locators, in the `source` or `output` role. Publishing the same key, kind, role, and locator again changes nothing. `resources.list` takes a `limit` from 1 to 100 and returns `value.resources` (display details only), `value.total` (the exact session total), and `value.nextCursor`. Both reach only the mounted contribution's project and session.

### Failure codes

A rejected call returns one of these codes:

| Code | Meaning |
| --- | --- |
| `invalid-input` | The call's input is malformed |
| `invalid-payload` | The payload does not match the schema |
| `unknown-extension` | No such extension |
| `disabled-extension` | The extension is not enabled |
| `unknown-contribution` | No such contribution |
| `undeclared-capability` | The manifest does not declare the capability |
| `undeclared-method` | The manifest does not declare the method |
| `undeclared-scope` | The manifest does not declare the scope |
| `out-of-scope` | The call names a project or session outside the contribution's scope |
| `unsupported-capability` | This OpenWaggle does not have the capability |
| `unsupported-method` | This OpenWaggle does not have the method |
| `transport-failed` | The call did not reach OpenWaggle |

## Mount context

| Field | What it holds |
| --- | --- |
| `context.root` | The element the contribution adds its content to |
| `context.extension` | The package's `id`, `name`, and `version` |
| `context.contribution` | The contribution's `id`, `title`, and `family` |
| `context.surface` | The surface's `family`, `execution`, and `payload`. The payload carries the surface's data, such as the transcript record, tool event, or pending question |
| `context.packagePath` | The package folder |
| `context.sessionId`, `context.projectPaths` | The session and projects the contribution is mounted for |
| `context.sdk` | The SDK calls above, plus `sdk.surface.sendAction`, `sdk.surface.respondInteraction`, and `sdk.surface.syntax.highlight` |
| `context.theme` | Theme tokens with CSS-variable-shaped values for color, typography, spacing, radius, focus, and shadow |
| `context.modules` | The shared author modules for the installed SDK version |

`mount(context)` may return a cleanup function, which OpenWaggle calls when it unmounts the contribution.

## Interaction kinds

| Kind | OpenWaggle's fallback |
| --- | --- |
| `confirm` | A confirmation, recorded in the transcript |
| `select` | A choice, recorded in the transcript |
| `input` | A short text field, recorded in the transcript |
| `editor` | A multiline editor, recorded in the transcript |
| `notify` | A notification or status, recorded in the transcript when relevant |
| `custom` | None. A renderer whose `matches.interactionKinds` names the `customType` draws it. Without one, OpenWaggle shows an unsupported-question fallback with a reject button |

A renderer answers with `sdk.surface.respondInteraction(response)`. A standard kind's answer must match its public schema, such as `{ "kind": "confirm", "accepted": true }`. A custom kind's answer is passed back as its result. OpenWaggle checks every answer against the pending question before returning it to Pi.

## Event data

Renderers receive OpenWaggle's public event data, never Pi package types or OpenWaggle internals. It keeps these Pi details:

- tool name
- custom message type
- tool call id
- interaction id
- input parameters
- partial and final result state
- structured details
- error state
- session and project

## Readiness checks

A contribution is in the contribution registry, and can appear, only when all of these hold:

- The manifest matches the schema.
- Every referenced file exists.
- The SDK range is compatible with the installed OpenWaggle.
- The content hash matches the trusted record.
- A required local build was approved and succeeded.
- The extension is trusted.
- The extension is enabled.
- The extension was reloaded after its last trust, enable, build, or update change.
- The current project has not opted out.

It is mounted once the iframe has loaded the module and `mount(context)` has resolved.

## Permissions

The trust review shows each of these:

| Permission | Declared by | What it allows |
| --- | --- | --- |
| Trusted visual modules | `federated-module` entries | Run in OpenWaggle's contribution containers after trust, enabling, and reload |
| Trusted renderer | `trusted.renderer` | Reviewed as privileged. `trusted-renderer` entries still mount in the sandboxed extension frame |
| Trusted local main code | `trusted.main` | Code that runs in the main process. Needs explicit trust |
| Network access | `network.origins` | External origins the package may reach. Origins not declared are not approved |
| Build script | `install.source: "local-build"` and `build.command` | Runs local code at build time. Approved separately from trust |
| Runtime requirements | `runtimeRequirements` | Programs the package needs. A missing one blocks trust or use until it is installed |
| SDK capabilities | `capabilities` | The capabilities, methods, and scopes above |
| Session resources | `openwaggle.resources` | Listing and publishing credential-free HTTPS links and images in `session` scope. Never exposes stored bytes or private locators |

Trust records the package's content hash. Editing the manifest, source files, built files, or build plan changes the hash, and the change becomes an update the user must approve.

How OpenWaggle enforces them in version 1:

- Frame-mounted visual contributions run in a sandboxed iframe, with a CSP that limits network `connect-src` to `network.origins`.
- Trusted main-process code gets only the public SDK. While the module activates and cleans up, and in the callbacks it registers, OpenWaggle guards direct `fetch`, `node:http`, `node:https`, `electron.net`, raw `node:net`, raw `node:tls`, UDP sockets, direct DNS lookups, `node:http2`, `WebSocket`, child processes, cluster forks, and worker threads, however the module imports them. It allows only the exact HTTPS origins in `network.origins`. The guard does not follow redirects, and a target it cannot resolve fails. It rejects custom fetch agents, dispatchers and proxies, custom Node HTTP agents, connection factories, and DNS lookup functions, Unix socket paths, raw sockets, and ways out of the process or isolate.
- The guard runs in the same process as the extension, so it is not a sandbox. Trust a package only if you trust its code. Code can still reach the network through native code (a native addon). It can also change a shared object so that OpenWaggle's own code makes a request later. The guard does not stop the module from listening for incoming connections.
- Trusted renderer code mounts in a frame. Importing it straight into the app's renderer is not supported, so it uses the SDK and mount context like any other contribution.

## Docs topics

Each entry in `docs.topics` has:

| Field | Required | What it does |
| --- | --- | --- |
| `id` | Yes | Topic id inside the package |
| `title` | Yes | Topic title |
| `path` | Yes | The Markdown file, relative to the package folder |
| `description` | No | Short description |
| `aliases` | No | Other names readers search for |
| `keywords` | No | Search keywords |

## Docs lookup

`openWaggle.docs.discover` and `openWaggle.docs.resolveTopic` return a topic's details, not its content. The `openwaggle_docs` tool's `list` and `search` actions return the same details, and its `read` action returns the topic's Markdown. A first-party topic looks like this:

```typescript
{
  topic: 'openwaggle:extending/openwaggle-extensions',
  source: 'openwaggle',
  group: 'OpenWaggle Docs',
  title: 'Build an extension',
  path: '/path/to/openwaggle/docs/extending/openwaggle-extensions.md',
  bundlePath: 'topics/openwaggle/extending/openwaggle-extensions.md',
  sourcePath: 'website/src/content/docs/extending/openwaggle-extensions.md',
  aliases: ['tool renderers', 'transcript cards'],
  keywords: ['ctx.ui.confirm', 'Pi tools', 'custom interaction'],
  contentHash: 'sha256...'
}
```

First-party topics are a fixed, typed set, so generated indexes and SDK calls can be checked. An extension topic sits in the extension's namespace, carries where it came from, and cannot replace an OpenWaggle or Pi topic:

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

The docs index lists extension topics whatever their trust or lifecycle state. The `openwaggle_docs` tool includes only the docs of extensions the session's runs load, and reads a file only while it is still inside the package and matches the hash recorded at discovery.

## What needs an OpenWaggle update

You can ship these without an OpenWaggle update:

- New or changed contributions in existing families.
- New or updated `federated-module` entries that still export `mount(context)`.
- Assets, CSS, package docs, and built files declared in the manifest.
- Pi tools, custom messages, resource folders, and runtime behavior that Pi supports and the package declares.
- More use of SDK capabilities, methods, and scopes the installed SDK already has.
- Package storage keys and package configuration.
- UI code that uses the existing optional SDK, theme, and UI helpers and still mounts through `mount(context)`.
- Added or removed network origins, local build commands, or runtime requirements, after the user approves them.

These need an OpenWaggle update:

- A new contribution family, or a new surface or container in the app.
- A visual runtime other than `federated-module`.
- An execution placement other than the supported ones.
- A new SDK capability, method, scope, data shape, action, or settings schema.
- A new shared SDK, theme, or UI helper that OpenWaggle must supply instead of the extension bundling it.
- A new fallback renderer for a standard question kind.
- A new Pi question type that OpenWaggle must understand in the desktop app.
- Changes to how trust works, which folders OpenWaggle searches for packages, how the content hash is calculated, network approval, CSP or protocol behavior, or build approval.
- A change to how the packaged app is distributed, such as shipping a first-party extension, or changing how the installed OpenWaggle and Pi docs are generated.

If the installed app reports `sdk.openwaggle` as incompatible, changing the extension's code cannot fix it. Target the installed SDK range, or update OpenWaggle.
