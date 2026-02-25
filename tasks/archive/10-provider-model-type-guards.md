# Spec 10: Provider Model Literal Cast Removal

## Problem

Each provider's `createAdapter(model: string, ...)` receives a plain `string`, but TanStack AI SDK functions (`createAnthropicChat`, `createOpenaiChat`, etc.) require specific model literal union types. The codebase used `as` casts to bridge this gap, violating the project's "never type-cast" rule.

## Solution

1. Added a generic `includes<T extends string>(arr, value)` type predicate helper to `src/shared/utils/validation.ts` that uses `Set<string>.has()` (which accepts `string` without any cast) and narrows `value` to a member of the tuple's element type.

2. Replaced all provider model casts with runtime type guards that throw on invalid model IDs:
   - **Anthropic**: `model as (typeof ANTHROPIC_MODELS)[number]` -> `includes()` guard + narrowed call
   - **OpenAI**: `model as (typeof OPENAI_CHAT_MODELS)[number]` -> `includes()` guard + narrowed call
   - **Gemini**: `model as (typeof GeminiTextModels)[number]` -> `includes()` guard + narrowed call
   - **Grok**: `model as (typeof GROK_CHAT_MODELS)[number]` -> `includes()` guard + narrowed call
   - **OpenRouter**: `model as 'openrouter/auto' ... as unknown as AnyTextAdapter` -> `includes()` guard on curated UI models list + narrowed call (both casts removed)
   - **Ollama**: No change needed (accepts `TModel extends string`)

3. Updated `isProvider()` in `settings.ts` to use the new `includes()` helper, removing the `(PROVIDERS as readonly string[]).includes(value)` widening cast.

## OpenRouter Analysis

The OpenRouter provider had a double cast: `model as 'openrouter/auto'` to satisfy the model literal, then `as unknown as AnyTextAdapter` to coerce the return type. After the `includes(OPENROUTER_UI_MODELS, model)` guard narrows to `(typeof OPENROUTER_UI_MODELS)[number]`, each element is a literal string that's a member of `OpenRouterTextModels` (the 300+ model union from `@tanstack/ai-openrouter`). The return type `OpenRouterTextAdapter<T>` extends `BaseTextAdapter` which implements `TextAdapter`, making it assignable to `AnyTextAdapter = TextAdapter<any, any, any, any>`. Both casts were unnecessary.

## Verification

- [x] `pnpm typecheck` passes (node + web + packages)
- [x] `pnpm test:unit` passes (339 tests, 44 files)
- [x] `pnpm lint` clean (only pre-existing `service.ts` format issue)
- [x] No `as (typeof ...MODELS)` casts remain in `src/`

## Status: DONE (2026-02-24)
