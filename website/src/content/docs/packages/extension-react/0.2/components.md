---
title: "Extension React Components"
description: "Visual and behavioral catalogue for the OpenWaggle React extension primitives."
order: 2
section: "Extension React"
---

Import the package stylesheet and render the primitives beneath the host-provided `.ow-extension-root` element.

```ts
import '@openwaggle/extension-react/styles.css'
```

## Layout

`Panel` provides the themed surface. `Stack` lays out children vertically and accepts an optional `gap`. Use ordinary extension-owned markup for layouts that do not need a package primitive.

```tsx
<Panel>
  <Stack>
    <Heading />
    <Content />
  </Stack>
</Panel>
```

## Actions And Status

`Button` supports `primary`, `secondary`, and `ghost` variants. `Badge` and `Alert` support `neutral`, `accent`, `success`, `warning`, `danger`, and `info` tones.

```tsx
<Stack>
  <Badge tone="success">Connected</Badge>
  <Alert tone="warning">Review the configuration before continuing.</Alert>
  <Button type="button" variant="primary">Save</Button>
</Stack>
```

Use semantic tones only for their stated meaning. Do not use danger or warning merely for visual emphasis.

## Forms

`Field` associates a label, description, and error with form content. `Input`, `Textarea`, `Select`, and `Checkbox` preserve native attributes and refs.

```tsx
<Field
  htmlFor="provider"
  label="Provider"
  description="Choose the provider used by this extension."
>
  <Select id="provider" defaultValue="openai">
    <option value="openai">OpenAI</option>
    <option value="anthropic">Anthropic</option>
  </Select>
</Field>
```

Keep labels visible, preserve keyboard interaction, and use native disabled and validation states. Package focus styles consume the host-projected focus ring and shadow variables.

## Theme Contract

The stylesheet consumes the complete `@openwaggle/extension-sdk` 0.2 appearance projection. OpenWaggle supplies it on the extension root. A standalone preview must apply `.ow-extension-root` and provide the same variables; the stylesheet intentionally has no independent fallback theme.
