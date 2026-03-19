# Spec: Dynamic Model Fetch — Cleanup & Quality Pass

**Branch:** `feat/dynamic-model-fetch`  
**Worktree:** `OpenWaggle-feat-models`  
**Status:** All changes currently stashed (`git stash`). The stash contains partial Claude Code work from a previous session that was aborted. This spec defines what to implement — use the stash as reference only.

---

## Context

The `feat/dynamic-model-fetch` branch adds:
- Dynamic model fetching from provider APIs (`/v1/models`) at runtime
- Per-connection curated static lists for subscriptions (Codex, Claude Code)
- `enabledModels` user setting — a flat list of model IDs the user picks in Settings
- Refactored `ModelSelector` — flat list, no rail tabs, no search, no stars
- `AvailableModelsSection` in Connections Settings — accordion grouped by connection

Several issues remain that need to be fixed before this is ready to merge.

---

## Issue 1 — TanStack type constraint (NO casts, NO @ts-expect-error)

### Problem
`createAnthropicChat` and `createOpenaiChat` are typed as generics constrained to `(typeof ANTHROPIC_MODELS)[number]` and `(typeof OPENAI_CHAT_MODELS)[number]` respectively. We pass dynamic string model IDs fetched at runtime, which causes type errors. Currently worked around with cast helper functions (`createAnthropicAdapter`, etc.) — this is not acceptable.

### Solution: TypeScript module augmentation

Create `src/main/providers/tanstack-type-extensions.d.ts`:

```ts
/**
 * Widen TanStack adapter model type constraints to accept any string model ID.
 * TanStack locks models to a static literal union; we support dynamic IDs from /v1/models.
 * This augmentation lets callers pass any string without casts or @ts-expect-error.
 */
import type { AnyTextAdapter } from '@tanstack/ai'
import type { AnthropicTextConfig } from '@tanstack/ai-anthropic'

declare module '@tanstack/ai-anthropic' {
  export function createAnthropicChat(
    model: string,
    apiKey: string,
    config?: Omit<AnthropicTextConfig, 'apiKey'>,
  ): AnyTextAdapter

  interface AnthropicTextAdapterConstructor {
    new (config: AnthropicTextConfig, model: string): AnyTextAdapter
  }
  const AnthropicTextAdapter: AnthropicTextAdapterConstructor
}

declare module '@tanstack/ai-openai' {
  export function createOpenaiChat(
    model: string,
    apiKey: string,
    config?: object,
  ): AnyTextAdapter
}

declare module '@tanstack/ai-openrouter' {
  export function createOpenRouterText(model: string, apiKey: string): AnyTextAdapter
}
```

**After adding this file:**
- Remove the `createAnthropicAdapter`, `createAnthropicSubscriptionAdapter`, `createOpenAIAdapter` wrapper functions from `anthropic.ts` and `openai.ts`
- Remove the `import type { AnyTextAdapter }` from those files (no longer needed)
- Remove the `@ts-expect-error` from `openrouter.ts` if any
- Call TanStack functions directly — they now accept `string`

**Verify:** `pnpm typecheck` passes with zero errors.

---

## Issue 2 — Correct model lists (source of truth: pi-ai `models.generated.js`)

### Problem
`ANTHROPIC_SUBSCRIPTION_MODELS` and `OPENAI_CODEX_SUBSCRIPTION_MODELS` were partly fabricated. The authoritative source is `@mariozechner/pi-ai` `models.generated.js`, which is the same model registry used by OpenCode and OpenClaw.

### Solution

**`src/main/providers/anthropic.ts` — `ANTHROPIC_SUBSCRIPTION_MODELS`:**

These are the models available via Claude Code OAuth (`sk-ant-oat...` tokens). Same endpoint as API key but with OAuth headers. Source: pi-ai `anthropic` provider block.

```ts
const ANTHROPIC_SUBSCRIPTION_MODELS = [
  'claude-opus-4-6',    // 200k ctx, 128k maxTokens
  'claude-opus-4-5',    // 200k ctx, 64k maxTokens
  'claude-sonnet-4-6',  // 200k ctx, 64k maxTokens
  'claude-sonnet-4-5',  // 200k ctx, 64k maxTokens
  'claude-haiku-4-5',   // 200k ctx, 64k maxTokens
] as const
```

