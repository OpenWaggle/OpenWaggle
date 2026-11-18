---
title: "@openwaggle/extension-sdk"
description: "Types, validation helpers, themes, host syntax highlighting, and mount-context helpers for OpenWaggle extensions."
order: 2
section: "Packages"
kind: "guide"
---

`@openwaggle/extension-sdk` is the package you write OpenWaggle extension surfaces with.

Use it in extension modules that mount into containers OpenWaggle owns. It gives you the `mount(context)` types, the manifest and broker types, theme and syntax helpers, UI class names, and stylesheet helpers, without importing OpenWaggle renderer internals. The entries your extension loads at run time hold types and small plain functions only, so they add little to its bundle. Validation and test doubles live on two tooling entries.

<package-install packages="@openwaggle/extension-sdk"></package-install>

The package supports Node.js 22.19 and newer. Every export is browser-safe. You need Node.js for extension build tooling.

## Main imports

```ts
import type {
  OpenWaggleExtensionManifest,
  OpenWaggleExtensionMountContext,
  OpenWaggleFederatedModule,
} from '@openwaggle/extension-sdk'
import {
  createOpenWaggleExtensionUiStylesheet,
  defineExtensionManifest,
  OPENWAGGLE_EXTENSION_UI_CLASS_NAMES as ui,
} from '@openwaggle/extension-sdk'
```

The package has these subpaths:

| Subpath | Use it for |
|---------|------------|
| `@openwaggle/extension-sdk` | The main types and helpers, including `defineExtensionManifest`. |
| `@openwaggle/extension-sdk/context` | Mount context and shared-module helpers. |
| `@openwaggle/extension-sdk/types` | Contribution, broker call, storage, and validation result types. The manifest and broker SDK types are on the main entry. |
| `@openwaggle/extension-sdk/runtime` | Types for contributions you register while the extension runs. |
| `@openwaggle/extension-sdk/docs` | Docs discovery types. |
| `@openwaggle/extension-sdk/agent-loop` | Agent-loop and interaction types. |
| `@openwaggle/extension-sdk/json` | The `JsonValue` and `JsonPrimitive` types. |
| `@openwaggle/extension-sdk/theme` | Theme tokens and CSS-variable helpers. |
| `@openwaggle/extension-sdk/syntax` | Host syntax highlighting types and the plain-text fallback. |
| `@openwaggle/extension-sdk/ui` | UI class names and stylesheet helpers. |
| `@openwaggle/extension-sdk/constants` | Manifest and broker constants. |
| `@openwaggle/extension-sdk/validation` | Tooling. `validate*` helpers for manifests, capabilities, and themes. |
| `@openwaggle/extension-sdk/testing` | Tooling. Broker SDK factories for tests and previews. |

`/validation` and `/testing` bundle the SDK's validator, about 58 KB gzipped. Import them from build scripts and tests, not from code that runs inside OpenWaggle.

## Federated module example

A visual contribution exports `mount(context)`. OpenWaggle owns the container and passes the mount context, and the extension owns the content it appends to `context.root`.

```ts
import type { OpenWaggleFederatedModule } from '@openwaggle/extension-sdk'
import {
  createOpenWaggleExtensionUiStylesheet,
  OPENWAGGLE_EXTENSION_UI_CLASS_NAMES as ui,
  openWaggleExtensionClassName,
} from '@openwaggle/extension-sdk'

const module: OpenWaggleFederatedModule = {
  async mount(context) {
    const style = document.createElement('style')
    style.textContent = createOpenWaggleExtensionUiStylesheet({
      theme: context.theme,
    })

    const panel = document.createElement('section')
    panel.className = openWaggleExtensionClassName(ui.root, ui.panel, ui.stack)

    const heading = document.createElement('h2')
    heading.className = ui.heading
    heading.textContent = context.contribution.title

    const body = document.createElement('p')
    body.className = ui.text
    body.textContent = `Mounted ${context.extension.name}`

    panel.append(heading, body)
    context.root.append(style, panel)

    return () => {
      style.remove()
      panel.remove()
    }
  },
}

export const mount = module.mount
```

## Brokered capability calls

