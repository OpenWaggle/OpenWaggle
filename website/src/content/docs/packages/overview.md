---
title: "Packages"
description: "OpenWaggle publishable packages for extension authors, Waggle policy, and Pi Waggle integration."
order: 1
section: "Packages"
kind: "overview"
---

OpenWaggle publishes npm packages for people who build extensions and for people who want Waggle mode outside the app. They are separate from the desktop app. Use them to build an OpenWaggle extension, to reuse Waggle mode's rules in your own program, or to add Waggle mode to Pi.

## The packages

| Package | Use it for |
| --- | --- |
| [`@openwaggle/extension-sdk`](/docs/packages/extension-sdk) | Extension types, SDK helpers, theme helpers, UI class and style helpers, and the mount context types for federated modules, all safe to use in the browser |
| [`@openwaggle/extension-react`](/docs/packages/extension-react) | Optional React components for extension surfaces that should look like the app's own controls and layout |
| [`@openwaggle/waggle-core`](/docs/packages/waggle-core) | Waggle configuration, presets, prompts, state, consensus, and turn rules, with no runtime attached |
| [`@openwaggle/pi-waggle`](/docs/packages/pi-waggle) | A Pi extension that adds Waggle mode, built on `@openwaggle/waggle-core` |

The packages are public, under the `@openwaggle` npm organization. Each package's guide and API reference are versioned by `major.minor`. The links above always open the latest version.

## Install a package

Install only the packages your project needs.

For a framework-neutral extension:

```bash
pnpm add @openwaggle/extension-sdk
```

For an extension written in React:

```bash
pnpm add @openwaggle/extension-react @openwaggle/extension-sdk react react-dom
```

For Waggle's rules without Pi:

```bash
pnpm add @openwaggle/waggle-core
```

For Waggle mode in Pi:

```bash
pnpm add @openwaggle/pi-waggle @earendil-works/pi-ai @earendil-works/pi-coding-agent @earendil-works/pi-tui
```

## How they fit together

An arrow means "uses":

```text
Framework-neutral extension ──> @openwaggle/extension-sdk
React extension ───────────────> @openwaggle/extension-react ──> @openwaggle/extension-sdk

Any Waggle host ───────────────> @openwaggle/waggle-core
Pi runtime ────────────────────> @openwaggle/pi-waggle ─────────> @openwaggle/waggle-core
```

The extension packages and the Waggle packages solve separate problems. Install both kinds only if your project needs both.

## Choose a package

Use `@openwaggle/extension-sdk` for any OpenWaggle visual extension. It defines `mount(context)`, the theme data, SDK capability calls, manifest types, UI class names, and stylesheet helpers, and it is safe to use in the browser.

Use `@openwaggle/extension-react` only when your extension surface is written in React and you want its ready-made components. React and React DOM stay peer dependencies of your extension project.

Use `@openwaggle/waggle-core` when you want Waggle's rules without any Pi hooks.

Use `@openwaggle/pi-waggle` to add Waggle mode to Pi. It depends on `@openwaggle/waggle-core`, so you install core separately only if you also import its APIs yourself.

## Import only the public entry points

Import from the documented package entry points and subpaths only. Never import from `src`, `dist`, `dist-cjs`, or a path inside an OpenWaggle checkout.

```ts
import type { OpenWaggleFederatedModule } from '@openwaggle/extension-sdk'
import { Panel } from '@openwaggle/extension-react'
import { getWaggleTurn } from '@openwaggle/waggle-core'
import piWaggle from '@openwaggle/pi-waggle/extension'
```

Each package publishes built ESM, CommonJS, and TypeScript declarations behind the `exports` field of its `package.json`.

## Related docs

- [OpenWaggle Extensions](/docs/extending/openwaggle-extensions)
- [Waggle mode](/docs/using-openwaggle/waggle-mode)
- [Pi runtime](/docs/developer-workflow/pi-runtime)
