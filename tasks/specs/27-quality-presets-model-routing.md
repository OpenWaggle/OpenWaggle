# 27 — Quality Presets → Model Routing

**Status:** Planned
**Priority:** P3
**Category:** Feature
**Depends on:** None (benefits from Spec 06 for orchestration write tools)
**Origin:** Spec 06

---

## Problem

Quality presets exist and the model mapping is already defined (`quality-config.ts:20-51`), but the orchestration system doesn't use different models per task. Every executor task uses the same model. The multi-provider advantage is wasted.

## What Exists (Already Working)

- `QUALITY_MODEL_MAP` maps provider × preset → model for all 6 providers
- `QUALITY_TIER_CONFIG` defines temperature/topP/maxTokens per preset
- `resolveQualityConfig()` returns the resolved model + params
- The classic agent loop already uses quality presets correctly

## What's NOT Working

- Orchestration resolves quality once and uses the same config for ALL tasks
- No per-task quality routing

## Implementation

### 1. Task-level quality mapping

Map task `kind` to quality preset:
```ts
const TASK_KIND_QUALITY: Record<string, QualityPreset> = {
  'analysis': 'medium',
  'debugging': 'high',
  'refactoring': 'high',
  'testing': 'medium',
  'documentation': 'low',
  'repo-edit': 'medium',
  'synthesis': 'high',
  'general': 'medium',
}
```

### 2. Create per-task adapters

- [ ] Resolve quality per task in executor's `execute()` callback
- [ ] Create task-specific adapter if resolved model differs from base
- [ ] Cache adapters by model to avoid re-creation

### 3. Show model per task in UI

- [ ] Add `model` field to task events
- [ ] Show in streaming narration: "Analyzing codebase (Claude Sonnet)..."

### 4. User-facing quality indicator

- [ ] Quality preset tooltip in `ComposerStatusBar.tsx`

## Files to Touch

- `src/main/orchestration/service.ts` — per-task quality resolution, adapter caching
- `src/main/agent/quality-config.ts` — export `QUALITY_MODEL_MAP` for orchestration use
- `src/shared/types/orchestration.ts` — add `model` to task event types
- `src/renderer/src/components/composer/ComposerStatusBar.tsx` — quality tooltip
