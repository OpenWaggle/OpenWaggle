---
title: "Extension React component catalogue"
description: "Visual reference for every @openwaggle/extension-react 0.2 component, variant, tone, and form state."
order: 2
section: "Packages"
kind: "reference"
---

This catalogue renders the same class names, attributes, and stylesheet shipped by `@openwaggle/extension-react`. The examples are interactive HTML equivalents of the React components, so you can inspect disabled, validation, and control states directly. This page supplies the SDK's default dark theme on each example root, the way the OpenWaggle host supplies the active theme to a mounted extension.

Import the package stylesheet and render the components beneath the host-provided `.ow-extension-root` element.

```tsx
import '@openwaggle/extension-react/styles.css'
import { Button, Field, Input, Panel, Stack } from '@openwaggle/extension-react'
```

## Composed settings surface

<div class="ow-extension-root ow-docs-component-catalog">
  <section class="ow-extension-panel">
    <div class="ow-extension-stack">
      <div class="ow-extension-row ow-docs-component-heading">
        <div>
          <h3 class="ow-extension-heading">Issue tracker</h3>
          <p class="ow-extension-muted">A settings surface composed from Panel, Stack, Field, Input, Select, Checkbox, Badge, Alert, and Button.</p>
        </div>
        <span class="ow-extension-badge" data-ow-tone="success">Connected</span>
      </div>
      <div class="ow-extension-field">
        <label class="ow-extension-text" for="catalog-repository">Repository</label>
        <span class="ow-extension-muted">Owner and repository name used for issue queries.</span>
        <input class="ow-extension-input" id="catalog-repository" value="OpenWaggle/OpenWaggle" />
      </div>
      <div class="ow-extension-field">
        <label class="ow-extension-text" for="catalog-label">Default label</label>
        <select class="ow-extension-select" id="catalog-label">
          <option>ready-for-agent</option>
          <option>enhancement</option>
          <option>documentation</option>
        </select>
      </div>
      <label class="ow-extension-row ow-extension-text">
        <input class="ow-extension-checkbox" type="checkbox" checked />
        Refresh when the project changes
      </label>
      <div class="ow-extension-alert" data-ow-tone="info" role="status">
        Configuration is stored through the brokered project settings capability.
      </div>
      <div class="ow-extension-row">
        <button class="ow-extension-button" data-ow-variant="primary" type="button">Save settings</button>
        <button class="ow-extension-button" data-ow-variant="secondary" type="button">Test connection</button>
      </div>
    </div>
  </section>
</div>

## Layout

`Panel` provides the themed surface. `Stack` lays out children vertically and accepts any CSS `gap`. Use them together for extension-owned composition rather than importing private OpenWaggle renderer layouts. Use ordinary extension-owned markup for layouts that do not need a package component.

```tsx
<Panel>
  <Stack gap="0.75rem">
    <Heading />
    <Content />
  </Stack>
</Panel>
```

## Button

`Button` forwards native button props and supports `primary`, `secondary`, and `ghost` variants. `secondary` is the default. Use a real `button` type and keep native disabled semantics.

<div class="ow-extension-root ow-docs-component-row">
  <button class="ow-extension-button" data-ow-variant="primary" type="button">Primary</button>
  <button class="ow-extension-button" data-ow-variant="secondary" type="button">Secondary</button>
  <button class="ow-extension-button" data-ow-variant="ghost" type="button">Ghost</button>
  <button class="ow-extension-button" data-ow-variant="primary" type="button" disabled>Disabled</button>
</div>

## Badge and Alert tones

`Badge` provides compact metadata. `Alert` provides status, note, or urgent feedback through its `role`, which is `status` by default. Both support `neutral`, `accent`, `success`, `warning`, `danger`, and `info` tones. Use semantic tones only for their stated meaning. Do not use danger or warning merely for visual emphasis.

<div class="ow-extension-root">
  <div class="ow-extension-stack">
    <div class="ow-docs-component-row">
      <span class="ow-extension-badge" data-ow-tone="neutral">Neutral</span>
      <span class="ow-extension-badge" data-ow-tone="accent">Accent</span>
      <span class="ow-extension-badge" data-ow-tone="success">Success</span>
      <span class="ow-extension-badge" data-ow-tone="warning">Warning</span>
      <span class="ow-extension-badge" data-ow-tone="danger">Danger</span>
      <span class="ow-extension-badge" data-ow-tone="info">Info</span>
    </div>
    <div class="ow-extension-alert" data-ow-tone="neutral" role="status">No extension status has been reported yet.</div>
    <div class="ow-extension-alert" data-ow-tone="accent" role="note">This extension can add a project-specific view.</div>
    <div class="ow-extension-alert" data-ow-tone="success" role="status">The extension settings were saved.</div>
    <div class="ow-extension-alert" data-ow-tone="warning" role="note">The next refresh may use cached data.</div>
    <div class="ow-extension-alert" data-ow-tone="danger" role="alert">The configured credential is no longer valid.</div>
    <div class="ow-extension-alert" data-ow-tone="info" role="status">The extension will refresh when the active project changes.</div>
  </div>