Call OpenWaggle through `context.sdk`, the broker SDK OpenWaggle passes in the mount context. Do not import stores, IPC helpers, Electron APIs, or Pi SDK internals, and do not build a broker SDK yourself.

```ts
import type { OpenWaggleExtensionMountContext } from '@openwaggle/extension-sdk'

export async function saveSettings(context: OpenWaggleExtensionMountContext) {
  const projectPath = context.projectPaths[0]
  if (!projectPath) return

  await context.sdk.storage.packageConfig.project.set(
    { kind: 'project', projectPath },
    'github-token-source',
    'keychain',
  )
}
```

Declare matching capabilities and methods in `openwaggle.extension.json`. A call to a capability the manifest does not declare fails.

## Host syntax highlighting

Every mounted surface receives `context.sdk.surface.syntax`. Use it for source the extension shows, so the host applies the user's syntax theme, language aliases, worker scheduling, size limits, caching, and a safe plain-text fallback.

```ts
const result = await context.sdk.surface.syntax.highlight({
  source: 'export const ready = true',
  language: 'typescript',
  priority: 'visible',
})
```

You can pass `path` instead of `language` when the file name is the better signal. The result holds token lines, not HTML, so the extension keeps control of rendering and never takes host markup. Do not start a second Shiki highlighter inside the extension frame. It would bypass the host's theme, worker, and performance limits.

## Manifest typing

`defineExtensionManifest` checks a manifest against the manifest type and returns it unchanged, typed exactly as you wrote it. It checks at compile time only.

```ts
import { defineExtensionManifest } from '@openwaggle/extension-sdk'

export default defineExtensionManifest({
  manifestVersion: 1,
  id: 'example-extension',
  name: 'Example Extension',
  version: '0.1.0',
  sdk: { openwaggle: '>=0.1.0 <0.2.0' },
  sourceFiles: ['package.json', 'src/settings.ts', 'src/results.ts'],
  builtArtifacts: ['dist/settings.js', 'dist/results.js'],
  install: { source: 'prebuilt' },
  capabilities: [
    {
      id: 'openwaggle.storage',
      methods: ['get', 'set'],
      scopes: ['project'],
    },
    {
      id: 'openwaggle.resources',
      methods: ['list-resources', 'publish-resource'],
      scopes: ['session'],
    },
  ],
  contributions: {
    commands: [
      {
        id: 'example.refresh',
        title: 'Refresh extension status',
        capability: 'openwaggle.storage',
        method: 'get',
      },
    ],
    settingsSections: [
      {
        id: 'example.settings',
        title: 'Example Settings',
        runtime: 'federated-module',
        execution: 'host-renderer',
        entry: 'dist/settings.js',
        capability: 'openwaggle.storage',
        methods: ['get', 'set'],
      },
    ],
    sidePanels: [
      {
        id: 'example.results',
        title: 'Example Results',
        runtime: 'federated-module',
        execution: 'host-renderer',
        entry: 'dist/results.js',
        icon: 'flask-conical',
        capability: 'openwaggle.resources',
        methods: ['list-resources', 'publish-resource'],
      },
    ],
    sessionSummarySections: [
      {
        id: 'example.session-summary',
        title: 'Example Session Status',
        placement: 'details',
        rows: [
          { id: 'status', label: 'Status', value: 'Ready' },
          {
            id: 'open-results',
            label: 'Open results',
            action: { family: 'sidePanels', contributionId: 'example.results' },
          },
        ],
      },
    ],
  },
})
```

For a manifest you write as JSON, add `"$schema": "https://openwaggle.ai/schemas/openwaggle-extension-manifest-v1.schema.json"`. Your editor then completes field names and flags wrong types as you type. OpenWaggle ignores the key.

A side panel's optional `icon` is its Panel rail icon. Use a bundled [Lucide](https://lucide.dev/icons/) icon name in kebab-case, such as `'ticket'`, or `{ svg: 'assets/panel-icon.svg' }` for a single-colour SVG file inside the package. The path must be relative to the package root (no leading `/` or `\` and no drive letter), must not contain empty, `.` or `..` segments, must not have leading or trailing whitespace or NUL bytes, must be at most 260 characters, and must end in `.svg`. OpenWaggle uses only the icon's shape and paints it in the rail's colours. A missing or unusable icon falls back to a letter tile and an extension diagnostic. Only side panels accept `icon`, and the `ExtensionSidePanelIcon` type describes the values it takes. A side panel you register at run time follows the same rules, and its SVG file must be one a manifest side panel declares.

