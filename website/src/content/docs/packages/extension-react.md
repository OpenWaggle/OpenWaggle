---
title: "@openwaggle/extension-react"
description: "React primitives for OpenWaggle extension surfaces that use the extension UI style contract."
order: 3
section: "Packages"
---

`@openwaggle/extension-react` provides small React primitives for OpenWaggle extension surfaces.

Use it when an extension contribution is implemented in React and should match the OpenWaggle extension theme contract. It is optional; non-React extensions can use `@openwaggle/extension-sdk` UI helpers directly.

## Install

```bash
pnpm add @openwaggle/extension-react @openwaggle/extension-sdk react react-dom
```

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
