---
title: "@openwaggle/extension-sdk"
description: "Browser-safe OpenWaggle extension SDK types, broker helpers, theme helpers, and federated-module context helpers."
order: 2
section: "Packages"
---

`@openwaggle/extension-sdk` is the browser-safe author package for OpenWaggle extension surfaces.

Use it in extension modules that mount into OpenWaggle-owned containers. The package gives you the public `mount(context)` types, Effect Schema boundary values, manifest validation helpers, broker SDK helpers, theme helpers, UI class names, and stylesheet generation helpers without importing OpenWaggle renderer internals.

<package-install packages="@openwaggle/extension-sdk"></package-install>

The package supports Node.js 22.19 and newer. Its runtime exports are browser-safe; Node.js is required for extension build tooling and package consumers.

## Main Imports

```ts
import type {
  OpenWaggleExtensionManifest,
  OpenWaggleExtensionMountContext,
  OpenWaggleFederatedModule,
} from '@openwaggle/extension-sdk'
import {
  createExtensionBrokerSdk,
  createOpenWaggleExtensionUiStylesheet,
  OPENWAGGLE_EXTENSION_UI_CLASS_NAMES as ui,
} from '@openwaggle/extension-sdk'
```

Supported public subpaths include:

| Subpath | Use it for |
|---------|------------|
| `@openwaggle/extension-sdk` | Primary types and helpers. |
| `@openwaggle/extension-sdk/context` | Mount context and shared-module helpers. |
| `@openwaggle/extension-sdk/broker` | Broker SDK creation and invoke input helpers. |
| `@openwaggle/extension-sdk/manifest` | Manifest schemas, definition/validation helpers, and contribution declarations. |
| `@openwaggle/extension-sdk/runtime` | Runtime contribution schemas, types, and SDK creation. |
| `@openwaggle/extension-sdk/docs` | Documentation discovery schemas and DTOs. |
| `@openwaggle/extension-sdk/theme` | Theme token and CSS-variable helpers. |
| `@openwaggle/extension-sdk/ui` | Framework-neutral UI class names and stylesheet helpers. |
| `@openwaggle/extension-sdk/agent-loop` | Agent-loop DTO and interaction types. |

## Federated Module Example

A visual contribution exports `mount(context)`. OpenWaggle owns the container and passes the mount context; the extension owns the content appended to `context.root`.

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

## Brokered Capability Calls

Extension code should call OpenWaggle through the broker SDK on the mount context instead of importing stores, IPC helpers, Electron APIs, or Pi SDK internals.

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

Declare matching capabilities and methods in `openwaggle.extension.json`; undeclared capability calls fail closed.

## Manifest Typing

Use the manifest type to keep package metadata aligned with the public extension contract.

```ts
import type { OpenWaggleExtensionManifest } from '@openwaggle/extension-sdk'

export default {
  manifestVersion: 1,
  id: 'example-extension',
  name: 'Example Extension',
  version: '0.1.0',
  sdk: { openwaggle: '>=0.1.0 <0.2.0' },
  sourceFiles: ['package.json', 'src/settings.ts'],
  builtArtifacts: ['dist/settings.js'],
  install: { source: 'prebuilt' },
  capabilities: [
    {
      id: 'openwaggle.storage',
      methods: ['get', 'set'],
      scopes: ['project'],
    },
  ],
  contributions: {
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
  },
} satisfies OpenWaggleExtensionManifest
```

## Boundary Rules

`@openwaggle/extension-sdk` is browser-safe. Extension modules that use it must still stay inside the public SDK surface:

- Do not import OpenWaggle renderer feature files, Zustand stores, Electron IPC helpers, main-process services, or Pi SDK internals.
- Do not deep-import from `@openwaggle/extension-sdk/src`, `dist`, or `dist-cjs`.
- Use `context.theme` and SDK UI helpers instead of importing OpenWaggle app CSS or Tailwind internals.
- Bundle compatible helper code into your extension artifact or resolve the versioned package supplied by the installed SDK path.

For the full extension package lifecycle and manifest model, see [OpenWaggle Extensions](/docs/extending/openwaggle-extensions).

## Reference And Support

- [Complete API reference](./api-reference)
- [npm package](https://www.npmjs.com/package/@openwaggle/extension-sdk)
- [Package changelog](https://github.com/OpenWaggle/OpenWaggle/blob/main/packages/extension-sdk/CHANGELOG.md)
- [Report an issue](https://github.com/OpenWaggle/OpenWaggle/issues/new)

## Troubleshooting

**A capability call fails with an undeclared error.** Confirm the capability, method, and scope are declared in `openwaggle.extension.json`. The broker rejects privileges that are not declared.

**An import from `src` or `dist` fails.** Import only the documented root and subpath exports. Build directories and source paths are intentionally private.

**Styles do not match the host.** Use `context.theme`, `createOpenWaggleExtensionUiStylesheet`, and the exported UI class names instead of copying OpenWaggle renderer CSS.

There are no migrations within the `0.1` documentation line. Future incompatible changes will receive a new versioned documentation line and migration guide.