The npm package version and the manifest's `sdk.openwaggle` range are separate contracts. The range above targets OpenWaggle's current `0.1` host SDK, which extension discovery accepts.

## Validate a manifest

`validateExtensionManifest` runs the checks OpenWaggle runs on a manifest's contents when it loads a package. Call it from a build script or a test.

```ts
import { validateExtensionManifest } from '@openwaggle/extension-sdk/validation'

const result = validateExtensionManifest(manifest)
if (!result.success) {
  for (const issue of result.issues) console.error(`${issue.path}: ${issue.message}`)
  process.exitCode = 1
}
```

Every `validate*` helper takes an `unknown` value, never throws, and returns an `ExtensionValidationResult`:

- `{ success: true, value }`, with the value typed, when it is valid.
- `{ success: false, issues }` when it is not, with every problem found.

Each issue has a `path` and a `message`. The path is the field's dotted path, with list items by index, such as `contributions.sidePanels.0.icon`, and `(root)` for a problem with the value as a whole. OpenWaggle's extension diagnostics use the same paths. The path is empty when reading the value threw, for example from a getter or a `Proxy`.

The `/validation` entry has three helpers:

| Helper | What it checks |
|--------|----------------|
| `validateExtensionManifest` | An `openwaggle.extension.json` manifest. |
| `validateBrokerCapabilityDeclaration` | One entry of `capabilities`, and that a built-in capability lists only methods the broker supports. |
| `validateOpenWaggleExtensionTheme` | A theme object, including the exact token groups and keys. Its `value` leaves out top-level fields the theme contract doesn't declare. |

## Test with a broker SDK double

OpenWaggle builds `context.sdk` for you. To test code that takes a broker SDK, build one over a transport you control with `createExtensionBrokerSdk` from `/testing`.

```ts
import type { ExtensionBrokerTransport } from '@openwaggle/extension-sdk/testing'
import { createExtensionBrokerSdk } from '@openwaggle/extension-sdk/testing'

const calls: string[] = []
const transport: ExtensionBrokerTransport = async (input) => {
  calls.push(`${input.capability}.${input.method}`)
  return { ok: false, error: { code: 'transport-failed', message: 'Offline in tests.' } }
}

const sdk = createExtensionBrokerSdk(transport, {
  extensionId: 'example-extension',
  contributionId: 'example.settings',
})
```

The transport receives each call with the identity you passed, and its result goes back to the caller. A success result needs an `audit` entry, as the broker's does. The double checks a success value the way `context.sdk` does, so a fake value of the wrong shape comes back as an `invalid-payload` failure. `createExtensionBrokerSdkFromInvoke` takes an invoke function instead of a transport, and `createNoopExtensionSurfaceSdk` from the main entry gives you a surface SDK for tests.

## Session resources

Extensions can publish session Sources and Outputs through the broker SDK. The calling contribution and the package manifest must declare `openwaggle.resources`, `list-resources` or `publish-resource` or both, and `session` scope.

```ts
import type { OpenWaggleExtensionMountContext } from '@openwaggle/extension-sdk'

export async function publishPreview(context: OpenWaggleExtensionMountContext) {
  const projectPath = context.projectPaths[0]
  if (!context.sessionId || !projectPath) return
  const scope = { kind: 'session' as const, projectPath, sessionId: context.sessionId }

  const published = await context.sdk.openWaggle.resources.publish(scope, {
    key: 'preview-site',
    title: 'Preview site',
    kind: 'link',
    role: 'output',
    locator: 'https://preview.example.com',
  })
  if (!published.ok) return published

  return context.sdk.openWaggle.resources.list(scope)
}
```

`publish` accepts only credential-free HTTPS `image` or `link` locators with a `source` or `output` role. Reuse a stable `key`. Publishing the same key, kind, role, and normalized locator again from one contribution changes nothing. Build the scope from the mounted `context.sessionId` and project path, not from input the extension controls. The broker checks both values, so a caller cannot reach another open or archived session by changing the scope.

