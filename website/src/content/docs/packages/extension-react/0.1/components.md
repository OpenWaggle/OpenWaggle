---
title: "Extension React component catalogue"
description: "Visual reference for every @openwaggle/extension-react 0.1 primitive, variant, tone, and form state."
order: 2
section: "Packages"
---

This catalogue renders the same class names, attributes, and stylesheet shipped by `@openwaggle/extension-react`. The examples are interactive HTML equivalents of the React primitives so you can inspect focus, disabled, validation, and control states directly.

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
          <p class="ow-extension-muted">A realistic settings surface composed from Panel, Stack, Field, Input, Select, Checkbox, Badge, Alert, and Button.</p>
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

## Button

`Button` forwards native button props and supports `primary`, `secondary`, and `ghost` variants. Use a real `button` type and preserve disabled semantics.

<div class="ow-extension-root ow-docs-component-row">
  <button class="ow-extension-button" data-ow-variant="primary" type="button">Primary</button>
  <button class="ow-extension-button" data-ow-variant="secondary" type="button">Secondary</button>
  <button class="ow-extension-button" data-ow-variant="ghost" type="button">Ghost</button>
  <button class="ow-extension-button" data-ow-variant="primary" type="button" disabled>Disabled</button>
</div>

## Badge and Alert tones

`Badge` provides compact metadata. `Alert` provides status, note, or urgent feedback. Both support `neutral`, `accent`, `success`, `warning`, `danger`, and `info` tones.

<div class="ow-extension-root ow-extension-stack">
  <div class="ow-docs-component-row">
    <span class="ow-extension-badge" data-ow-tone="neutral">Neutral</span>
    <span class="ow-extension-badge" data-ow-tone="accent">Accent</span>
    <span class="ow-extension-badge" data-ow-tone="success">Success</span>
    <span class="ow-extension-badge" data-ow-tone="warning">Warning</span>
    <span class="ow-extension-badge" data-ow-tone="danger">Danger</span>
    <span class="ow-extension-badge" data-ow-tone="info">Info</span>
  </div>
  <div class="ow-extension-alert" data-ow-tone="success" role="status">The extension settings were saved.</div>
  <div class="ow-extension-alert" data-ow-tone="warning" role="note">The next refresh may use cached data.</div>
  <div class="ow-extension-alert" data-ow-tone="danger" role="alert">The configured credential is no longer valid.</div>
</div>

## Input, Textarea, Select, Checkbox, and Field

`Field` associates a label, optional description, control, and error. Inputs forward their native React props, so browser validation and accessible attributes remain available.

<div class="ow-extension-root ow-extension-panel">
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
    <label class="ow-extension-row ow-extension-muted">
      <input class="ow-extension-checkbox" type="checkbox" disabled />
      Disabled until a project is selected
    </label>
  </div>
</div>

## Stack and Panel

`Stack` owns vertical spacing and accepts any CSS `gap`. `Panel` creates the bounded host-aligned surface. Use them together for extension-owned composition rather than importing private OpenWaggle renderer layouts.

See the [API reference](../api-reference) for complete props and exported types.
