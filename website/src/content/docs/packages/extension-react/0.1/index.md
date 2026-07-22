---
title: "@openwaggle/extension-react"
description: "React primitives for OpenWaggle extension surfaces that use the extension UI style contract."
order: 3
section: "Packages"
---

`@openwaggle/extension-react` provides small React primitives for OpenWaggle extension surfaces.

Use it when an extension contribution is implemented in React and should match the OpenWaggle extension theme contract. It is optional; non-React extensions can use `@openwaggle/extension-sdk` UI helpers directly.

<package-install packages="@openwaggle/extension-react @openwaggle/extension-sdk react react-dom"></package-install>

`react` and `react-dom` are peer dependencies. The initial peer range is React 19.

Import the stylesheet when you want the default host-aligned styles:

```ts
import '@openwaggle/extension-react/styles.css'
```

## Components

The package exports primitives for common extension settings, forms, status, and surface layout:

```tsx
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Field,
  Input,
  Panel,
  Select,
  Stack,
  Textarea,
} from '@openwaggle/extension-react'
```

These primitives use extension SDK class names and data attributes. They are not OpenWaggle app renderer components and they do not import the app's Tailwind or renderer CSS.

Explore every primitive, tone, variant, form state, and accessibility contract in the [visual component catalogue](./components).

## React Mount Example

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
        <Field
          htmlFor="default-label"
          label="Default label"
          description="Stored in package configuration through the extension SDK."
        >
          <Input id="default-label" name="default-label" defaultValue="Architect" />
        </Field>
        <Button type="button" variant="primary">
          Save
        </Button>
      </Stack>
    </Panel>
  )
}

const module: OpenWaggleFederatedModule = {
  mount(context) {
    const root = createRoot(context.root)
    root.render(<SettingsSurface />)

    return () => {
      root.unmount()
    }
  },
}

export const mount = module.mount
```

Use the broker SDK from `context.sdk` or `@openwaggle/extension-sdk` for persistence and OpenWaggle capability calls. The React package only supplies UI primitives.

## When Not To Use It

Do not use `@openwaggle/extension-react` if your extension uses plain DOM, Vue, Preact, Svelte, or another renderer. The federated-module contract is framework-neutral, so those extensions can use `@openwaggle/extension-sdk` types, theme helpers, and UI stylesheet helpers directly.

Do not import OpenWaggle renderer components to fill gaps. If a primitive is missing, build a scoped extension-owned component on top of the extension UI style contract.

## Compatibility

| Requirement | Supported line |
|-------------|----------------|
| Node.js | 22.19 and newer |
| React | 19.x |
| React DOM | 19.x |
| Module format | ESM and CommonJS |
| OpenWaggle package docs | 0.1 |

## Reference And Support

- [Visual component catalogue](./components)
- [Complete API reference](./api-reference)
- [npm package](https://www.npmjs.com/package/@openwaggle/extension-react)
- [Package changelog](https://github.com/OpenWaggle/OpenWaggle/blob/main/packages/extension-react/CHANGELOG.md)
- [Report an issue](https://github.com/OpenWaggle/OpenWaggle/issues/new)

## Troubleshooting

**Components render without OpenWaggle styling.** Import `@openwaggle/extension-react/styles.css` once in the extension bundle.

**React is installed twice.** Keep React and React DOM in the extension project and resolve them as shared peer dependencies. Do not bundle a second incompatible React runtime.

**A non-React extension needs the same visual language.** Use the framework-neutral classes and stylesheet helpers from `@openwaggle/extension-sdk` instead.

There are no migrations within the `0.1` documentation line. Future incompatible changes will receive a new versioned documentation line and migration guide.