`list` returns an operation result. On success, `value.resources` holds display-safe metadata: the host resource id, title, kind, MIME type, availability, and Source and Output flags. Original locators, managed paths, occurrence history, and canonical keys stay private to the host. A Session Summary row may use a returned resource id to open the same resource browser or image gallery as first-party resources.

## Theme contract

`context.theme` carries the host's Appearance across the SDK boundary. Every role in the contract resolves to a real host CSS variable when the extension runs inside OpenWaggle, so extension UI matches the host without a second token system.

The contract covers:

- **Colour.** 23 semantic roles under `color`, including `dangerText` and `infoText` for small text plus `review`, `plan`, `progress`, and `neutral`.
- **Typography.** `sansFamily`, `monoFamily`, and `typeScale` entries `xs`, `sm`, `base`, `lg`, `xl`, and `twoXl`. Each type-scale entry has `fontSize` and `lineHeight`.
- **Spacing.** The Tailwind spacing unit at `spacing.unit`. Use it through `calc(var(--ow-spacing) * N)`.
- **Radius.** `xs`, `sm`, `md`, `lg`, `xl`, `twoXl`, `threeXl`, and `fourXl`.
- **Shadow.** `twoXs`, `xs`, `sm`, `md`, `lg`, `xl`, and `twoXl`.
- **Focus.** `ring` and `shadow`, with `transparent` and `none` fallbacks.

The type, spacing, radius, and shadow fallbacks match Tailwind 4.3.3. The contract has no `controlSize` or `elevation` group. Express control sizes as spacing multiples and use the standard shadow scale.

Hosted extensions receive the resolved Appearance in their mount context. Read that object rather than resolving the host's private `--color-*` variables from inside the isolated frame:

```ts
export function mount(context: OpenWaggleExtensionMountContext) {
  const { theme } = context
  // Use theme.color, theme.typography, theme.spacing, theme.radius, and theme.shadow.
}
```

Outside OpenWaggle, `createOpenWaggleExtensionTheme()` gives you the published fallback tokens for tooling and standalone previews.

## Boundary rules

Extension modules that use `@openwaggle/extension-sdk` must stay inside its public surface:

- Do not import OpenWaggle renderer feature files, Zustand stores, Electron IPC helpers, main-process services, or Pi SDK internals.
- Do not deep-import from `@openwaggle/extension-sdk/src`, `dist`, or `dist-cjs`. The schemas behind the types are private.
- Use `context.theme` and the SDK UI helpers instead of importing OpenWaggle app CSS or Tailwind internals.
- Use `context.sdk.surface.syntax` instead of bundling a separate syntax highlighter or shipping pre-highlighted HTML.
- Keep `/validation` and `/testing` out of the modules OpenWaggle loads.

For the full extension package lifecycle and manifest model, see [OpenWaggle Extensions](/docs/extending/openwaggle-extensions).

## Reference and support

