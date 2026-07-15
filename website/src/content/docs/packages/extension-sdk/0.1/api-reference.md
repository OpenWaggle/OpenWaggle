---
title: "@openwaggle/extension-sdk API"
description: "Complete public API reference for @openwaggle/extension-sdk 0.1."
order: 90
section: "Packages"
---

<!-- Generated from the checked public package declarations. -->

This reference inventories every public entry point and named export in `@openwaggle/extension-sdk` 0.1.

Browser-safe extension schemas, manifest contracts, broker helpers, runtime types, themes, and framework-neutral UI helpers.

## `@openwaggle/extension-sdk`

Convenience entry point that re-exports the complete browser-safe extension author contract.

This export contains styles or re-exports the typed modules listed below.

## `@openwaggle/extension-sdk/agent-loop`

Typed DTOs and schemas for tool, interaction, transcript, custom-message, and run-status surfaces.

| Export | Kind |
|--------|------|
| `OpenWaggleAgentLoopSurfaceInput` | type |
| `openWaggleAgentLoopSurfaceInputSchema` | const |
| `OpenWaggleCustomMessageSurfaceInput` | interface |
| `openWaggleCustomMessageSurfaceInputSchema` | const |
| `OpenWaggleInteractionSurfaceInput` | interface |
| `openWaggleInteractionSurfaceInputSchema` | const |
| `OpenWaggleStatusSurfaceInput` | interface |
| `openWaggleStatusSurfaceInputSchema` | const |
| `OpenWaggleToolCallSurfaceInput` | interface |
| `openWaggleToolCallSurfaceInputSchema` | const |
| `OpenWaggleTranscriptSurfaceInput` | interface |
| `openWaggleTranscriptSurfaceInputSchema` | const |

## `@openwaggle/extension-sdk/broker`

Capability-broker request, response, scope, audit, and SDK helpers.

This export contains styles or re-exports the typed modules listed below.

## `@openwaggle/extension-sdk/constants`

Stable extension and broker protocol constants.

| Export | Kind |
|--------|------|
| `OPENWAGGLE_EXTENSION` | const |
| `OPENWAGGLE_EXTENSION_BROKER` | const |

## `@openwaggle/extension-sdk/context`

Federated-module mount context, surface SDK, and shared-module helpers.

| Export | Kind |
|--------|------|
| `createNoopExtensionSurfaceSdk` | function |
| `createOpenWaggleExtensionSharedModules` | function |
| `createOpenWaggleExtensionSurfaceContext` | function |
| `CreateOpenWaggleExtensionSurfaceContextInput` | interface |
| `OpenWaggleExtensionMountCleanup` | type |
| `OpenWaggleExtensionMountContext` | interface |
| `OpenWaggleExtensionMountResult` | type |
| `OpenWaggleExtensionSdk` | type |
| `OpenWaggleExtensionSharedModules` | interface |
| `OpenWaggleExtensionSurfaceContext` | interface |
| `OpenWaggleExtensionSurfaceSdk` | interface |
| `OpenWaggleFederatedModule` | interface |

## `@openwaggle/extension-sdk/docs`

Installed documentation discovery and topic contracts.

| Export | Kind |
|--------|------|
| `docsDiscoveryDiagnosticSchema` | const |
| `docsDiscoveryViewSchema` | const |
| `ExtensionDocsDiscoverPayload` | type |
| `extensionDocsDiscoverPayloadSchema` | const |
| `ExtensionDocsDiscoverResult` | type |
| `extensionDocsDiscoverResultSchema` | const |
| `ExtensionDocsDiscoveryView` | type |
| `extensionDocsPackageScopeViewSchema` | const |
| `extensionDocsProvenanceSchema` | const |
| `ExtensionDocsResolveTopicPayload` | type |
| `extensionDocsResolveTopicPayloadSchema` | const |
| `ExtensionDocsResolveTopicResult` | type |
| `extensionDocsResolveTopicResultSchema` | const |
| `extensionDocsTopicSummarySchema` | const |
| `FirstPartyDocsTopicSummary` | type |
| `firstPartyDocsTopicSummarySchema` | const |
| `firstPartyDocTopicSchema` | const |

## `@openwaggle/extension-sdk/json`

JSON-safe value types and runtime schemas.

| Export | Kind |
|--------|------|
| `JsonArray` | type |
| `JsonObject` | interface |
| `JsonPrimitive` | type |
| `jsonPrimitiveSchema` | const |
| `JsonValue` | type |
| `jsonValueSchema` | const |

## `@openwaggle/extension-sdk/manifest`

Extension manifest schemas, contribution declarations, and validation helpers.

This export contains styles or re-exports the typed modules listed below.

## `@openwaggle/extension-sdk/runtime`

Runtime contribution registration contracts and SDK helpers.

This export contains styles or re-exports the typed modules listed below.

## `@openwaggle/extension-sdk/theme`

Host-provided theme tokens and CSS variable helpers.

| Export | Kind |
|--------|------|
| `createOpenWaggleExtensionTheme` | function |
| `CreateOpenWaggleExtensionThemeOptions` | re-export |
| `extensionThemeCssVariableEntries` | function |
| `ExtensionThemeCssVariableResolver` | re-export |
| `isOpenWaggleExtensionTheme` | function |
| `OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES` | re-export |
| `OpenWaggleExtensionColorScheme` | re-export |
| `OpenWaggleExtensionTheme` | re-export |
| `OpenWaggleExtensionThemeCssVariableEntry` | re-export |
| `OpenWaggleExtensionThemeCssVariables` | re-export |
| `OpenWaggleExtensionThemeTokens` | re-export |

## `@openwaggle/extension-sdk/types`

Shared extension package, contribution, and registry contracts.

This export contains styles or re-exports the typed modules listed below.

## `@openwaggle/extension-sdk/ui`

Framework-neutral class names, attributes, and stylesheet generation.

| Export | Kind |
|--------|------|
| `createOpenWaggleExtensionUiStylesheet` | re-export |
| `CreateOpenWaggleExtensionUiStylesheetOptions` | re-export |
| `extensionThemeCssVariableDeclarations` | re-export |
| `OPENWAGGLE_EXTENSION_UI_ATTRIBUTES` | re-export |
| `OPENWAGGLE_EXTENSION_UI_CLASS_NAMES` | re-export |
| `openWaggleExtensionClassName` | function |
| `OpenWaggleExtensionClassNamePart` | type |
| `OpenWaggleExtensionUiButtonVariant` | re-export |
| `OpenWaggleExtensionUiTone` | re-export |