Note: pi-ai lists `claude-opus-4-6` with 200k context (not 1M). This may reflect tier restrictions. Use 200k.

**`src/main/providers/openai.ts` — `OPENAI_CODEX_SUBSCRIPTION_MODELS`:**

These are the models available via Codex OAuth (chatgpt.com backend). Cannot be fetched dynamically. Source: pi-ai `openai-codex` provider block.

```ts
const OPENAI_CODEX_SUBSCRIPTION_MODELS = [
  'gpt-5.4',             // 272k ctx, 128k maxTokens
  'gpt-5.3-codex',       // 272k ctx, 128k maxTokens
  'gpt-5.3-codex-spark', // 128k ctx, 128k maxTokens
  'gpt-5.2',             // 272k ctx, 128k maxTokens
  'gpt-5.2-codex',       // 272k ctx, 128k maxTokens
  'gpt-5.1-codex-max',   // 272k ctx, 128k maxTokens
  'gpt-5.1-codex-mini',  // 272k ctx, 128k maxTokens
  'gpt-5.1',             // 272k ctx, 128k maxTokens
] as const
```

**Future reference:** When updating model lists in the future, always check:
`node_modules/.pnpm/@mariozechner+pi-ai@*/node_modules/@mariozechner/pi-ai/dist/models.generated.js`

---

## Issue 3 — vite-plugin-svgr for provider icons

### Problem
`src/renderer/src/components/icons/provider-icons.tsx` contains ~300 lines of hand-coded SVG JSX paths. This is fragile, hard to maintain, and diverges from the source SVG files in `src/renderer/src/assets/provider-logos/`.

### Solution

**Install:** `pnpm add -D vite-plugin-svgr`

**`electron.vite.config.ts`** — add to renderer plugins array:
```ts
import svgr from 'vite-plugin-svgr'
// ...
renderer: {
  plugins: [
    svgr(),
    // ... existing plugins
  ]
}
```

**`src/renderer/src/assets/svg.d.ts`** — type declaration for `?react` imports:
```ts
declare module '*.svg?react' {
  import type * as React from 'react'
  const ReactComponent: React.FunctionComponent<React.SVGProps<SVGSVGElement>>
  export default ReactComponent
}
```

**`src/renderer/src/components/icons/provider-icons.tsx`** — rewrite using imports:
```tsx
import AnthropicSvg from '@/assets/provider-logos/anthropic.svg?react'
import ClaudeCodeSvg from '@/assets/provider-logos/claude-code.svg?react'
import CodexSvg from '@/assets/provider-logos/codex.svg?react'
import GeminiSvg from '@/assets/provider-logos/gemini.svg?react'
import GrokSvg from '@/assets/provider-logos/grok.svg?react'
import OllamaSvg from '@/assets/provider-logos/ollama.svg?react'
import OpenAISvg from '@/assets/provider-logos/openai.svg?react'
import OpenRouterSvg from '@/assets/provider-logos/openrouter.svg?react'

interface IconProps {
  className?: string
  style?: React.CSSProperties
}

export function AnthropicIcon({ className, style }: IconProps) {
  return <AnthropicSvg className={className} style={style} />
}
// ... same pattern for all 8 icons
```

Keep exact same export names so nothing else needs to change.

**SVG files required** (already present in `src/renderer/src/assets/provider-logos/`):
- `anthropic.svg` ✅
- `claude-code.svg` ✅
- `codex.svg` ✅
- `gemini.svg` ✅
- `grok.svg` ✅
- `ollama.svg` ✅
- `openai.svg` ✅
- `openrouter.svg` ✅

---

## Issue 4 — Split AvailableModelsSection into focused components

### Problem
`src/renderer/src/components/settings/sections/connections/AvailableModelsSection.tsx` is too large — it handles data fetching, state, accordion logic, group rendering, and row rendering all in one file.

### Solution: 3 components

**`AvailableModelsSection.tsx`** — top-level only (~80 lines):
- Data fetching (api key models + subscription models via `api.fetchProviderModels`)
- State: `expandedGroups`, `apiKeyModels`, `subscriptionModels`
- Builds `groups: ModelGroup[]` array
- Renders `<h3>` header + `{groups.map(group => <ModelGroupAccordion ... />)}`
- Handles `handleToggle`, `handleSelectAll`, `handleClear` callbacks

