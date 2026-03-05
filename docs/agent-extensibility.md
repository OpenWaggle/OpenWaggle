# Agent Extensibility Guide

This document describes how to add new agent capabilities in OpenWaggle without editing the core loop.

## Architecture

The agent runtime composes behavior from `AgentFeature` modules.

- Core orchestration: `src/main/agent/agent-loop.ts`
- Feature registry: `src/main/agent/feature-registry.ts`
- Prompt composition: `src/main/agent/prompt-pipeline.ts`
- Prompt fragments: `src/main/agent/system-prompt.ts`
- Lifecycle hook dispatch: `src/main/agent/lifecycle-hooks.ts`
- Stream chunk collection: `src/main/agent/stream-part-collector.ts`
- Tool aggregation: `src/main/tools/registry.ts`

## Extension Surface

Each feature can contribute one or more capabilities through `AgentFeature`:

- `getPromptFragments(context)` for system prompt sections
- `getTools(context)` for server tools
- `filterTools(tools, context)` for policy enforcement
- `getLifecycleHooks(context)` for observability or side effects
- `isEnabled(context)` for runtime gating

Types live in `src/main/agent/runtime-types.ts`.

## Prompt Pipeline

Prompt sections are `AgentPromptFragment` objects with:

- stable `id`
- numeric `order`
- `build(context)` returning a string or `null`

The builder sorts by `order` then `id` and joins sections with blank lines.

## Execution Mode Enforcement

Execution mode policy is enforced in two places:

1. Prompt constraints via `executionModePromptFragment`
2. Runtime tool filtering in execution-mode features

In `default-permissions` mode, approval-required tools stay available and are approval-gated at runtime. In `full-access` mode, approval requirements are stripped before the run starts.

## Observability

The `core.observability` feature logs structured lifecycle events with `runId` correlation:

- run start
- tool call start/end
- run error
- run complete with stage timings and prompt fragment IDs

Hook errors are fail-soft: they are logged and do not fail the run.

## Adding a New Feature

1. Create a feature object in `src/main/agent/feature-registry.ts` (or split into a new file and import it).
2. Give it a stable `id` and optional flag entry in `defaultFeatureFlags`.
3. Add prompt fragments, tools, filters, and hooks as needed.
4. Register it in `defaultFeatures`.
5. Add unit tests for:
   - prompt behavior (if fragment added)
   - tool inclusion/filtering (if tool behavior changed)
   - stream/lifecycle behavior (if hook logic added)

## Example (minimal)

```ts
const myFeature: AgentFeature = {
  id: 'custom.my-feature',
  isEnabled: (context) => context.hasProject,
  getPromptFragments: () => [
    {
      id: 'custom.my-feature.prompt',
      order: 90,
      build: () => 'Custom instruction for this feature.',
    },
  ],
}
```

Register in `defaultFeatures` to activate.
