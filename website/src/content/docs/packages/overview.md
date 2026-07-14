---
title: "Packages"
description: "OpenWaggle publishable packages for extension authors, Waggle policy, and Pi Waggle integration."
order: 1
section: "Packages"
---

OpenWaggle maintains publishable npm packages for extension authors and Waggle runtime integrations.

These packages are separate from the OpenWaggle desktop app. Use them when you are building an OpenWaggle extension package, reusing Waggle mode policy outside the app, or installing Waggle mode in a Pi runtime.

## Available Packages

| Package | Use it for |
|---------|------------|
| [`@openwaggle/extension-sdk`](/docs/packages/extension-sdk) | Browser-safe extension types, broker helpers, theme helpers, UI class/style helpers, and federated-module mount context types. |
| [`@openwaggle/extension-react`](/docs/packages/extension-react) | Optional React primitives for extension surfaces that want host-aligned controls and layout pieces. |
| [`@openwaggle/waggle-core`](/docs/packages/waggle-core) | Runtime-neutral Waggle config, presets, prompts, state, consensus, and turn policy. |
| [`@openwaggle/pi-waggle`](/docs/packages/pi-waggle) | Pi-native Waggle extension package built on top of `@openwaggle/waggle-core`. |

## Install

After the packages are publicly available on npm, install only the packages your project needs:

```bash
pnpm add @openwaggle/extension-sdk
pnpm add @openwaggle/extension-react @openwaggle/extension-sdk react react-dom
pnpm add @openwaggle/waggle-core
pnpm add @openwaggle/pi-waggle @earendil-works/pi-coding-agent @earendil-works/pi-tui
```

The `@openwaggle` npm namespace is reserved for these packages. Install commands will work after their first public `0.1.0` releases; OpenWaggle does not publish them under a temporary personal scope.

## Import Boundaries

Consumers should import only documented package entry points and package subpaths. Do not import from `src`, `dist`, `dist-cjs`, or an arbitrary OpenWaggle checkout path.

```ts
import type { OpenWaggleFederatedModule } from '@openwaggle/extension-sdk'
import { Panel } from '@openwaggle/extension-react'
import { getWaggleTurn } from '@openwaggle/waggle-core'
import piWaggle from '@openwaggle/pi-waggle/extension'
```

OpenWaggle packages publish built ESM, CommonJS, and TypeScript declarations behind their `package.json` export boundaries.

## Which Package Should I Use?

Use `@openwaggle/extension-sdk` for any OpenWaggle visual extension. It is the browser-safe author contract for `mount(context)`, theme data, brokered capability calls, manifest types, UI helper classes, and stylesheet helpers.

Use `@openwaggle/extension-react` only when your extension surface is written in React and you want the provided primitive components. React and React DOM remain peer dependencies in the extension project.

Use `@openwaggle/waggle-core` when you need reusable Waggle policy without Pi-specific runtime hooks.

Use `@openwaggle/pi-waggle` when you are installing Waggle mode into Pi. It depends on `@openwaggle/waggle-core`, so Pi users do not need to install core separately unless they also import core APIs directly.

## Related Docs

- [OpenWaggle Extensions](/docs/extending/openwaggle-extensions)
- [Waggle Mode](/docs/using-openwaggle/waggle-mode)
- [Pi Runtime](/docs/developer-workflow/pi-runtime)
