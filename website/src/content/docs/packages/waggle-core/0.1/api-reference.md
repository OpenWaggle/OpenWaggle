---
title: "@openwaggle/waggle-core API"
description: "Complete public API reference for @openwaggle/waggle-core 0.1."
order: 90
section: "Packages"
---

<!-- Generated from the checked public package declarations. -->

This reference inventories every public entry point and named export in `@openwaggle/waggle-core` 0.1.

Runtime-neutral Waggle configuration, prompts, state, presets, consensus, events, and turn-policy contracts.

## `@openwaggle/waggle-core`

Convenience entry point for the complete runtime-neutral Waggle policy API.

This export contains styles or re-exports the typed modules listed below.

## `@openwaggle/waggle-core/config`

Configuration, validation, model, agent, and safety-limit contracts.

| Export | Kind |
|--------|------|
| `isProviderQualifiedWaggleModel` | function |
| `isWaggleInheritedModel` | function |
| `MAX_WAGGLE_MAX_TURNS_SAFETY` | const |
| `MIN_WAGGLE_MAX_TURNS_SAFETY` | const |
| `parseWaggleConfig` | function |
| `parseWagglePreset` | function |
| `WAGGLE_AGENT_COLORS` | const |
| `WAGGLE_COLLABORATION_MODES` | const |
| `WAGGLE_INHERIT_MODEL` | const |
| `WAGGLE_STOP_CONDITIONS` | const |
| `WaggleAgentColor` | type |
| `WaggleAgentSlot` | interface |
| `WaggleCollaborationMode` | type |
| `WaggleConfig` | interface |
| `WagglePreset` | interface |
| `WaggleStopCondition` | type |
| `WaggleStopConfig` | interface |
| `WaggleValidationResult` | type |

## `@openwaggle/waggle-core/consensus`

Consensus signals and convergence evaluation.

| Export | Kind |
|--------|------|
| `checkConsensus` | function |
| `evaluateConsensus` | function |
| `WaggleConsensusCheckResult` | interface |
| `WaggleConsensusSignal` | interface |

## `@openwaggle/waggle-core/events`

Runtime-neutral collaboration event metadata.

| Export | Kind |
|--------|------|
| `metadataForWaggleTurn` | function |
| `WaggleEngineEvent` | type |
| `WaggleTurnMetadata` | interface |

## `@openwaggle/waggle-core/presets`

Built-in preset definitions and preset composition.

| Export | Kind |
|--------|------|
| `BUILT_IN_WAGGLE_PRESETS` | const |
| `mergeWagglePresets` | function |

## `@openwaggle/waggle-core/prompts`

Prompt builders for collaborative turns.

| Export | Kind |
|--------|------|
| `buildWaggleTurnPrompt` | function |
| `BuildWaggleTurnPromptInput` | interface |

## `@openwaggle/waggle-core/state`

Serializable Waggle state helpers.

| Export | Kind |
|--------|------|
| `completeWaggleTurn` | function |
| `startWaggleRun` | function |
| `WaggleRunState` | interface |
| `WaggleRunStatus` | type |

## `@openwaggle/waggle-core/turn-policy`

Turn ownership, continuation, and stopping decisions.

| Export | Kind |
|--------|------|
| `decideNextWaggleTurn` | function |
| `getWaggleTurn` | function |
| `getWaggleTurnAgentIndex` | function |
| `WaggleStopReason` | type |
| `WaggleTurn` | interface |
| `WaggleTurnCompletion` | interface |
| `WaggleTurnDecision` | interface |
