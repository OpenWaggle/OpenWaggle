# Wire Quality Presets to Model Routing

**Priority:** 6 — Differentiator
**Depends on:** Nothing (but benefits from Task 2 for orchestration write tools)
**Blocks:** Nothing

---

## Problem

Quality presets exist and the model mapping is already defined (`quality-config.ts:20-51`), but the orchestration system doesn't use different models per task. Every executor task uses the same model. The multi-provider advantage is wasted.

## What Exists (Already Working)

- `src/main/agent/quality-config.ts:20-51` — `QUALITY_MODEL_MAP` maps provider × preset → model. Already populated for all 6 providers:
  ```
  anthropic:  low → claude-haiku-4-5,  medium → claude-sonnet-4-5,  high → claude-opus-4-6
  openai:     low → gpt-5-mini,        medium → gpt-5,              high → gpt-5.2
  gemini:     low → gemini-2.5-flash-lite, medium → gemini-2.5-flash, high → gemini-2.5-pro
  grok:       low → grok-3-mini,       medium → grok-4-fast-non-reasoning, high → grok-4
  openrouter: low → openrouter/auto,   medium → openai/gpt-4.1,     high → anthropic/claude-opus-4
  ollama:     low/medium/high → undefined (uses selected model)
  ```
- `quality-config.ts:53-69` — `QUALITY_TIER_CONFIG` defines temperature/topP/maxTokens per preset
- `quality-config.ts:121-139` — `resolveQualityConfig()` returns the resolved model + params for a given preset
- `src/shared/types/settings.ts:7-8` — `QualityPreset` type: `'low' | 'medium' | 'high'`
- The classic agent loop already uses quality presets correctly (`agent-loop.ts:169-183`)

## What's NOT Working

- Orchestration (`service.ts:74-79`) resolves quality once and uses the same config for ALL tasks:
  - Planner call (`service.ts:160`) — uses `plannerQuality` (same model, just higher maxTokens)
  - All executor tasks (`service.ts:248`) — use `quality` (same model)
  - Synthesis (`service.ts:274`) — uses `quality` (same model)
- No per-task quality routing. A simple "list files" task uses the same expensive model as a complex "analyze architecture" task.

## Implementation

### 1. Task-level quality mapping

In `service.ts`, map task `kind` to quality preset:
```ts
const TASK_KIND_QUALITY: Record<string, QualityPreset> = {
  'analysis': 'medium',
  'debugging': 'high',
  'refactoring': 'high',
  'testing': 'medium',
  'documentation': 'low',
  'repo-edit': 'medium',
  'synthesis': 'high',    // synthesis should always be high
  'general': 'medium',
}
```

### 2. Create per-task adapters

In executor's `execute()` callback (`service.ts:225`):
- Resolve quality per task: `resolveQualityConfig(provider.id, model, taskQuality)`
- Create a task-specific adapter if the resolved model differs from the base model
- Cache adapters by model to avoid re-creating: `Map<string, AnyTextAdapter>`

### 3. Show model per task in UI

In orchestration events, include the model used for each task:
- Add `model` field to task_started/task_succeeded events
- Show in the streaming narration: `"Analyzing codebase (Claude Sonnet)... Debugging issue (Claude Opus)..."`

### 4. User-facing quality indicator

- In `ComposerStatusBar.tsx`, show current quality preset with a tooltip explaining: "Low: fast + cheap (Haiku), Medium: balanced (Sonnet), High: best quality (Opus)"
- Consider showing estimated cost per preset (rough $/1K tokens)

## Files to Touch

- `src/main/orchestration/service.ts` — per-task quality resolution, adapter caching
- `src/main/agent/quality-config.ts` — export `QUALITY_MODEL_MAP` for orchestration use
- `src/shared/types/orchestration.ts` — add `model` to task event types
- `src/renderer/src/components/composer/ComposerStatusBar.tsx` — quality tooltip
