---
title: "@openwaggle/extension-react"
description: "React components for OpenWaggle extension surfaces that use the SDK 0.2 theme contract."
order: 3
section: "Packages"
kind: "guide"
---

`@openwaggle/extension-react` provides small React components for extension surfaces that should match OpenWaggle without importing application renderer code, including host-themed source rendering.

Use it when an extension contribution is implemented in React and should match the OpenWaggle extension theme contract. It is optional. Non-React extensions can use `@openwaggle/extension-sdk` UI helpers directly.

<package-install packages="@openwaggle/extension-react @openwaggle/extension-sdk react react-dom"></package-install>

`react` and `react-dom` are peer dependencies. The supported peer line is React 19.

Import the default host-aligned stylesheet once in the extension bundle:

```ts
import '@openwaggle/extension-react/styles.css'
```

## Mount a React surface

```tsx
import '@openwaggle/extension-react/styles.css'
import type { OpenWaggleFederatedModule } from '@openwaggle/extension-sdk'
import { Badge, Button, Field, Input, Panel, Stack } from '@openwaggle/extension-react'
import { createRoot } from 'react-dom/client'

function SettingsSurface() {
  return (
    <Panel>
      <Stack gap="0.75rem">
        <Badge tone="info">Project</Badge>
        <Field htmlFor="default-label" label="Default label">
          <Input id="default-label" defaultValue="Architect" />
        </Field>
        <Button type="button" variant="primary">Save</Button>
      </Stack>
    </Panel>
  )
}

export const mount: OpenWaggleFederatedModule['mount'] = (context) => {
  const root = createRoot(context.root)
  root.render(<SettingsSurface />)
  return () => root.unmount()
}
```

The OpenWaggle host adds `.ow-extension-root` to `context.root` and projects the SDK 0.2 appearance variables onto it. Standalone harnesses must add the same class and provide the SDK theme variables before rendering the components.

Use the broker SDK from `context.sdk` or `@openwaggle/extension-sdk` for persistence and OpenWaggle capability calls. The React package only supplies UI components.

## Migrating from 0.1

Version 0.2 replaces the bespoke 0.1 spacing, radius, elevation, and fallback values with the Tailwind-standard extension theme contract from `@openwaggle/extension-sdk` 0.2.

- Mount all components beneath `.ow-extension-root`.
- Replace `--ow-space-*` overrides with multiples of `--ow-spacing`.
- Replace `--ow-radius-panel`, `--ow-radius-sm`, and `--ow-radius-md` overrides with the standard radius variables.
- Replace `--ow-elevation-card` with `--ow-shadow-sm` and use the projected text-size and line-height pairs.
- Do not rely on stylesheet fallback colours. The host or standalone harness provides the complete theme projection.

## Components

The package exports `Alert`, `Badge`, `Button`, `Checkbox`, `Field`, `Input`, `Panel`, `Select`, `Stack`, `Textarea`, `SyntaxBlock`, and `SourceView`. Pass `context.sdk.surface.syntax` to the syntax components. The host supplies the active theme and worker-backed tokenization. See the [visual component catalogue](./components) and [complete API reference](./api-reference).

These components use extension SDK class names and data attributes. They are not OpenWaggle app renderer components and they do not import the app's Tailwind or renderer CSS.

## When not to use it

Do not use `@openwaggle/extension-react` if your extension uses plain DOM, Vue, Preact, Svelte, or another renderer. The federated-module contract is framework-neutral, so those extensions can use `@openwaggle/extension-sdk` types, theme helpers, and UI stylesheet helpers directly.

Do not import OpenWaggle renderer components to fill gaps. If a component is missing, build a scoped extension-owned component on top of the extension UI style contract.

## Compatibility

| Requirement | Supported line |
|-------------|----------------|
| Node.js | 22.19 and newer |
| React | 19.x |
| React DOM | 19.x |
| Extension SDK | 0.2.x |
| Module format | ESM and CommonJS |
| OpenWaggle package docs | 0.2 |

## Reference and support

- [Visual component catalogue](./components)
- [Complete API reference](./api-reference)
- [npm package](https://www.npmjs.com/package/@openwaggle/extension-react)
- [Package changelog](https://github.com/OpenWaggle/OpenWaggle/blob/main/packages/extension-react/CHANGELOG.md)
- [Report an issue](https://github.com/OpenWaggle/OpenWaggle/issues/new)

## Troubleshooting

**Components render without OpenWaggle styling.** Import `@openwaggle/extension-react/styles.css` once in the extension bundle, and render the components beneath `.ow-extension-root`.

**React is installed twice.** Keep compatible React and React DOM versions in your extension project and deduplicate them in its build. The host does not supply React through the extension mount context. Your bundler must produce a browser-loadable artifact.

**A non-React extension needs the same visual language.** Use the framework-neutral classes and stylesheet helpers from `@openwaggle/extension-sdk` instead.
