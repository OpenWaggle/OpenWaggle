---
title: "@openwaggle/extension-react"
description: "React primitives for OpenWaggle extension surfaces that use the SDK 0.2 theme contract."
order: 3
section: "Packages"
---

`@openwaggle/extension-react` provides small React primitives for extension surfaces that should match OpenWaggle without importing application renderer code.

<package-install packages="@openwaggle/extension-react @openwaggle/extension-sdk react react-dom"></package-install>

`react` and `react-dom` are peer dependencies. The supported peer line is React 19.

Import the default host-aligned stylesheet once in the extension bundle:

```ts
import '@openwaggle/extension-react/styles.css'
```

## Mount A React Surface

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

The OpenWaggle host adds `.ow-extension-root` to `context.root` and projects the SDK 0.2 appearance variables onto it. Standalone harnesses must add the same class and provide the SDK theme variables before rendering the primitives.

## Migrating From 0.1

Version 0.2 replaces the bespoke 0.1 spacing, radius, elevation, and fallback values with the Tailwind-standard extension theme contract from `@openwaggle/extension-sdk` 0.2.

- Mount all primitives beneath `.ow-extension-root`.
- Replace `--ow-space-*` overrides with multiples of `--ow-spacing`.
- Replace `--ow-radius-panel`, `--ow-radius-sm`, and `--ow-radius-md` overrides with the standard radius variables.
- Replace `--ow-elevation-card` with `--ow-shadow-sm` and use the projected text-size and line-height pairs.
- Do not rely on stylesheet fallback colours; the host or standalone harness owns the complete theme projection.

## Components

The package exports `Alert`, `Badge`, `Button`, `Checkbox`, `Field`, `Input`, `Panel`, `Select`, `Stack`, and `Textarea`. See the [visual component catalogue](./components) and [complete API reference](./api-reference).

## Compatibility

| Requirement | Supported line |
|-------------|----------------|
| Node.js | 22.19 and newer |
| React | 19.x |
| React DOM | 19.x |
| Extension SDK | 0.2.x |
| Module format | ESM and CommonJS |

## Support

- [npm package](https://www.npmjs.com/package/@openwaggle/extension-react)
- [Package changelog](https://github.com/OpenWaggle/OpenWaggle/blob/main/packages/extension-react/CHANGELOG.md)
- [Report an issue](https://github.com/OpenWaggle/OpenWaggle/issues/new)