**`ModelGroupAccordion.tsx`** (~60 lines):
- Receives: `group`, `enabledSet`, `isExpanded`, `onToggle`, `onSelectAll`, `onClear`
- Renders the accordion header (icon, label, count, chevron, All/None buttons)
- Renders the expanded body with `{group.models.map(m => <ModelCheckboxRow ... />)}`

**`ModelCheckboxRow.tsx`** (~30 lines):
- Receives: `model`, `checked`, `onChange`
- Renders a single `<label>` with checkbox + model name

**Types** — add `ModelGroup` interface to a co-located `types.ts` or inline in `AvailableModelsSection.tsx`:
```ts
interface ModelGroup {
  readonly key: string                       // e.g. "openai:api-key"
  readonly label: string                     // e.g. "OpenAI (API Key)"
  readonly subtitle?: string                 // e.g. "subscription"
  readonly provider: Provider
  readonly authMethod: 'api-key' | 'subscription'
  readonly models: readonly ModelDisplayInfo[]
}
```

---

## Issue 5 — Remove portal + redundant event listeners from ModelSelector

### Problem
`src/renderer/src/components/shared/ModelSelector/ModelSelector.tsx` uses `createPortal` to render the dropdown into `document.body`, plus 3 event listeners: `resize`, `scroll`, and `mousedown`. This is overly complex for a simple select dropdown.

### Why portal was used
The toolbar is at the bottom of the window, inside a flex container. Without portal, `overflow: hidden` on parent elements clips the dropdown. However, `position: fixed` escapes all overflow clipping without needing a portal.

### Solution: position: fixed, no portal

**Remove:**
- `import { createPortal } from 'react-dom'`
- `window.addEventListener('resize', updateOverlayPosition)`
- `window.removeEventListener('resize', updateOverlayPosition)`
- `window.addEventListener('scroll', updateOverlayPosition, true)`
- `window.removeEventListener('scroll', updateOverlayPosition, true)`
- The `DROPDOWN_ESTIMATED_HEIGHT` constant
- The second `useEffect` that repositioned after render (the one checking `dropdownRef.current?.offsetHeight`)
- The entire portal `createPortal(...)` call

**Keep:**
- `document.addEventListener('mousedown', onMouseDown)` — for outside-click to close
- `document.removeEventListener('mousedown', onMouseDown)` — cleanup
- The `getBoundingClientRect()` call on open — to position the dropdown
- The `overlayPosition` state and `setOverlayPosition`

**Render the dropdown directly** (no portal):
```tsx
{isOpen && (
  <ModelSelectorDropdown
    ref={dropdownRef}
    overlayPosition={overlayPosition}
    models={flatModels}
    selectedModelId={value}
    onKeyDown={handleKeyDown}
    onSelectModel={selectModel}
  />
)}
```

The `ModelSelectorDropdown` must have `position: fixed` in its className (already has it). Since it's `fixed`, it escapes the parent overflow without a portal.

**Position calculation** stays the same — calculate on open using `getBoundingClientRect()`. No live repositioning needed since:
- The toolbar is fixed (doesn't move on scroll)
- The dropdown is short-lived (user picks a model and it closes)
- Resize while dropdown is open is an edge case that doesn't need handling

---

## Implementation order

1. `tanstack-type-extensions.d.ts` + remove wrapper helpers (Issue 1)
2. Correct model lists (Issue 2) — quick update, no API changes
3. vite-plugin-svgr (Issue 3) — needs install + config + rewrite
4. AvailableModelsSection split (Issue 4) — refactor only, no behaviour change
5. Portal removal (Issue 5) — simplest last, low risk

Each step should typecheck before moving to the next. Full build at the end.

---

## Definition of done

- `pnpm typecheck` passes with zero errors
- `pnpm build` succeeds
- Zero `@ts-expect-error` in the codebase
- Zero `as (typeof ...)` casts in provider files
- No `createPortal` in ModelSelector
- Max 3 event listeners in ModelSelector (just the mousedown one)
- `provider-icons.tsx` imports SVGs via `?react`, no hand-coded paths
- `AvailableModelsSection.tsx` < 100 lines
- Model lists match pi-ai source of truth exactly
