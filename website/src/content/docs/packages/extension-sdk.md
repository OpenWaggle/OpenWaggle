---
title: "@openwaggle/extension-sdk"
description: "Browser-safe OpenWaggle extension SDK types, broker helpers, theme helpers, and federated-module context helpers."
order: 2
section: "Packages"
---

`@openwaggle/extension-sdk` is the browser-safe author package for OpenWaggle extension surfaces.

Use it in extension modules that mount into OpenWaggle-owned containers. The package gives you the public `mount(context)` types, broker SDK helpers, manifest/contribution types, theme helpers, UI class names, and stylesheet generation helpers without importing OpenWaggle renderer internals.

## Install

```bash
pnpm add @openwaggle/extension-sdk
```

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
| `@openwaggle/extension-sdk/manifest` | Extension manifest and contribution declaration types. |
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
  await context.sdk.storage.packageConfig.project.set(
    'project',
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