- [Complete API reference](./api-reference)
- [Manifest JSON Schema](https://openwaggle.ai/schemas/openwaggle-extension-manifest-v1.schema.json)
- [npm package](https://www.npmjs.com/package/@openwaggle/extension-sdk)
- [Package changelog](https://github.com/OpenWaggle/OpenWaggle/blob/main/packages/extension-sdk/CHANGELOG.md)
- [Report an issue](https://github.com/OpenWaggle/OpenWaggle/issues/new)

## Troubleshooting

**A capability call fails with an undeclared error.** Check that `openwaggle.extension.json` declares the capability, method, and scope. The broker rejects any privilege the manifest does not declare.

**An import from `src` or `dist` fails.** Import only the subpaths listed under main imports. Build folders and source paths are private.

**Styles do not match the host.** Use `context.theme`, `createOpenWaggleExtensionUiStylesheet`, and the exported UI class names instead of copying OpenWaggle renderer CSS.

**The extension bundle includes Effect.** A module OpenWaggle loads imports `/validation` or `/testing`. Move that import to a build script or a test.

## Migrating from 0.2

Version 0.3 publishes types and result helpers instead of schemas. Code that only reads `context` and the types keeps working. Code that used the schemas, the validators, or the broker factory needs these changes:

- **Schemas.** The 132 `*Schema` exports are gone, from `jsonValueSchema` to `openWaggleExtensionManifestSchema`. Use the matching type, which usually has the schema's name without `Schema`, such as `ExtensionSidePanelIcon` for `extensionSidePanelIconSchema`. To check a value at run time, use a `validate*` helper. To check a manifest in an editor, use the JSON Schema.
- **Schemas whose type has another name.**
  - `extensionRuntimeRequirementSchema`: `ExtensionRuntimeRequirementDeclaration`
  - `docsDiscoveryViewSchema`: `ExtensionDocsDiscoveryView`
  - `extensionDocsPackageScopeViewSchema`: `ExtensionPackageScopeView`
  - `extensionInvokeSessionScopeSchema`: `ExtensionSessionInvokeScope`
  - `extensionRouteContributionSchema` and `extensionSlotContributionSchema`: `ExtensionSurfaceContribution`
  - `extensionStateSelectedReadResultSchema`: `ExtensionSelectedStateReadResult`
  - `extensionInvokeDeclaredSuccessSchema` and `extensionInvokeDeclaredResultSchema`: `ExtensionInvokeSuccess<ExtensionInvokeSuccessValue>` and `ExtensionInvokeResult<ExtensionInvokeSuccessValue>`
  - `extensionBuildSchema`, `extensionInstallSchema`, `extensionNetworkSchema`, and `extensionDocsSchema`: the matching field of `OpenWaggleExtensionManifest`, such as `NonNullable<OpenWaggleExtensionManifest['build']>`
  - `extensionIdSchema`, `extensionContributionIdSchema`, `extensionRelativePathSchema`, `extensionSemverVersionSchema`, and `nonEmptyStringSchema`: `string`
- **Schemas with no public type.** The broker payload schemas, such as `extensionStorageGetPayloadSchema` and the `extensionSettings*PayloadSchema` family, have no type, because `context.sdk` builds those payloads. Neither do the single scope kinds, such as `extensionInvokeAppScopeSchema`, which are `Extract<ExtensionInvokeScope, { kind: 'app' }>`, the per-family registration schemas, which are members of `ExtensionContributionRegistration`, and a few docs internals.
- **`validateExtensionManifest`.** It moves to `@openwaggle/extension-sdk/validation`. It returns `{ success: true, value }` or `{ success: false, issues }` instead of `{ manifest, issues }`, and each issue is `{ path, message }` instead of a string. Read `result.value` where you read `result.manifest`, and check `result.success` instead of `issues.length`. The `ExtensionManifestValidationResult` type is now `ExtensionValidationResult<OpenWaggleExtensionManifest>`.
- **`validateBrokerCapabilityDeclaration`.** It is new on `/validation`. It takes an `unknown` capability entry and returns a validation result.
- **`isOpenWaggleExtensionTheme`.** It is now `validateOpenWaggleExtensionTheme` on `/validation`. Replace `if (isOpenWaggleExtensionTheme(value))` with `const result = validateOpenWaggleExtensionTheme(value)` and `if (result.success)`, and read the theme from `result.value`. Unlike the guard, `result.value` leaves out top-level fields the theme contract doesn't declare.
- **Broker factories.** `createExtensionBrokerSdk`, `createExtensionBrokerSdkFromInvoke`, `createRuntimeContributionSdk`, and `toInvokeInput` move from the main entry, `/broker`, and `/runtime` to `/testing`. Extension code uses `context.sdk` instead.
- **Subpaths.** `/broker` and `/manifest` are gone. Import their types and `defineExtensionManifest` from the main entry, and the validators from `/validation`.
- **Invalid payload errors.** A broker result that fails to decode returns an `invalid-payload` error whose `issues` list every problem, each as `path: message`. In 0.2 it listed the first one only.
- **New types.** `ExtensionHostContextResult`, `ExtensionSurfaceContribution`, `ExtensionSessionSummaryRow`, `ExtensionSessionSummaryDisclosure`, `ExtensionSessionSummaryState`, `ExtensionValidationResult`, and `ExtensionValidationIssue` are new public types.

The runtime entries no longer include Effect. The main entry drops from 223 KB to 23 KB minified, and `/json`, `/docs`, `/agent-loop`, and `/runtime` now hold types only.
