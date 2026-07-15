---
title: "@openwaggle/pi-waggle API"
description: "Complete public API reference for @openwaggle/pi-waggle 0.1."
order: 90
section: "Packages"
---

<!-- Generated from the checked public package declarations. -->

This reference inventories every public entry point and named export in `@openwaggle/pi-waggle` 0.1.

Pi-native Waggle commands, extension lifecycle, loop integration, state, protocol, renderers, presets, and stop policies.

## `@openwaggle/pi-waggle`

Convenience entry point for Pi-native Waggle integration.

This export contains styles or re-exports the typed modules listed below.

## `@openwaggle/pi-waggle/commands`

Pi command parsing and intent contracts.

| Export | Kind |
|--------|------|
| `parsePiWaggleCommandArgs` | function |
| `PiWaggleCommandIntent` | type |

## `@openwaggle/pi-waggle/extension`

Default Pi extension entry point and advanced loop exports.

This export contains styles or re-exports the typed modules listed below.

## `@openwaggle/pi-waggle/loop`

Composable Pi agent-loop hooks and controllers.

| Export | Kind |
|--------|------|
| `createPiWaggleExtension` | function |
| `createPiWaggleLoopHandler` | function |
| `createPiWaggleTurnCompletionHandlers` | function |
| `createPiWaggleTurnEndHandler` | function |
| `PiWaggleAgentEndHandler` | type |
| `PiWaggleCustomMessage` | type |
| `PiWaggleExtensionApi` | interface |
| `PiWaggleExtensionContext` | interface |
| `PiWaggleExtensionController` | interface |
| `PiWaggleExtensionInput` | interface |
| `PiWaggleLoopApi` | interface |
| `PiWaggleLoopInput` | interface |
| `PiWaggleModel` | type |
| `PiWaggleResolveTurnModelInput` | interface |
| `PiWaggleSendMessageOptions` | type |
| `PiWaggleStartNextTurnInput` | interface |
| `PiWaggleTurnCompleteInput` | interface |
| `PiWaggleTurnCompletionHandlers` | interface |
| `PiWaggleTurnDecision` | interface |
| `PiWaggleTurnEndHandler` | type |
| `PiWaggleTurnMessageInput` | interface |
| `PiWaggleTurnMetadataInput` | interface |
| `registerPiWaggleLoop` | function |

## `@openwaggle/pi-waggle/mode-state`

Pi session-backed Waggle mode state.

| Export | Kind |
|--------|------|
| `appendPiWaggleModeState` | function |
| `disabledPiWaggleModeState` | function |
| `enabledPiWaggleModeState` | function |
| `latestPiWaggleModeStateFromBranch` | function |
| `latestPiWaggleModeStateFromEntries` | function |
| `PiWaggleModeStateReader` | interface |
| `PiWaggleModeStateWriter` | interface |

## `@openwaggle/pi-waggle/preset-storage`

Pi-backed custom preset persistence.

| Export | Kind |
|--------|------|
| `getPiWaggleProjectPresetsPath` | function |
| `getPiWaggleUserPresetsPath` | function |
| `PiWagglePresetsFileData` | interface |
| `readPiWagglePresetsFile` | function |
| `readPiWagglePresetsFileData` | function |
| `writePiWagglePresetsFile` | function |
| `writePiWagglePresetsFileData` | function |

## `@openwaggle/pi-waggle/presets`

Pi preset selection and resolution.

| Export | Kind |
|--------|------|
| `buildEditablePreset` | function |
| `deletePiWaggleCustomPreset` | function |
| `hiddenBuiltInPresetsForUi` | function |
| `loadPiWagglePresetLayers` | function |
| `mergePiWagglePresetLayers` | function |
| `PiWaggleEditablePresetScope` | type |
| `PiWaggleHiddenBuiltInPreset` | interface |
| `PiWagglePresetLayers` | interface |
| `PiWagglePresetScope` | type |
| `PiWaggleResolvedPreset` | interface |
| `presetScopeLabel` | function |
| `resolvedPresetsForUi` | function |
| `restorePiWaggleBuiltInPreset` | function |
| `savePiWagglePreset` | function |
| `suppressPiWaggleBuiltInPreset` | function |

## `@openwaggle/pi-waggle/protocol`

Pi custom-message names, schemas, and parsing helpers.

| Export | Kind |
|--------|------|
| `createPiWaggleModeState` | function |
| `createPiWaggleTurnDetails` | function |
| `parsePiWaggleModeState` | function |
| `parsePiWaggleTurnDetails` | function |
| `PI_WAGGLE_MODE_STATE_CUSTOM_TYPE` | const |
| `PI_WAGGLE_TURN_CUSTOM_TYPE` | const |
| `PI_WAGGLE_USER_REQUEST_CUSTOM_TYPE` | const |
| `PiWaggleModeState` | interface |
| `PiWaggleTurnDetails` | interface |

## `@openwaggle/pi-waggle/renderers`

Pi-native Waggle transcript renderers.

| Export | Kind |
|--------|------|
| `registerPiWaggleRenderers` | function |

## `@openwaggle/pi-waggle/stop-policy`

Pi stop-policy integration.

| Export | Kind |
|--------|------|
| `createPiWaggleStopPolicyState` | function |
| `evaluatePiWaggleStopPolicy` | function |
| `PiWaggleStopPolicyDecision` | interface |
| `PiWaggleStopPolicyState` | interface |
| `PiWaggleTurnSummary` | interface |
| `summarizePiWaggleTurnMessages` | function |