</div>

```tsx
<Stack>
  <Badge tone="success">Connected</Badge>
  <Alert tone="warning" role="note">Review the configuration before continuing.</Alert>
</Stack>
```

## Input, Textarea, Select, Checkbox, and Field

`Field` groups a label, optional description, control, and error. Set its `htmlFor` to the control's `id` to connect the label. It does not assign IDs or connect descriptions and errors automatically. Add `aria-describedby` and `aria-invalid` to the control when needed, and give the referenced description or error element an ID. `Input`, `Textarea`, `Select`, and `Checkbox` forward native attributes and refs.

<div class="ow-extension-root">
  <div class="ow-extension-panel">
    <div class="ow-extension-stack">
      <div class="ow-extension-field">
        <label class="ow-extension-text" for="catalog-input">Label query</label>
        <span class="ow-extension-muted">Comma-separated GitHub labels.</span>
        <input class="ow-extension-input" id="catalog-input" placeholder="enhancement, ready-for-agent" />
      </div>
      <div class="ow-extension-field">
        <label class="ow-extension-text" for="catalog-textarea">Prompt template</label>
        <textarea class="ow-extension-textarea" id="catalog-textarea" rows="3">Summarize the selected issue and propose the smallest safe implementation.</textarea>
      </div>
      <div class="ow-extension-field">
        <label class="ow-extension-text" for="catalog-error">Required project</label>
        <select class="ow-extension-select" id="catalog-error" aria-invalid="true" aria-describedby="catalog-error-message">
          <option value="">Select a project</option>
        </select>
        <span id="catalog-error-message" data-ow-tone="danger">Choose a project before saving.</span>
      </div>
      <div class="ow-extension-field">
        <label class="ow-extension-text" for="catalog-disabled">Workspace token</label>
        <input class="ow-extension-input" id="catalog-disabled" value="Managed by the host" disabled />
      </div>
      <label class="ow-extension-row ow-extension-muted">
        <input class="ow-extension-checkbox" type="checkbox" disabled />
        Disabled until a project is selected
      </label>
    </div>
  </div>
</div>

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

Keep labels visible, preserve keyboard interaction, and use native disabled and validation states. Package focus styles use the host-projected focus ring and shadow variables. The default theme sets both to `transparent` and `none`, so it draws no focus ring.

## Source and syntax

`SyntaxBlock` renders host-produced token lines. Both it and `SourceView` accept a `syntax` capability from the mount context, source text, and either a canonical language or a path.

```tsx
<SourceView
  syntax={context.sdk.surface.syntax}
  source={configurationSource}
  path="openwaggle.extension.json"
  ariaLabel="Extension manifest"
/>
```

`SourceView` shows line numbers by default and has a fixed height of up to 320 pixels. It renders only the lines in view, so long files stay fast. It asks the host to highlight a source only up to 64 KiB (65,536 UTF-16 code units) and 2,000 lines, and shows larger sources as plain text. It ignores `wrap`. Use `SyntaxBlock` with `wrap` for short snippets that should wrap.

Both components begin with safe plain text, then apply the latest host result. They ignore an obsolete async result after the source changes. The host owns theme selection, language aliases, scheduling, caching, input limits, and fallback diagnostics. The extension never receives highlighted HTML.

This static example shows the plain-text markup a `SyntaxBlock` with `showLineNumbers` renders before the host result arrives:

<div class="ow-extension-root">
  <section aria-label="Extension manifest">
    <pre class="ow-syntax-block" data-ow-syntax-language="json" data-ow-syntax-status="plain-text" data-ow-wrap="false"><code><span><span aria-hidden="true" class="ow-syntax-line-number">1</span>{</span>
<span><span aria-hidden="true" class="ow-syntax-line-number">2</span>  "id": "issue-tracker",</span>
<span><span aria-hidden="true" class="ow-syntax-line-number">3</span>  "name": "Issue tracker",</span>
<span><span aria-hidden="true" class="ow-syntax-line-number">4</span>  "version": "0.2.0"</span>
<span><span aria-hidden="true" class="ow-syntax-line-number">5</span>}</span></code></pre>
  </section>
</div>

## Theme contract

The stylesheet uses the complete `@openwaggle/extension-sdk` 0.2 appearance projection. OpenWaggle supplies it on the extension root. A standalone preview must apply `.ow-extension-root` and provide the same variables, for example from `extensionThemeCssVariableDeclarations()` in `@openwaggle/extension-sdk`. The stylesheet has no fallback theme of its own.

See the [API reference](../api-reference) for the exported components and prop type names.
