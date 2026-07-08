# @openwaggle/extension-sdk

Package path: `packages/extension-sdk`

## Export `.`

Types: `dist/index.d.ts`

### Declarations from `dist/index.d.ts`

```ts
export type * from './agent-loop.js';
export type * from './broker.js';
export { createExtensionBrokerSdk, createExtensionBrokerSdkFromInvoke, toInvokeInput, } from './broker.js';
export { OPENWAGGLE_EXTENSION, OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
export type * from './context.js';
export { createNoopExtensionSurfaceSdk, createOpenWaggleExtensionSharedModules, createOpenWaggleExtensionSurfaceContext, } from './context.js';
export type { JsonArray, JsonObject, JsonPrimitive, JsonValue } from './json.js';
export type * from './manifest.js';
export type * from './theme.js';
export { createOpenWaggleExtensionTheme, extensionThemeCssVariableEntries, isOpenWaggleExtensionTheme, OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES, } from './theme.js';
export type * from './types.js';
export type * from './ui.js';
export { createOpenWaggleExtensionUiStylesheet, extensionThemeCssVariableDeclarations, OPENWAGGLE_EXTENSION_UI_ATTRIBUTES, OPENWAGGLE_EXTENSION_UI_CLASS_NAMES, openWaggleExtensionClassName, } from './ui.js';
```

### Declarations from `dist/agent-loop.d.ts`

```ts
import type { JsonValue } from './json.js';
export interface OpenWaggleToolCallSurfaceInput {
    readonly surface: 'tool';
    readonly toolCall: {
        readonly id: string;
        readonly name: string;
        readonly input?: JsonValue;
    };
    readonly toolResult?: {
        readonly ok: boolean;
        readonly output?: JsonValue;
        readonly error?: string;
    };
}
export interface OpenWaggleCustomMessageSurfaceInput {
    readonly surface: 'custom-message';
    readonly message: {
        readonly name: string;
        readonly payload?: JsonValue;
    };
}
export interface OpenWaggleInteractionSurfaceInput {
    readonly surface: 'interaction';
    readonly interaction: {
        readonly id: string;
        readonly customType: string;
        readonly payload?: JsonValue;
    };
}
export interface OpenWaggleTranscriptSurfaceInput {
    readonly surface: 'transcript';
    readonly transcript: {
        readonly sessionId?: string;
        readonly messageCount: number;
        readonly payload?: JsonValue;
    };
}
export interface OpenWaggleStatusSurfaceInput {
    readonly surface: 'status';
    readonly status: {
        readonly label: string;
        readonly payload?: JsonValue;
    };
}
export type OpenWaggleAgentLoopSurfaceInput = OpenWaggleToolCallSurfaceInput | OpenWaggleCustomMessageSurfaceInput | OpenWaggleInteractionSurfaceInput | OpenWaggleTranscriptSurfaceInput | OpenWaggleStatusSurfaceInput;
```

### Declarations from `dist/json.d.ts`

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
    [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];
```

### Declarations from `dist/broker.d.ts`

```ts
import type { CreateOpenWaggleSdkOptions, ExtensionBrokerSdk, ExtensionBrokerTransport, ExtensionSdkIdentity, ExtensionSdkInvoke, ExtensionSdkInvokeRequest } from './sdk-types.js';
import type { ExtensionInvokeInput } from './types.js';
export type * from './sdk-types.js';
export declare function toInvokeInput(identity: ExtensionSdkIdentity, request: ExtensionSdkInvokeRequest): ExtensionInvokeInput;
export declare function createExtensionBrokerSdkFromInvoke(invoke: ExtensionSdkInvoke, options?: CreateOpenWaggleSdkOptions): ExtensionBrokerSdk;
export declare function createExtensionBrokerSdk(transport: ExtensionBrokerTransport, identity: ExtensionSdkIdentity, options?: CreateOpenWaggleSdkOptions): ExtensionBrokerSdk;
```

### Declarations from `dist/sdk-types.d.ts`

```ts
import type { JsonValue } from './json.js';
import type { ExtensionActionSelectProjectResult, ExtensionDocsDiscoverPayload, ExtensionDocsDiscoverResult, ExtensionDocsResolveTopicPayload, ExtensionDocsResolveTopicResult, ExtensionInvokeFailure, ExtensionInvokeInput, ExtensionInvokeResult, ExtensionInvokeScope, ExtensionInvokeSuccess, ExtensionModelPreferencesSettingsPatch, ExtensionRuntimeRegisterContributionPayload, ExtensionRuntimeRegisterContributionResult, ExtensionRuntimeUnregisterContributionPayload, ExtensionRuntimeUnregisterContributionResult, ExtensionSettingsGetResult, ExtensionSettingsGetSettingResult, ExtensionSettingsUpdatePayload, ExtensionSettingsUpdateResult, ExtensionSettingsUpdateSettingResult, ExtensionStateCurrentBranchReadResult, ExtensionStateCurrentProjectReadResult, ExtensionStateCurrentSessionReadResult, ExtensionStateModelPreferencesReadResult, ExtensionStateReadResult, ExtensionStateRecentProjectsReadResult, ExtensionStorageDeleteResult, ExtensionStorageGetResult, ExtensionStorageListResult, ExtensionStorageSetResult } from './types.js';
export type ExtensionOperationSuccess<TValue> = ExtensionInvokeSuccess<TValue>;
export type ExtensionStorageGetOperationResult = ExtensionOperationSuccess<ExtensionStorageGetResult> | ExtensionInvokeFailure;
export type ExtensionStorageSetOperationResult = ExtensionOperationSuccess<ExtensionStorageSetResult> | ExtensionInvokeFailure;
export type ExtensionStorageDeleteOperationResult = ExtensionOperationSuccess<ExtensionStorageDeleteResult> | ExtensionInvokeFailure;
export type ExtensionStorageListOperationResult = ExtensionOperationSuccess<ExtensionStorageListResult> | ExtensionInvokeFailure;
export type ExtensionRuntimeRegisterContributionOperationResult = ExtensionOperationSuccess<ExtensionRuntimeRegisterContributionResult> | ExtensionInvokeFailure;
export type ExtensionRuntimeUnregisterContributionOperationResult = ExtensionOperationSuccess<ExtensionRuntimeUnregisterContributionResult> | ExtensionInvokeFailure;
export type ExtensionStateReadOperationResult = ExtensionOperationSuccess<ExtensionStateReadResult> | ExtensionInvokeFailure;
export type ExtensionStateCurrentProjectReadOperationResult = ExtensionOperationSuccess<ExtensionStateCurrentProjectReadResult> | ExtensionInvokeFailure;
export type ExtensionStateCurrentSessionReadOperationResult = ExtensionOperationSuccess<ExtensionStateCurrentSessionReadResult> | ExtensionInvokeFailure;
export type ExtensionStateCurrentBranchReadOperationResult = ExtensionOperationSuccess<ExtensionStateCurrentBranchReadResult> | ExtensionInvokeFailure;
export type ExtensionStateRecentProjectsReadOperationResult = ExtensionOperationSuccess<ExtensionStateRecentProjectsReadResult> | ExtensionInvokeFailure;
export type ExtensionStateModelPreferencesReadOperationResult = ExtensionOperationSuccess<ExtensionStateModelPreferencesReadResult> | ExtensionInvokeFailure;
export type ExtensionSelectProjectOperationResult = ExtensionOperationSuccess<ExtensionActionSelectProjectResult> | ExtensionInvokeFailure;
export type ExtensionDocsDiscoverOperationResult = ExtensionOperationSuccess<ExtensionDocsDiscoverResult> | ExtensionInvokeFailure;
export type ExtensionDocsResolveTopicOperationResult = ExtensionOperationSuccess<ExtensionDocsResolveTopicResult> | ExtensionInvokeFailure;
export type ExtensionSettingsGetOperationResult = ExtensionOperationSuccess<ExtensionSettingsGetResult> | ExtensionInvokeFailure;
export type ExtensionSettingsGetSettingOperationResult = ExtensionOperationSuccess<ExtensionSettingsGetSettingResult> | ExtensionInvokeFailure;
export type ExtensionSettingsUpdateOperationResult = ExtensionOperationSuccess<ExtensionSettingsUpdateResult> | ExtensionInvokeFailure;
export type ExtensionSettingsUpdateSettingOperationResult = ExtensionOperationSuccess<ExtensionSettingsUpdateSettingResult> | ExtensionInvokeFailure;
export interface ExtensionSdkIdentity {
    readonly extensionId: string;
    readonly contributionId: string;
}
export interface ExtensionSdkInvokeRequest {
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly payload?: unknown;
}
export type ExtensionBrokerTransport = (input: ExtensionInvokeInput) => Promise<ExtensionInvokeResult>;
export type ExtensionSdkInvoke = (request: ExtensionSdkInvokeRequest) => Promise<ExtensionInvokeResult>;
export interface ExtensionStorageScopeSdk {
    readonly get: (scope: ExtensionInvokeScope, key: string) => Promise<ExtensionInvokeResult<ExtensionStorageGetResult>>;
    readonly set: (scope: ExtensionInvokeScope, key: string, value: JsonValue) => Promise<ExtensionInvokeResult<ExtensionStorageSetResult>>;
    readonly delete: (scope: ExtensionInvokeScope, key: string) => Promise<ExtensionInvokeResult<ExtensionStorageDeleteResult>>;
    readonly list: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStorageListResult>>;
}
export interface ExtensionPackageStorageKindSdk {
    readonly global: ExtensionStorageScopeSdk;
    readonly project: ExtensionStorageScopeSdk;
}
export interface ExtensionPackageStorageSdk {
    readonly packageState: ExtensionPackageStorageKindSdk;
    readonly packageConfig: ExtensionPackageStorageKindSdk;
}
export interface ExtensionOpenWaggleStateSdk {
    readonly get: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStateReadResult>>;
    readonly readCurrentProject: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStateCurrentProjectReadResult>>;
    readonly readCurrentSession: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStateCurrentSessionReadResult>>;
    readonly readCurrentBranch: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStateCurrentBranchReadResult>>;
    readonly readRecentProjects: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStateRecentProjectsReadResult>>;
    readonly readModelPreferences: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStateModelPreferencesReadResult>>;
}
export interface ExtensionOpenWaggleSettingsSdk {
    readonly get: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionSettingsGetResult>>;
    readonly getModelPreferences: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionSettingsGetSettingResult>>;
    readonly updateModelPreferences: (scope: ExtensionInvokeScope, value: ExtensionModelPreferencesSettingsPatch) => Promise<ExtensionInvokeResult<ExtensionSettingsUpdateSettingResult>>;
    readonly getProjectDisplayName: (scope: ExtensionInvokeScope, projectPath: string) => Promise<ExtensionInvokeResult<ExtensionSettingsGetSettingResult>>;
    readonly setProjectDisplayName: (scope: ExtensionInvokeScope, projectPath: string, value: string | null) => Promise<ExtensionInvokeResult<ExtensionSettingsUpdateSettingResult>>;
    readonly update: (scope: ExtensionInvokeScope, settings: ExtensionSettingsUpdatePayload) => Promise<ExtensionInvokeResult<ExtensionSettingsUpdateResult>>;
}
export interface ExtensionOpenWaggleSdk {
    readonly state: ExtensionOpenWaggleStateSdk;
    readonly actions: {
        readonly selectProject: (scope: ExtensionInvokeScope, projectPath: string) => Promise<ExtensionInvokeResult<ExtensionActionSelectProjectResult>>;
        readonly openExternal: (url: string) => Promise<void>;
    };
    readonly settings: ExtensionOpenWaggleSettingsSdk;
    readonly docs: {
        readonly discover: (scope: ExtensionInvokeScope, input?: ExtensionDocsDiscoverPayload) => Promise<ExtensionInvokeResult<ExtensionDocsDiscoverResult>>;
        readonly resolveTopic: (scope: ExtensionInvokeScope, input: ExtensionDocsResolveTopicPayload) => Promise<ExtensionInvokeResult<ExtensionDocsResolveTopicResult>>;
    };
}
export interface ExtensionRuntimeContributionSdk {
    readonly registerContribution: (scope: ExtensionInvokeScope, registration: ExtensionRuntimeRegisterContributionPayload) => Promise<ExtensionInvokeResult<ExtensionRuntimeRegisterContributionResult>>;
    readonly unregisterContribution: (scope: ExtensionInvokeScope, unregistration: ExtensionRuntimeUnregisterContributionPayload) => Promise<ExtensionInvokeResult<ExtensionRuntimeUnregisterContributionResult>>;
}
export interface ExtensionBrokerSdk {
    readonly invoke: ExtensionSdkInvoke;
    readonly hostContext: {
        readonly getScope: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult>;
    };
    readonly storage: ExtensionPackageStorageSdk;
    readonly openWaggle: ExtensionOpenWaggleSdk;
    readonly runtime: ExtensionRuntimeContributionSdk;
}
export interface CreateOpenWaggleSdkOptions {
    readonly openExternal?: (url: string) => Promise<void>;
}
```

### Declarations from `dist/types.d.ts`

```ts
export type * from './contribution-types.js';
export type * from './core-types.js';
export type * from './openwaggle-types.js';
export type * from './registry-types.js';
export type * from './runtime-types.js';
export type * from './storage-types.js';
```

### Declarations from `dist/contribution-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION } from './constants.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionCapabilityScope = (typeof OPENWAGGLE_EXTENSION.CAPABILITY_SCOPES)[number];
export type ExtensionContributionFamily = ConstantValue<typeof OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY>;
export type ExtensionContributionRuntime = ConstantValue<typeof OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME>;
export type ExtensionExecutionPlacement = ConstantValue<typeof OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT>;
export type ExtensionInstallSource = ConstantValue<typeof OPENWAGGLE_EXTENSION.INSTALL_SOURCE>;
export type ExtensionNetworkAccessMode = ConstantValue<typeof OPENWAGGLE_EXTENSION.NETWORK_ACCESS_MODE>;
export interface ExtensionContributionTargetView {
    readonly projectPaths?: readonly string[];
    readonly sessionIds?: readonly string[];
}
export interface ExtensionContributionMatchView {
    readonly toolNames?: readonly string[];
    readonly customMessageNames?: readonly string[];
    readonly interactionKinds?: readonly string[];
}
export interface ExtensionContributionRegistration {
    readonly family: ExtensionContributionFamily;
    readonly contribution: {
        readonly id: string;
        readonly title: string;
        readonly label?: string;
        readonly category?: string;
        readonly capability?: string;
        readonly method?: string;
        readonly methods?: readonly string[];
        readonly declaredScopes?: readonly ExtensionCapabilityScope[];
        readonly networkOrigins?: readonly string[];
        readonly target?: ExtensionContributionTargetView;
        readonly matches?: ExtensionContributionMatchView;
        readonly runtime?: ExtensionContributionRuntime;
        readonly execution?: ExtensionExecutionPlacement;
        readonly entry?: string;
    };
}
export interface ExtensionContributionUnregistration {
    readonly family: ExtensionContributionFamily;
    readonly contributionId: string;
}
export type ExtensionRuntimeRegisterContributionPayload = ExtensionContributionRegistration;
export type ExtensionRuntimeUnregisterContributionPayload = ExtensionContributionUnregistration;
export {};
```

### Declarations from `dist/constants.d.ts`

```ts
export declare const OPENWAGGLE_EXTENSION_BROKER: {
    readonly CAPABILITY: {
        readonly HOST_CONTEXT: "openwaggle.host.context";
        readonly STORAGE: "openwaggle.storage";
        readonly STATE: "openwaggle.state";
        readonly ACTIONS: "openwaggle.actions";
        readonly SETTINGS: "openwaggle.settings";
        readonly DOCS: "openwaggle.docs";
        readonly RUNTIME: "openwaggle.runtime";
    };
    readonly CAPABILITIES: readonly ("openwaggle.host.context" | "openwaggle.storage" | "openwaggle.state" | "openwaggle.actions" | "openwaggle.settings" | "openwaggle.docs" | "openwaggle.runtime")[];
    readonly CAPABILITY_METHODS: readonly [{
        readonly capability: "openwaggle.host.context";
        readonly methods: readonly ["get-scope"];
    }, {
        readonly capability: "openwaggle.storage";
        readonly methods: readonly ["get", "set", "delete", "list"];
    }, {
        readonly capability: "openwaggle.state";
        readonly methods: readonly ["get-state", "read-state"];
    }, {
        readonly capability: "openwaggle.actions";
        readonly methods: readonly ["select-project"];
    }, {
        readonly capability: "openwaggle.settings";
        readonly methods: readonly ["get-settings", "update-settings", "get-setting", "update-setting"];
    }, {
        readonly capability: "openwaggle.docs";
        readonly methods: readonly ["discover-docs", "resolve-docs-topic"];
    }, {
        readonly capability: "openwaggle.runtime";
        readonly methods: readonly ["register-contribution", "unregister-contribution"];
    }];
    readonly METHOD: {
        readonly GET_SCOPE: "get-scope";
        readonly GET: "get";
        readonly SET: "set";
        readonly DELETE: "delete";
        readonly LIST: "list";
        readonly GET_STATE: "get-state";
        readonly READ_STATE: "read-state";
        readonly SELECT_PROJECT: "select-project";
        readonly GET_SETTINGS: "get-settings";
        readonly UPDATE_SETTINGS: "update-settings";
        readonly GET_SETTING: "get-setting";
        readonly UPDATE_SETTING: "update-setting";
        readonly DISCOVER_DOCS: "discover-docs";
        readonly RESOLVE_DOCS_TOPIC: "resolve-docs-topic";
        readonly REGISTER_CONTRIBUTION: "register-contribution";
        readonly UNREGISTER_CONTRIBUTION: "unregister-contribution";
    };
    readonly METHODS: readonly ("get-scope" | "get" | "set" | "delete" | "list" | "get-state" | "read-state" | "select-project" | "get-settings" | "update-settings" | "get-setting" | "update-setting" | "discover-docs" | "resolve-docs-topic" | "register-contribution" | "unregister-contribution")[];
    readonly FAILURE_CODE: {
        readonly INVALID_INPUT: "invalid-input";
        readonly INVALID_PAYLOAD: "invalid-payload";
        readonly UNKNOWN_EXTENSION: "unknown-extension";
        readonly DISABLED_EXTENSION: "disabled-extension";
        readonly UNKNOWN_CONTRIBUTION: "unknown-contribution";
        readonly UNDECLARED_CAPABILITY: "undeclared-capability";
        readonly UNDECLARED_METHOD: "undeclared-method";
        readonly UNDECLARED_SCOPE: "undeclared-scope";
        readonly OUT_OF_SCOPE: "out-of-scope";
        readonly UNSUPPORTED_CAPABILITY: "unsupported-capability";
        readonly UNSUPPORTED_METHOD: "unsupported-method";
        readonly TRANSPORT_FAILED: "transport-failed";
    };
    readonly FAILURE_CODES: readonly ("invalid-input" | "invalid-payload" | "unknown-extension" | "disabled-extension" | "unknown-contribution" | "undeclared-capability" | "undeclared-method" | "undeclared-scope" | "out-of-scope" | "unsupported-capability" | "unsupported-method" | "transport-failed")[];
    readonly OUTCOME: {
        readonly SUCCEEDED: "succeeded";
        readonly REJECTED: "rejected";
    };
    readonly OUTCOMES: readonly ("succeeded" | "rejected")[];
    readonly STATE_SELECTOR: {
        readonly CURRENT_PROJECT: "current-project";
        readonly CURRENT_SESSION: "current-session";
        readonly CURRENT_BRANCH: "current-branch";
        readonly RECENT_PROJECTS: "recent-projects";
        readonly MODEL_PREFERENCES: "model-preferences";
    };
    readonly STATE_SELECTORS: readonly ("current-project" | "current-session" | "current-branch" | "recent-projects" | "model-preferences")[];
    readonly SETTING_KEY: {
        readonly MODEL_PREFERENCES: "model-preferences";
        readonly PROJECT_DISPLAY_NAME: "project-display-name";
    };
    readonly SETTING_KEYS: readonly ("model-preferences" | "project-display-name")[];
};
export declare const OPENWAGGLE_EXTENSION: {
    readonly MANIFEST_FILE: "openwaggle.extension.json";
    readonly SDK_VERSION: "0.1.0";
    readonly PROJECT_ROOT_SEGMENTS: readonly [".openwaggle", "extensions"];
    readonly GLOBAL_EXTENSIONS_DIR: "extensions";
    readonly SCOPE: {
        readonly GLOBAL_KIND: "global";
        readonly PROJECT_KIND: "project";
        readonly GLOBAL_ID: "global";
    };
    readonly LIMITS: {
        readonly ID_MAX_LENGTH: 96;
        readonly CONTRIBUTION_ID_MAX_LENGTH: 128;
        readonly NAME_MAX_LENGTH: 120;
        readonly DESCRIPTION_MAX_LENGTH: 2000;
        readonly RELATIVE_PATH_MAX_LENGTH: 260;
        readonly NETWORK_ORIGIN_MAX_LENGTH: 300;
        readonly RUNTIME_REQUIREMENT_BINARY_MAX_LENGTH: 120;
        readonly BUILD_COMMAND_MAX_LENGTH: 500;
        readonly BUILD_LOG_MAX_LENGTH: 4000;
        readonly BUILD_COMMAND_TIMEOUT_MS: number;
    };
    readonly CAPABILITY_SCOPES: readonly ["app", "project", "session", "branch"];
    readonly CONTRIBUTION_FAMILY: {
        readonly COMMANDS: "commands";
        readonly SLASH_COMMANDS: "slashCommands";
        readonly ROUTES: "routes";
        readonly SETTINGS_SECTIONS: "settingsSections";
        readonly SIDE_PANELS: "sidePanels";
        readonly DIALOGS: "dialogs";
        readonly TRANSCRIPT_RENDERERS: "transcriptRenderers";
        readonly TOOL_RENDERERS: "toolRenderers";
        readonly CUSTOM_MESSAGE_RENDERERS: "customMessageRenderers";
        readonly INTERACTION_RENDERERS: "interactionRenderers";
        readonly STATUS_WIDGETS: "statusWidgets";
    };
    readonly CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands", "routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly COMMAND_CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands"];
    readonly CONTRIBUTION_RUNTIME: {
        readonly FEDERATED_MODULE: "federated-module";
        readonly TRUSTED_RENDERER: "trusted-renderer";
    };
    readonly CONTRIBUTION_RUNTIMES: readonly ("federated-module" | "trusted-renderer")[];
    readonly EXECUTION_PLACEMENT: {
        readonly HOST_RENDERER: "host-renderer";
        readonly FRAME: "frame";
    };
    readonly EXECUTION_PLACEMENTS: readonly ("host-renderer" | "frame")[];
    readonly STORAGE: {
        readonly KIND: {
            readonly STATE: "state";
            readonly CONFIG: "config";
        };
        readonly KINDS: readonly ("state" | "config")[];
        readonly SCOPE: {
            readonly GLOBAL_KIND: "global";
            readonly PROJECT_KIND: "project";
            readonly GLOBAL_ID: "global";
        };
        readonly SCOPE_KINDS: readonly ("global" | "project")[];
        readonly KEY_MAX_LENGTH: 160;
    };
    readonly ENTRY_CONTRIBUTION_FAMILIES: readonly ["routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly SLOT_CONTRIBUTION_FAMILIES: readonly ["settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly INSTALL_SOURCE: {
        readonly PREBUILT: "prebuilt";
        readonly LOCAL_BUILD: "local-build";
    };
    readonly INSTALL_SOURCES: readonly ("prebuilt" | "local-build")[];
    readonly RUNTIME_REQUIREMENT_TYPE: {
        readonly BINARY: "binary";
        readonly COMMAND: "command";
    };
    readonly RUNTIME_REQUIREMENT_TYPES: readonly ("binary" | "command")[];
    readonly NETWORK_ACCESS_MODE: {
        readonly BROKERED: "brokered";
        readonly RESTRICTED: "restricted";
        readonly DIRECT: "direct";
    };
    readonly NETWORK_ACCESS_MODES: readonly ("brokered" | "restricted" | "direct")[];
};
```

### Declarations from `dist/core-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionBrokerCapability = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY>;
export type ExtensionBrokerMethod = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.METHOD>;
export type ExtensionInvokeFailureCode = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE>;
export type ExtensionInvokeOutcome = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.OUTCOME>;
export type ExtensionStateSelector = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR>;
export type ExtensionSettingsKey = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY>;
export type ExtensionInvokeScope = {
    readonly kind: 'app';
} | {
    readonly kind: 'project';
    readonly projectPath: string;
} | {
    readonly kind: 'session';
    readonly projectPath: string;
    readonly sessionId: string;
} | {
    readonly kind: 'branch';
    readonly projectPath: string;
    readonly sessionId: string;
    readonly branchId: string;
};
export interface ExtensionCapabilityAuditEntry {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly outcome: ExtensionInvokeOutcome;
    readonly timestamp: number;
    readonly failureCode?: ExtensionInvokeFailureCode;
}
export interface ExtensionInvokeInput {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly payload?: unknown;
}
export interface ExtensionInvokeError {
    readonly code: ExtensionInvokeFailureCode;
    readonly message: string;
    readonly issues?: readonly string[];
}
export interface ExtensionInvokeSuccess<TValue = unknown> {
    readonly ok: true;
    readonly value: TValue;
    readonly audit: ExtensionCapabilityAuditEntry;
}
export interface ExtensionInvokeFailure {
    readonly ok: false;
    readonly error: ExtensionInvokeError;
    readonly audit?: ExtensionCapabilityAuditEntry;
}
export type ExtensionInvokeResult<TValue = unknown> = ExtensionInvokeSuccess<TValue> | ExtensionInvokeFailure;
export {};
```

### Declarations from `dist/openwaggle-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { ExtensionInvokeScope, ExtensionStateSelector } from './core-types.js';
export interface ExtensionModelPrefs {
    readonly selectedModel: string;
    readonly favoriteModels: readonly string[];
    readonly enabledModels: readonly string[];
    readonly thinkingLevel: string;
}
export interface ExtensionProjectView {
    readonly projectPath: string;
    readonly displayName: string | null;
    readonly active: boolean;
}
export interface ExtensionSessionView {
    readonly sessionId: string;
    readonly title: string;
    readonly projectPath: string | null;
}
export interface ExtensionBranchView {
    readonly branchId: string;
    readonly sessionId: string;
    readonly name: string;
    readonly main: boolean;
    readonly archived: boolean;
}
export interface ExtensionStateReadResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE;
    readonly scope: ExtensionInvokeScope;
    readonly activeProjectPath: string | null;
    readonly currentProject: ExtensionProjectView | null;
    readonly currentSession: ExtensionSessionView | null;
    readonly currentBranch: ExtensionBranchView | null;
    readonly recentProjects: readonly string[];
    readonly modelPreferences: ExtensionModelPrefs;
}
export interface ExtensionSelectedStateReadResult<TValue> {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE;
    readonly scope: ExtensionInvokeScope;
    readonly selector: ExtensionStateSelector;
    readonly value: TValue;
}
export type ExtensionStateCurrentProjectReadResult = ExtensionSelectedStateReadResult<ExtensionProjectView | null>;
export type ExtensionStateCurrentSessionReadResult = ExtensionSelectedStateReadResult<ExtensionSessionView | null>;
export type ExtensionStateCurrentBranchReadResult = ExtensionSelectedStateReadResult<ExtensionBranchView | null>;
export type ExtensionStateRecentProjectsReadResult = ExtensionSelectedStateReadResult<readonly string[]>;
export type ExtensionStateModelPreferencesReadResult = ExtensionSelectedStateReadResult<ExtensionModelPrefs>;
export interface ExtensionActionSelectProjectResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT;
    readonly previousProjectPath: string | null;
    readonly projectPath: string;
    readonly recentProjects: readonly string[];
}
export interface ExtensionSettingsView {
    readonly modelPreferences: ExtensionModelPrefs;
    readonly projectDisplayNames: Readonly<Record<string, string>>;
}
export interface ExtensionModelPreferencesSettingsPatch {
    readonly selectedModel?: string;
    readonly favoriteModels?: readonly string[];
    readonly enabledModels?: readonly string[];
    readonly thinkingLevel?: string;
}
export type ExtensionSettingsUpdatePayload = ExtensionModelPreferencesSettingsPatch & {
    readonly projectDisplayNames?: Readonly<Record<string, string>>;
};
export interface ExtensionSettingsGetResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS;
    readonly settings: ExtensionSettingsView;
}
export interface ExtensionSettingsUpdateResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS;
    readonly settings: ExtensionSettingsView;
}
export type ExtensionSettingsSelectedValue = {
    readonly key: typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES;
    readonly value: ExtensionModelPrefs;
} | {
    readonly key: typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME;
    readonly projectPath: string;
    readonly value: string | null;
};
export interface ExtensionSettingsGetSettingResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING;
    readonly setting: ExtensionSettingsSelectedValue;
}
export interface ExtensionSettingsUpdateSettingResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING;
    readonly setting: ExtensionSettingsSelectedValue;
}
export interface ExtensionDocsDiscoverPayload {
    readonly projectPaths?: readonly string[];
    readonly includeExtensions?: boolean;
}
export interface ExtensionDocsResolveTopicPayload {
    readonly topic: string;
}
export interface ExtensionDocsDiscoverResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS;
    readonly docs: unknown;
}
export interface ExtensionDocsResolveTopicResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC;
    readonly resolvedTopic: unknown;
}
```

### Declarations from `dist/registry-types.d.ts`

```ts
import type { ExtensionCapabilityScope, ExtensionContributionFamily, ExtensionContributionMatchView, ExtensionContributionRuntime, ExtensionContributionTargetView, ExtensionExecutionPlacement } from './contribution-types.js';
export type ExtensionPackageScopeKind = 'global' | 'project';
export interface ExtensionPackageScopeView {
    readonly kind: ExtensionPackageScopeKind;
    readonly label: string;
    readonly projectPath?: string;
}
export interface ExtensionContributionRegistryEntry {
    readonly extensionId: string;
    readonly extensionName: string;
    readonly extensionVersion: string;
    readonly scope: ExtensionPackageScopeView;
    readonly packagePath: string;
    readonly manifestPath: string;
    readonly contentHash: string;
    readonly projectPaths: readonly string[];
    readonly sessionId?: string;
    readonly appliesToAllRequestedProjects: boolean;
    readonly family: ExtensionContributionFamily;
    readonly contributionId: string;
    readonly title: string;
    readonly label: string;
    readonly category?: string;
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly declaredScopes?: readonly ExtensionCapabilityScope[];
    readonly networkOrigins?: readonly string[];
    readonly target?: ExtensionContributionTargetView;
    readonly matches?: ExtensionContributionMatchView;
    readonly runtime?: ExtensionContributionRuntime;
    readonly execution?: ExtensionExecutionPlacement;
    readonly entryPath?: string;
}
```

### Declarations from `dist/runtime-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { ExtensionContributionFamily } from './contribution-types.js';
export interface ExtensionRuntimeRegisterContributionResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION;
    readonly family: ExtensionContributionFamily;
    readonly registeredContributionId: string;
}
export interface ExtensionRuntimeUnregisterContributionResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION;
    readonly family: ExtensionContributionFamily;
    readonly unregisteredContributionId: string;
    readonly unregistered: boolean;
}
```

### Declarations from `dist/storage-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION, OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { JsonValue } from './json.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionStorageKind = ConstantValue<typeof OPENWAGGLE_EXTENSION.STORAGE.KIND>;
export type ExtensionStorageScopeSelector = (typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE_KINDS)[number];
export type ExtensionStorageScope = {
    readonly kind: typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND;
} | {
    readonly kind: typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND;
    readonly projectPath: string;
};
export interface ExtensionStorageResultBase {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE;
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
}
export interface ExtensionStorageGetResult extends ExtensionStorageResultBase {
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET;
    readonly key: string;
    readonly value: JsonValue | null;
}
export interface ExtensionStorageSetResult extends ExtensionStorageResultBase {
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.SET;
    readonly key: string;
    readonly value: JsonValue;
    readonly createdAt: number;
    readonly updatedAt: number;
}
export interface ExtensionStorageDeleteResult extends ExtensionStorageResultBase {
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE;
    readonly key: string;
    readonly deleted: true;
}
export interface ExtensionStorageListResult extends ExtensionStorageResultBase {
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST;
    readonly keys: readonly string[];
}
export {};
```

### Declarations from `dist/context.d.ts`

```ts
import type { ExtensionBrokerSdk } from './broker.js';
import type { JsonValue } from './json.js';
import { createOpenWaggleExtensionTheme, extensionThemeCssVariableEntries, type OpenWaggleExtensionTheme } from './theme.js';
import type { ExtensionContributionRegistryEntry } from './types.js';
import { createOpenWaggleExtensionUiStylesheet, OPENWAGGLE_EXTENSION_UI_ATTRIBUTES, OPENWAGGLE_EXTENSION_UI_CLASS_NAMES, openWaggleExtensionClassName } from './ui.js';
export interface OpenWaggleExtensionSurfaceContext {
    readonly extension: {
        readonly id: string;
        readonly name: string;
        readonly version: string;
    };
    readonly contribution: {
        readonly id: string;
        readonly title: string;
        readonly family: string;
    };
    readonly surface: {
        readonly family: string;
        readonly execution: string;
        readonly payload?: JsonValue;
    };
    readonly packagePath: string;
    readonly projectPaths: readonly string[];
    readonly theme: OpenWaggleExtensionTheme;
}
export interface OpenWaggleExtensionSurfaceSdk {
    readonly sendAction: (actionId: string, payload?: JsonValue) => Promise<void>;
    readonly respondInteraction: (value: JsonValue | null) => Promise<void>;
}
export type OpenWaggleExtensionSdk = ExtensionBrokerSdk & {
    readonly surface: OpenWaggleExtensionSurfaceSdk;
};
export interface OpenWaggleExtensionSharedModules {
    readonly sdk: {
        readonly openWaggleVersion: string;
    };
    readonly theme: {
        readonly current: OpenWaggleExtensionTheme;
        readonly createTheme: typeof createOpenWaggleExtensionTheme;
        readonly cssVariableEntries: typeof extensionThemeCssVariableEntries;
    };
    readonly ui: {
        readonly classNames: typeof OPENWAGGLE_EXTENSION_UI_CLASS_NAMES;
        readonly attributes: typeof OPENWAGGLE_EXTENSION_UI_ATTRIBUTES;
        readonly className: typeof openWaggleExtensionClassName;
        readonly createStylesheet: typeof createOpenWaggleExtensionUiStylesheet;
    };
}
export interface OpenWaggleExtensionMountContext extends OpenWaggleExtensionSurfaceContext {
    readonly root: HTMLElement;
    readonly sdk: OpenWaggleExtensionSdk;
    readonly modules: OpenWaggleExtensionSharedModules;
}
export type OpenWaggleExtensionMountCleanup = () => void;
export type OpenWaggleExtensionMountResult = undefined | OpenWaggleExtensionMountCleanup;
export interface OpenWaggleFederatedModule {
    readonly mount: (context: OpenWaggleExtensionMountContext) => OpenWaggleExtensionMountResult | Promise<OpenWaggleExtensionMountResult>;
}
export interface CreateOpenWaggleExtensionSurfaceContextInput {
    readonly entry: ExtensionContributionRegistryEntry;
    readonly surfacePayload?: JsonValue;
    readonly theme?: OpenWaggleExtensionTheme;
}
export declare function createNoopExtensionSurfaceSdk(): OpenWaggleExtensionSurfaceSdk;
export declare function createOpenWaggleExtensionSharedModules(theme?: OpenWaggleExtensionTheme): OpenWaggleExtensionSharedModules;
export declare function createOpenWaggleExtensionSurfaceContext(input: CreateOpenWaggleExtensionSurfaceContextInput): OpenWaggleExtensionSurfaceContext;
```

### Declarations from `dist/theme.d.ts`

```ts
import type { CreateOpenWaggleExtensionThemeOptions, OpenWaggleExtensionTheme, OpenWaggleExtensionThemeCssVariableEntry } from './theme-types.js';
export { OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES } from './theme-data.js';
export type { CreateOpenWaggleExtensionThemeOptions, ExtensionThemeCssVariableResolver, OpenWaggleExtensionColorScheme, OpenWaggleExtensionTheme, OpenWaggleExtensionThemeCssVariableEntry, OpenWaggleExtensionThemeCssVariables, OpenWaggleExtensionThemeTokens, } from './theme-types.js';
export declare function createOpenWaggleExtensionTheme(options?: CreateOpenWaggleExtensionThemeOptions): OpenWaggleExtensionTheme;
export declare function extensionThemeCssVariableEntries(theme: OpenWaggleExtensionTheme): readonly OpenWaggleExtensionThemeCssVariableEntry[];
export declare function isOpenWaggleExtensionTheme(value: unknown): value is OpenWaggleExtensionTheme;
```

### Declarations from `dist/theme-types.d.ts`

```ts
export type OpenWaggleExtensionColorScheme = 'dark';
export interface OpenWaggleExtensionThemeTokens {
    readonly color: {
        readonly background: string;
        readonly surface: string;
        readonly surfaceRaised: string;
        readonly surfaceHover: string;
        readonly surfaceActive: string;
        readonly border: string;
        readonly borderStrong: string;
        readonly text: string;
        readonly textSubtle: string;
        readonly textMuted: string;
        readonly textDim: string;
        readonly accent: string;
        readonly accentDim: string;
        readonly success: string;
        readonly danger: string;
        readonly warning: string;
        readonly info: string;
    };
    readonly typography: {
        readonly sansFamily: string;
        readonly monoFamily: string;
    };
    readonly spacing: {
        readonly xs: string;
        readonly sm: string;
        readonly md: string;
        readonly lg: string;
        readonly xl: string;
    };
    readonly radius: {
        readonly sm: string;
        readonly md: string;
        readonly lg: string;
        readonly panel: string;
    };
    readonly focus: {
        readonly ring: string;
        readonly shadow: string;
    };
    readonly elevation: {
        readonly card: string;
        readonly overlay: string;
    };
}
export type OpenWaggleExtensionThemeCssVariables = OpenWaggleExtensionThemeTokens;
export interface OpenWaggleExtensionTheme {
    readonly colorScheme: OpenWaggleExtensionColorScheme;
    readonly tokens: OpenWaggleExtensionThemeTokens;
    readonly cssVariables: OpenWaggleExtensionThemeCssVariables;
}
export interface OpenWaggleExtensionThemeCssVariableEntry {
    readonly name: string;
    readonly value: string;
}
export type ExtensionThemeCssVariableResolver = (cssVariable: string, fallback: string) => string;
export interface CreateOpenWaggleExtensionThemeOptions {
    readonly resolveCssVariable?: ExtensionThemeCssVariableResolver;
}
```

### Declarations from `dist/theme-data.d.ts`

```ts
export declare const OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES: {
    readonly color: {
        readonly background: "--ow-color-background";
        readonly surface: "--ow-color-surface";
        readonly surfaceRaised: "--ow-color-surface-raised";
        readonly surfaceHover: "--ow-color-surface-hover";
        readonly surfaceActive: "--ow-color-surface-active";
        readonly border: "--ow-color-border";
        readonly borderStrong: "--ow-color-border-strong";
        readonly text: "--ow-color-text";
        readonly textSubtle: "--ow-color-text-subtle";
        readonly textMuted: "--ow-color-text-muted";
        readonly textDim: "--ow-color-text-dim";
        readonly accent: "--ow-color-accent";
        readonly accentDim: "--ow-color-accent-dim";
        readonly success: "--ow-color-success";
        readonly danger: "--ow-color-danger";
        readonly warning: "--ow-color-warning";
        readonly info: "--ow-color-info";
    };
    readonly typography: {
        readonly sansFamily: "--ow-font-family-sans";
        readonly monoFamily: "--ow-font-family-mono";
    };
    readonly spacing: {
        readonly xs: "--ow-space-xs";
        readonly sm: "--ow-space-sm";
        readonly md: "--ow-space-md";
        readonly lg: "--ow-space-lg";
        readonly xl: "--ow-space-xl";
    };
    readonly radius: {
        readonly sm: "--ow-radius-sm";
        readonly md: "--ow-radius-md";
        readonly lg: "--ow-radius-lg";
        readonly panel: "--ow-radius-panel";
    };
    readonly focus: {
        readonly ring: "--ow-focus-ring";
        readonly shadow: "--ow-focus-shadow";
    };
    readonly elevation: {
        readonly card: "--ow-elevation-card";
        readonly overlay: "--ow-elevation-overlay";
    };
};
export declare const DEFAULT_EXTENSION_THEME_TOKENS: {
    readonly color: {
        readonly background: "#141619";
        readonly surface: "#1a1d22";
        readonly surfaceRaised: "#1f232a";
        readonly surfaceHover: "#262b33";
        readonly surfaceActive: "#1d1a10";
        readonly border: "#1e2229";
        readonly borderStrong: "#2a3240";
        readonly text: "#e7e9ee";
        readonly textSubtle: "#c9cdd6";
        readonly textMuted: "#9098a8";
        readonly textDim: "#666f7d";
        readonly accent: "#f5a623";
        readonly accentDim: "#b87410";
        readonly success: "#4caf72";
        readonly danger: "#ef4444";
        readonly warning: "#f5a623";
        readonly info: "#61a8ff";
    };
    readonly typography: {
        readonly sansFamily: "Inter, \"SF Pro Text\", \"SF Pro Display\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif";
        readonly monoFamily: "\"SF Mono\", \"JetBrains Mono\", \"Cascadia Mono\", ui-monospace, monospace";
    };
    readonly spacing: {
        readonly xs: "4px";
        readonly sm: "8px";
        readonly md: "12px";
        readonly lg: "16px";
        readonly xl: "24px";
    };
    readonly radius: {
        readonly sm: "6px";
        readonly md: "9px";
        readonly lg: "12px";
        readonly panel: "22px";
    };
    readonly focus: {
        readonly ring: "#9aa3b2";
        readonly shadow: "0 0 0 1px color-mix(in srgb, #9aa3b2 76%, transparent), 0 0 0 3px color-mix(in srgb, #9aa3b2 15%, transparent)";
    };
    readonly elevation: {
        readonly card: "inset 0 1px 0 rgba(255, 255, 255, 0.02)";
        readonly overlay: "0 24px 80px rgba(0, 0, 0, 0.45)";
    };
};
export declare const SOURCE_EXTENSION_THEME_CSS_VARIABLES: {
    readonly color: {
        readonly background: "--color-bg";
        readonly surface: "--color-bg-secondary";
        readonly surfaceRaised: "--color-bg-tertiary";
        readonly surfaceHover: "--color-bg-hover";
        readonly surfaceActive: "--color-bg-active";
        readonly border: "--color-border";
        readonly borderStrong: "--color-border-light";
        readonly text: "--color-text-primary";
        readonly textSubtle: "--color-text-secondary";
        readonly textMuted: "--color-text-tertiary";
        readonly textDim: "--color-text-muted";
        readonly accent: "--color-accent";
        readonly accentDim: "--color-accent-dim";
        readonly success: "--color-success";
        readonly danger: "--color-error";
        readonly warning: "--color-warning";
        readonly info: "--color-info";
    };
    readonly typography: {
        readonly sansFamily: "--font-sans";
        readonly monoFamily: "--font-mono";
    };
    readonly radius: {
        readonly panel: "--radius-panel";
    };
};
export declare const EXTENSION_THEME_COLOR_KEYS: readonly ["background", "surface", "surfaceRaised", "surfaceHover", "surfaceActive", "border", "borderStrong", "text", "textSubtle", "textMuted", "textDim", "accent", "accentDim", "success", "danger", "warning", "info"];
export declare const EXTENSION_THEME_TYPOGRAPHY_KEYS: readonly ["sansFamily", "monoFamily"];
export declare const EXTENSION_THEME_SPACING_KEYS: readonly ["xs", "sm", "md", "lg", "xl"];
export declare const EXTENSION_THEME_RADIUS_KEYS: readonly ["sm", "md", "lg", "panel"];
export declare const EXTENSION_THEME_FOCUS_KEYS: readonly ["ring", "shadow"];
export declare const EXTENSION_THEME_ELEVATION_KEYS: readonly ["card", "overlay"];
```

### Declarations from `dist/ui.d.ts`

```ts
export type { OpenWaggleExtensionUiButtonVariant, OpenWaggleExtensionUiTone, } from './ui-constants.js';
export { OPENWAGGLE_EXTENSION_UI_ATTRIBUTES, OPENWAGGLE_EXTENSION_UI_CLASS_NAMES, } from './ui-constants.js';
export type OpenWaggleExtensionClassNamePart = string | false | null | undefined;
export declare function openWaggleExtensionClassName(...parts: readonly OpenWaggleExtensionClassNamePart[]): string;
export type { CreateOpenWaggleExtensionUiStylesheetOptions } from './ui-stylesheet.js';
export { createOpenWaggleExtensionUiStylesheet, extensionThemeCssVariableDeclarations, } from './ui-stylesheet.js';
```

### Declarations from `dist/ui-constants.d.ts`

```ts
export declare const OPENWAGGLE_EXTENSION_UI_CLASS_NAMES: {
    readonly root: "ow-extension-root";
    readonly panel: "ow-extension-panel";
    readonly stack: "ow-extension-stack";
    readonly row: "ow-extension-row";
    readonly heading: "ow-extension-heading";
    readonly text: "ow-extension-text";
    readonly muted: "ow-extension-muted";
    readonly divider: "ow-extension-divider";
    readonly button: "ow-extension-button";
    readonly input: "ow-extension-input";
    readonly textarea: "ow-extension-textarea";
    readonly select: "ow-extension-select";
    readonly checkbox: "ow-extension-checkbox";
    readonly badge: "ow-extension-badge";
    readonly field: "ow-extension-field";
    readonly alert: "ow-extension-alert";
};
export declare const OPENWAGGLE_EXTENSION_UI_ATTRIBUTES: {
    readonly tone: "data-ow-tone";
    readonly variant: "data-ow-variant";
};
export type OpenWaggleExtensionUiTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
export type OpenWaggleExtensionUiButtonVariant = 'primary' | 'secondary' | 'ghost';
```

### Declarations from `dist/ui-stylesheet.d.ts`

```ts
import type { OpenWaggleExtensionTheme } from './theme-types.js';
export interface CreateOpenWaggleExtensionUiStylesheetOptions {
    readonly theme?: OpenWaggleExtensionTheme;
    readonly scopeSelector?: string;
    readonly includeThemeVariables?: boolean;
}
export declare function extensionThemeCssVariableDeclarations(theme?: OpenWaggleExtensionTheme): string;
export declare function createOpenWaggleExtensionUiStylesheet(options?: CreateOpenWaggleExtensionUiStylesheetOptions): string;
```

### Declarations from `dist/manifest.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION } from './constants.js';
import type { ExtensionCapabilityScope, ExtensionContributionRuntime, ExtensionExecutionPlacement, ExtensionInstallSource, ExtensionNetworkAccessMode } from './types.js';
export interface ExtensionCapabilityDeclaration {
    readonly id: string;
    readonly methods?: readonly string[];
    readonly scopes?: readonly ExtensionCapabilityScope[];
}
export interface ExtensionContributionBase {
    readonly id: string;
    readonly title: string;
    readonly label?: string;
    readonly category?: string;
    readonly target?: {
        readonly projectPaths?: readonly string[];
        readonly sessionIds?: readonly string[];
    };
    readonly matches?: {
        readonly toolNames?: readonly string[];
        readonly customMessageNames?: readonly string[];
        readonly interactionKinds?: readonly string[];
    };
}
export interface ExtensionCommandContribution extends ExtensionContributionBase {
    readonly capability?: string;
    readonly method?: string;
}
export interface ExtensionEntryContribution extends ExtensionContributionBase {
    readonly runtime: ExtensionContributionRuntime;
    readonly execution?: ExtensionExecutionPlacement;
    readonly entry: string;
}
export interface ExtensionContributions {
    readonly commands?: readonly ExtensionCommandContribution[];
    readonly slashCommands?: readonly ExtensionCommandContribution[];
    readonly routes?: readonly ExtensionEntryContribution[];
    readonly settingsSections?: readonly ExtensionEntryContribution[];
    readonly sidePanels?: readonly ExtensionEntryContribution[];
    readonly dialogs?: readonly ExtensionEntryContribution[];
    readonly transcriptRenderers?: readonly ExtensionEntryContribution[];
    readonly toolRenderers?: readonly ExtensionEntryContribution[];
    readonly customMessageRenderers?: readonly ExtensionEntryContribution[];
    readonly interactionRenderers?: readonly ExtensionEntryContribution[];
    readonly statusWidgets?: readonly ExtensionEntryContribution[];
}
export interface ExtensionRuntimeRequirementDeclaration {
    readonly id: string;
    readonly label: string;
    readonly kind?: 'binary' | 'command';
    readonly command?: string;
    readonly binary?: string;
}
export interface OpenWaggleExtensionManifest {
    readonly manifestVersion: 1;
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly description?: string;
    readonly sdk: {
        readonly openwaggle: string;
    };
    readonly sourceFiles: readonly string[];
    readonly builtArtifacts: readonly string[];
    readonly install?: {
        readonly source: ExtensionInstallSource;
    };
    readonly build?: {
        readonly command: string;
        readonly outputs?: readonly string[];
    };
    readonly docs?: {
        readonly topics?: readonly {
            readonly id: string;
            readonly title: string;
            readonly path: string;
            readonly description?: string;
            readonly aliases?: readonly string[];
            readonly keywords?: readonly string[];
        }[];
    };
    readonly network?: {
        readonly origins: readonly string[];
        readonly accessModes?: readonly ExtensionNetworkAccessMode[];
    };
    readonly capabilities?: readonly ExtensionCapabilityDeclaration[];
    readonly contributions?: ExtensionContributions;
    readonly pi?: {
        readonly resourceRoots?: readonly string[];
    };
    readonly trusted?: {
        readonly main?: string;
        readonly renderer?: string;
    };
    readonly runtimeRequirements?: readonly ExtensionRuntimeRequirementDeclaration[];
}
export type OpenWaggleExtensionManifestFile = typeof OPENWAGGLE_EXTENSION.MANIFEST_FILE;
```

## Export `./agent-loop`

Types: `dist/agent-loop.d.ts`

### Declarations from `dist/agent-loop.d.ts`

```ts
import type { JsonValue } from './json.js';
export interface OpenWaggleToolCallSurfaceInput {
    readonly surface: 'tool';
    readonly toolCall: {
        readonly id: string;
        readonly name: string;
        readonly input?: JsonValue;
    };
    readonly toolResult?: {
        readonly ok: boolean;
        readonly output?: JsonValue;
        readonly error?: string;
    };
}
export interface OpenWaggleCustomMessageSurfaceInput {
    readonly surface: 'custom-message';
    readonly message: {
        readonly name: string;
        readonly payload?: JsonValue;
    };
}
export interface OpenWaggleInteractionSurfaceInput {
    readonly surface: 'interaction';
    readonly interaction: {
        readonly id: string;
        readonly customType: string;
        readonly payload?: JsonValue;
    };
}
export interface OpenWaggleTranscriptSurfaceInput {
    readonly surface: 'transcript';
    readonly transcript: {
        readonly sessionId?: string;
        readonly messageCount: number;
        readonly payload?: JsonValue;
    };
}
export interface OpenWaggleStatusSurfaceInput {
    readonly surface: 'status';
    readonly status: {
        readonly label: string;
        readonly payload?: JsonValue;
    };
}
export type OpenWaggleAgentLoopSurfaceInput = OpenWaggleToolCallSurfaceInput | OpenWaggleCustomMessageSurfaceInput | OpenWaggleInteractionSurfaceInput | OpenWaggleTranscriptSurfaceInput | OpenWaggleStatusSurfaceInput;
```

### Declarations from `dist/json.d.ts`

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
    [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];
```

## Export `./broker`

Types: `dist/broker.d.ts`

### Declarations from `dist/broker.d.ts`

```ts
import type { CreateOpenWaggleSdkOptions, ExtensionBrokerSdk, ExtensionBrokerTransport, ExtensionSdkIdentity, ExtensionSdkInvoke, ExtensionSdkInvokeRequest } from './sdk-types.js';
import type { ExtensionInvokeInput } from './types.js';
export type * from './sdk-types.js';
export declare function toInvokeInput(identity: ExtensionSdkIdentity, request: ExtensionSdkInvokeRequest): ExtensionInvokeInput;
export declare function createExtensionBrokerSdkFromInvoke(invoke: ExtensionSdkInvoke, options?: CreateOpenWaggleSdkOptions): ExtensionBrokerSdk;
export declare function createExtensionBrokerSdk(transport: ExtensionBrokerTransport, identity: ExtensionSdkIdentity, options?: CreateOpenWaggleSdkOptions): ExtensionBrokerSdk;
```

### Declarations from `dist/sdk-types.d.ts`

```ts
import type { JsonValue } from './json.js';
import type { ExtensionActionSelectProjectResult, ExtensionDocsDiscoverPayload, ExtensionDocsDiscoverResult, ExtensionDocsResolveTopicPayload, ExtensionDocsResolveTopicResult, ExtensionInvokeFailure, ExtensionInvokeInput, ExtensionInvokeResult, ExtensionInvokeScope, ExtensionInvokeSuccess, ExtensionModelPreferencesSettingsPatch, ExtensionRuntimeRegisterContributionPayload, ExtensionRuntimeRegisterContributionResult, ExtensionRuntimeUnregisterContributionPayload, ExtensionRuntimeUnregisterContributionResult, ExtensionSettingsGetResult, ExtensionSettingsGetSettingResult, ExtensionSettingsUpdatePayload, ExtensionSettingsUpdateResult, ExtensionSettingsUpdateSettingResult, ExtensionStateCurrentBranchReadResult, ExtensionStateCurrentProjectReadResult, ExtensionStateCurrentSessionReadResult, ExtensionStateModelPreferencesReadResult, ExtensionStateReadResult, ExtensionStateRecentProjectsReadResult, ExtensionStorageDeleteResult, ExtensionStorageGetResult, ExtensionStorageListResult, ExtensionStorageSetResult } from './types.js';
export type ExtensionOperationSuccess<TValue> = ExtensionInvokeSuccess<TValue>;
export type ExtensionStorageGetOperationResult = ExtensionOperationSuccess<ExtensionStorageGetResult> | ExtensionInvokeFailure;
export type ExtensionStorageSetOperationResult = ExtensionOperationSuccess<ExtensionStorageSetResult> | ExtensionInvokeFailure;
export type ExtensionStorageDeleteOperationResult = ExtensionOperationSuccess<ExtensionStorageDeleteResult> | ExtensionInvokeFailure;
export type ExtensionStorageListOperationResult = ExtensionOperationSuccess<ExtensionStorageListResult> | ExtensionInvokeFailure;
export type ExtensionRuntimeRegisterContributionOperationResult = ExtensionOperationSuccess<ExtensionRuntimeRegisterContributionResult> | ExtensionInvokeFailure;
export type ExtensionRuntimeUnregisterContributionOperationResult = ExtensionOperationSuccess<ExtensionRuntimeUnregisterContributionResult> | ExtensionInvokeFailure;
export type ExtensionStateReadOperationResult = ExtensionOperationSuccess<ExtensionStateReadResult> | ExtensionInvokeFailure;
export type ExtensionStateCurrentProjectReadOperationResult = ExtensionOperationSuccess<ExtensionStateCurrentProjectReadResult> | ExtensionInvokeFailure;
export type ExtensionStateCurrentSessionReadOperationResult = ExtensionOperationSuccess<ExtensionStateCurrentSessionReadResult> | ExtensionInvokeFailure;
export type ExtensionStateCurrentBranchReadOperationResult = ExtensionOperationSuccess<ExtensionStateCurrentBranchReadResult> | ExtensionInvokeFailure;
export type ExtensionStateRecentProjectsReadOperationResult = ExtensionOperationSuccess<ExtensionStateRecentProjectsReadResult> | ExtensionInvokeFailure;
export type ExtensionStateModelPreferencesReadOperationResult = ExtensionOperationSuccess<ExtensionStateModelPreferencesReadResult> | ExtensionInvokeFailure;
export type ExtensionSelectProjectOperationResult = ExtensionOperationSuccess<ExtensionActionSelectProjectResult> | ExtensionInvokeFailure;
export type ExtensionDocsDiscoverOperationResult = ExtensionOperationSuccess<ExtensionDocsDiscoverResult> | ExtensionInvokeFailure;
export type ExtensionDocsResolveTopicOperationResult = ExtensionOperationSuccess<ExtensionDocsResolveTopicResult> | ExtensionInvokeFailure;
export type ExtensionSettingsGetOperationResult = ExtensionOperationSuccess<ExtensionSettingsGetResult> | ExtensionInvokeFailure;
export type ExtensionSettingsGetSettingOperationResult = ExtensionOperationSuccess<ExtensionSettingsGetSettingResult> | ExtensionInvokeFailure;
export type ExtensionSettingsUpdateOperationResult = ExtensionOperationSuccess<ExtensionSettingsUpdateResult> | ExtensionInvokeFailure;
export type ExtensionSettingsUpdateSettingOperationResult = ExtensionOperationSuccess<ExtensionSettingsUpdateSettingResult> | ExtensionInvokeFailure;
export interface ExtensionSdkIdentity {
    readonly extensionId: string;
    readonly contributionId: string;
}
export interface ExtensionSdkInvokeRequest {
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly payload?: unknown;
}
export type ExtensionBrokerTransport = (input: ExtensionInvokeInput) => Promise<ExtensionInvokeResult>;
export type ExtensionSdkInvoke = (request: ExtensionSdkInvokeRequest) => Promise<ExtensionInvokeResult>;
export interface ExtensionStorageScopeSdk {
    readonly get: (scope: ExtensionInvokeScope, key: string) => Promise<ExtensionInvokeResult<ExtensionStorageGetResult>>;
    readonly set: (scope: ExtensionInvokeScope, key: string, value: JsonValue) => Promise<ExtensionInvokeResult<ExtensionStorageSetResult>>;
    readonly delete: (scope: ExtensionInvokeScope, key: string) => Promise<ExtensionInvokeResult<ExtensionStorageDeleteResult>>;
    readonly list: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStorageListResult>>;
}
export interface ExtensionPackageStorageKindSdk {
    readonly global: ExtensionStorageScopeSdk;
    readonly project: ExtensionStorageScopeSdk;
}
export interface ExtensionPackageStorageSdk {
    readonly packageState: ExtensionPackageStorageKindSdk;
    readonly packageConfig: ExtensionPackageStorageKindSdk;
}
export interface ExtensionOpenWaggleStateSdk {
    readonly get: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStateReadResult>>;
    readonly readCurrentProject: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStateCurrentProjectReadResult>>;
    readonly readCurrentSession: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStateCurrentSessionReadResult>>;
    readonly readCurrentBranch: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStateCurrentBranchReadResult>>;
    readonly readRecentProjects: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStateRecentProjectsReadResult>>;
    readonly readModelPreferences: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStateModelPreferencesReadResult>>;
}
export interface ExtensionOpenWaggleSettingsSdk {
    readonly get: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionSettingsGetResult>>;
    readonly getModelPreferences: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionSettingsGetSettingResult>>;
    readonly updateModelPreferences: (scope: ExtensionInvokeScope, value: ExtensionModelPreferencesSettingsPatch) => Promise<ExtensionInvokeResult<ExtensionSettingsUpdateSettingResult>>;
    readonly getProjectDisplayName: (scope: ExtensionInvokeScope, projectPath: string) => Promise<ExtensionInvokeResult<ExtensionSettingsGetSettingResult>>;
    readonly setProjectDisplayName: (scope: ExtensionInvokeScope, projectPath: string, value: string | null) => Promise<ExtensionInvokeResult<ExtensionSettingsUpdateSettingResult>>;
    readonly update: (scope: ExtensionInvokeScope, settings: ExtensionSettingsUpdatePayload) => Promise<ExtensionInvokeResult<ExtensionSettingsUpdateResult>>;
}
export interface ExtensionOpenWaggleSdk {
    readonly state: ExtensionOpenWaggleStateSdk;
    readonly actions: {
        readonly selectProject: (scope: ExtensionInvokeScope, projectPath: string) => Promise<ExtensionInvokeResult<ExtensionActionSelectProjectResult>>;
        readonly openExternal: (url: string) => Promise<void>;
    };
    readonly settings: ExtensionOpenWaggleSettingsSdk;
    readonly docs: {
        readonly discover: (scope: ExtensionInvokeScope, input?: ExtensionDocsDiscoverPayload) => Promise<ExtensionInvokeResult<ExtensionDocsDiscoverResult>>;
        readonly resolveTopic: (scope: ExtensionInvokeScope, input: ExtensionDocsResolveTopicPayload) => Promise<ExtensionInvokeResult<ExtensionDocsResolveTopicResult>>;
    };
}
export interface ExtensionRuntimeContributionSdk {
    readonly registerContribution: (scope: ExtensionInvokeScope, registration: ExtensionRuntimeRegisterContributionPayload) => Promise<ExtensionInvokeResult<ExtensionRuntimeRegisterContributionResult>>;
    readonly unregisterContribution: (scope: ExtensionInvokeScope, unregistration: ExtensionRuntimeUnregisterContributionPayload) => Promise<ExtensionInvokeResult<ExtensionRuntimeUnregisterContributionResult>>;
}
export interface ExtensionBrokerSdk {
    readonly invoke: ExtensionSdkInvoke;
    readonly hostContext: {
        readonly getScope: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult>;
    };
    readonly storage: ExtensionPackageStorageSdk;
    readonly openWaggle: ExtensionOpenWaggleSdk;
    readonly runtime: ExtensionRuntimeContributionSdk;
}
export interface CreateOpenWaggleSdkOptions {
    readonly openExternal?: (url: string) => Promise<void>;
}
```

### Declarations from `dist/json.d.ts`

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
    [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];
```

### Declarations from `dist/types.d.ts`

```ts
export type * from './contribution-types.js';
export type * from './core-types.js';
export type * from './openwaggle-types.js';
export type * from './registry-types.js';
export type * from './runtime-types.js';
export type * from './storage-types.js';
```

### Declarations from `dist/contribution-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION } from './constants.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionCapabilityScope = (typeof OPENWAGGLE_EXTENSION.CAPABILITY_SCOPES)[number];
export type ExtensionContributionFamily = ConstantValue<typeof OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY>;
export type ExtensionContributionRuntime = ConstantValue<typeof OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME>;
export type ExtensionExecutionPlacement = ConstantValue<typeof OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT>;
export type ExtensionInstallSource = ConstantValue<typeof OPENWAGGLE_EXTENSION.INSTALL_SOURCE>;
export type ExtensionNetworkAccessMode = ConstantValue<typeof OPENWAGGLE_EXTENSION.NETWORK_ACCESS_MODE>;
export interface ExtensionContributionTargetView {
    readonly projectPaths?: readonly string[];
    readonly sessionIds?: readonly string[];
}
export interface ExtensionContributionMatchView {
    readonly toolNames?: readonly string[];
    readonly customMessageNames?: readonly string[];
    readonly interactionKinds?: readonly string[];
}
export interface ExtensionContributionRegistration {
    readonly family: ExtensionContributionFamily;
    readonly contribution: {
        readonly id: string;
        readonly title: string;
        readonly label?: string;
        readonly category?: string;
        readonly capability?: string;
        readonly method?: string;
        readonly methods?: readonly string[];
        readonly declaredScopes?: readonly ExtensionCapabilityScope[];
        readonly networkOrigins?: readonly string[];
        readonly target?: ExtensionContributionTargetView;
        readonly matches?: ExtensionContributionMatchView;
        readonly runtime?: ExtensionContributionRuntime;
        readonly execution?: ExtensionExecutionPlacement;
        readonly entry?: string;
    };
}
export interface ExtensionContributionUnregistration {
    readonly family: ExtensionContributionFamily;
    readonly contributionId: string;
}
export type ExtensionRuntimeRegisterContributionPayload = ExtensionContributionRegistration;
export type ExtensionRuntimeUnregisterContributionPayload = ExtensionContributionUnregistration;
export {};
```

### Declarations from `dist/constants.d.ts`

```ts
export declare const OPENWAGGLE_EXTENSION_BROKER: {
    readonly CAPABILITY: {
        readonly HOST_CONTEXT: "openwaggle.host.context";
        readonly STORAGE: "openwaggle.storage";
        readonly STATE: "openwaggle.state";
        readonly ACTIONS: "openwaggle.actions";
        readonly SETTINGS: "openwaggle.settings";
        readonly DOCS: "openwaggle.docs";
        readonly RUNTIME: "openwaggle.runtime";
    };
    readonly CAPABILITIES: readonly ("openwaggle.host.context" | "openwaggle.storage" | "openwaggle.state" | "openwaggle.actions" | "openwaggle.settings" | "openwaggle.docs" | "openwaggle.runtime")[];
    readonly CAPABILITY_METHODS: readonly [{
        readonly capability: "openwaggle.host.context";
        readonly methods: readonly ["get-scope"];
    }, {
        readonly capability: "openwaggle.storage";
        readonly methods: readonly ["get", "set", "delete", "list"];
    }, {
        readonly capability: "openwaggle.state";
        readonly methods: readonly ["get-state", "read-state"];
    }, {
        readonly capability: "openwaggle.actions";
        readonly methods: readonly ["select-project"];
    }, {
        readonly capability: "openwaggle.settings";
        readonly methods: readonly ["get-settings", "update-settings", "get-setting", "update-setting"];
    }, {
        readonly capability: "openwaggle.docs";
        readonly methods: readonly ["discover-docs", "resolve-docs-topic"];
    }, {
        readonly capability: "openwaggle.runtime";
        readonly methods: readonly ["register-contribution", "unregister-contribution"];
    }];
    readonly METHOD: {
        readonly GET_SCOPE: "get-scope";
        readonly GET: "get";
        readonly SET: "set";
        readonly DELETE: "delete";
        readonly LIST: "list";
        readonly GET_STATE: "get-state";
        readonly READ_STATE: "read-state";
        readonly SELECT_PROJECT: "select-project";
        readonly GET_SETTINGS: "get-settings";
        readonly UPDATE_SETTINGS: "update-settings";
        readonly GET_SETTING: "get-setting";
        readonly UPDATE_SETTING: "update-setting";
        readonly DISCOVER_DOCS: "discover-docs";
        readonly RESOLVE_DOCS_TOPIC: "resolve-docs-topic";
        readonly REGISTER_CONTRIBUTION: "register-contribution";
        readonly UNREGISTER_CONTRIBUTION: "unregister-contribution";
    };
    readonly METHODS: readonly ("get-scope" | "get" | "set" | "delete" | "list" | "get-state" | "read-state" | "select-project" | "get-settings" | "update-settings" | "get-setting" | "update-setting" | "discover-docs" | "resolve-docs-topic" | "register-contribution" | "unregister-contribution")[];
    readonly FAILURE_CODE: {
        readonly INVALID_INPUT: "invalid-input";
        readonly INVALID_PAYLOAD: "invalid-payload";
        readonly UNKNOWN_EXTENSION: "unknown-extension";
        readonly DISABLED_EXTENSION: "disabled-extension";
        readonly UNKNOWN_CONTRIBUTION: "unknown-contribution";
        readonly UNDECLARED_CAPABILITY: "undeclared-capability";
        readonly UNDECLARED_METHOD: "undeclared-method";
        readonly UNDECLARED_SCOPE: "undeclared-scope";
        readonly OUT_OF_SCOPE: "out-of-scope";
        readonly UNSUPPORTED_CAPABILITY: "unsupported-capability";
        readonly UNSUPPORTED_METHOD: "unsupported-method";
        readonly TRANSPORT_FAILED: "transport-failed";
    };
    readonly FAILURE_CODES: readonly ("invalid-input" | "invalid-payload" | "unknown-extension" | "disabled-extension" | "unknown-contribution" | "undeclared-capability" | "undeclared-method" | "undeclared-scope" | "out-of-scope" | "unsupported-capability" | "unsupported-method" | "transport-failed")[];
    readonly OUTCOME: {
        readonly SUCCEEDED: "succeeded";
        readonly REJECTED: "rejected";
    };
    readonly OUTCOMES: readonly ("succeeded" | "rejected")[];
    readonly STATE_SELECTOR: {
        readonly CURRENT_PROJECT: "current-project";
        readonly CURRENT_SESSION: "current-session";
        readonly CURRENT_BRANCH: "current-branch";
        readonly RECENT_PROJECTS: "recent-projects";
        readonly MODEL_PREFERENCES: "model-preferences";
    };
    readonly STATE_SELECTORS: readonly ("current-project" | "current-session" | "current-branch" | "recent-projects" | "model-preferences")[];
    readonly SETTING_KEY: {
        readonly MODEL_PREFERENCES: "model-preferences";
        readonly PROJECT_DISPLAY_NAME: "project-display-name";
    };
    readonly SETTING_KEYS: readonly ("model-preferences" | "project-display-name")[];
};
export declare const OPENWAGGLE_EXTENSION: {
    readonly MANIFEST_FILE: "openwaggle.extension.json";
    readonly SDK_VERSION: "0.1.0";
    readonly PROJECT_ROOT_SEGMENTS: readonly [".openwaggle", "extensions"];
    readonly GLOBAL_EXTENSIONS_DIR: "extensions";
    readonly SCOPE: {
        readonly GLOBAL_KIND: "global";
        readonly PROJECT_KIND: "project";
        readonly GLOBAL_ID: "global";
    };
    readonly LIMITS: {
        readonly ID_MAX_LENGTH: 96;
        readonly CONTRIBUTION_ID_MAX_LENGTH: 128;
        readonly NAME_MAX_LENGTH: 120;
        readonly DESCRIPTION_MAX_LENGTH: 2000;
        readonly RELATIVE_PATH_MAX_LENGTH: 260;
        readonly NETWORK_ORIGIN_MAX_LENGTH: 300;
        readonly RUNTIME_REQUIREMENT_BINARY_MAX_LENGTH: 120;
        readonly BUILD_COMMAND_MAX_LENGTH: 500;
        readonly BUILD_LOG_MAX_LENGTH: 4000;
        readonly BUILD_COMMAND_TIMEOUT_MS: number;
    };
    readonly CAPABILITY_SCOPES: readonly ["app", "project", "session", "branch"];
    readonly CONTRIBUTION_FAMILY: {
        readonly COMMANDS: "commands";
        readonly SLASH_COMMANDS: "slashCommands";
        readonly ROUTES: "routes";
        readonly SETTINGS_SECTIONS: "settingsSections";
        readonly SIDE_PANELS: "sidePanels";
        readonly DIALOGS: "dialogs";
        readonly TRANSCRIPT_RENDERERS: "transcriptRenderers";
        readonly TOOL_RENDERERS: "toolRenderers";
        readonly CUSTOM_MESSAGE_RENDERERS: "customMessageRenderers";
        readonly INTERACTION_RENDERERS: "interactionRenderers";
        readonly STATUS_WIDGETS: "statusWidgets";
    };
    readonly CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands", "routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly COMMAND_CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands"];
    readonly CONTRIBUTION_RUNTIME: {
        readonly FEDERATED_MODULE: "federated-module";
        readonly TRUSTED_RENDERER: "trusted-renderer";
    };
    readonly CONTRIBUTION_RUNTIMES: readonly ("federated-module" | "trusted-renderer")[];
    readonly EXECUTION_PLACEMENT: {
        readonly HOST_RENDERER: "host-renderer";
        readonly FRAME: "frame";
    };
    readonly EXECUTION_PLACEMENTS: readonly ("host-renderer" | "frame")[];
    readonly STORAGE: {
        readonly KIND: {
            readonly STATE: "state";
            readonly CONFIG: "config";
        };
        readonly KINDS: readonly ("state" | "config")[];
        readonly SCOPE: {
            readonly GLOBAL_KIND: "global";
            readonly PROJECT_KIND: "project";
            readonly GLOBAL_ID: "global";
        };
        readonly SCOPE_KINDS: readonly ("global" | "project")[];
        readonly KEY_MAX_LENGTH: 160;
    };
    readonly ENTRY_CONTRIBUTION_FAMILIES: readonly ["routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly SLOT_CONTRIBUTION_FAMILIES: readonly ["settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly INSTALL_SOURCE: {
        readonly PREBUILT: "prebuilt";
        readonly LOCAL_BUILD: "local-build";
    };
    readonly INSTALL_SOURCES: readonly ("prebuilt" | "local-build")[];
    readonly RUNTIME_REQUIREMENT_TYPE: {
        readonly BINARY: "binary";
        readonly COMMAND: "command";
    };
    readonly RUNTIME_REQUIREMENT_TYPES: readonly ("binary" | "command")[];
    readonly NETWORK_ACCESS_MODE: {
        readonly BROKERED: "brokered";
        readonly RESTRICTED: "restricted";
        readonly DIRECT: "direct";
    };
    readonly NETWORK_ACCESS_MODES: readonly ("brokered" | "restricted" | "direct")[];
};
```

### Declarations from `dist/core-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionBrokerCapability = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY>;
export type ExtensionBrokerMethod = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.METHOD>;
export type ExtensionInvokeFailureCode = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE>;
export type ExtensionInvokeOutcome = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.OUTCOME>;
export type ExtensionStateSelector = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR>;
export type ExtensionSettingsKey = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY>;
export type ExtensionInvokeScope = {
    readonly kind: 'app';
} | {
    readonly kind: 'project';
    readonly projectPath: string;
} | {
    readonly kind: 'session';
    readonly projectPath: string;
    readonly sessionId: string;
} | {
    readonly kind: 'branch';
    readonly projectPath: string;
    readonly sessionId: string;
    readonly branchId: string;
};
export interface ExtensionCapabilityAuditEntry {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly outcome: ExtensionInvokeOutcome;
    readonly timestamp: number;
    readonly failureCode?: ExtensionInvokeFailureCode;
}
export interface ExtensionInvokeInput {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly payload?: unknown;
}
export interface ExtensionInvokeError {
    readonly code: ExtensionInvokeFailureCode;
    readonly message: string;
    readonly issues?: readonly string[];
}
export interface ExtensionInvokeSuccess<TValue = unknown> {
    readonly ok: true;
    readonly value: TValue;
    readonly audit: ExtensionCapabilityAuditEntry;
}
export interface ExtensionInvokeFailure {
    readonly ok: false;
    readonly error: ExtensionInvokeError;
    readonly audit?: ExtensionCapabilityAuditEntry;
}
export type ExtensionInvokeResult<TValue = unknown> = ExtensionInvokeSuccess<TValue> | ExtensionInvokeFailure;
export {};
```

### Declarations from `dist/openwaggle-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { ExtensionInvokeScope, ExtensionStateSelector } from './core-types.js';
export interface ExtensionModelPrefs {
    readonly selectedModel: string;
    readonly favoriteModels: readonly string[];
    readonly enabledModels: readonly string[];
    readonly thinkingLevel: string;
}
export interface ExtensionProjectView {
    readonly projectPath: string;
    readonly displayName: string | null;
    readonly active: boolean;
}
export interface ExtensionSessionView {
    readonly sessionId: string;
    readonly title: string;
    readonly projectPath: string | null;
}
export interface ExtensionBranchView {
    readonly branchId: string;
    readonly sessionId: string;
    readonly name: string;
    readonly main: boolean;
    readonly archived: boolean;
}
export interface ExtensionStateReadResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE;
    readonly scope: ExtensionInvokeScope;
    readonly activeProjectPath: string | null;
    readonly currentProject: ExtensionProjectView | null;
    readonly currentSession: ExtensionSessionView | null;
    readonly currentBranch: ExtensionBranchView | null;
    readonly recentProjects: readonly string[];
    readonly modelPreferences: ExtensionModelPrefs;
}
export interface ExtensionSelectedStateReadResult<TValue> {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE;
    readonly scope: ExtensionInvokeScope;
    readonly selector: ExtensionStateSelector;
    readonly value: TValue;
}
export type ExtensionStateCurrentProjectReadResult = ExtensionSelectedStateReadResult<ExtensionProjectView | null>;
export type ExtensionStateCurrentSessionReadResult = ExtensionSelectedStateReadResult<ExtensionSessionView | null>;
export type ExtensionStateCurrentBranchReadResult = ExtensionSelectedStateReadResult<ExtensionBranchView | null>;
export type ExtensionStateRecentProjectsReadResult = ExtensionSelectedStateReadResult<readonly string[]>;
export type ExtensionStateModelPreferencesReadResult = ExtensionSelectedStateReadResult<ExtensionModelPrefs>;
export interface ExtensionActionSelectProjectResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT;
    readonly previousProjectPath: string | null;
    readonly projectPath: string;
    readonly recentProjects: readonly string[];
}
export interface ExtensionSettingsView {
    readonly modelPreferences: ExtensionModelPrefs;
    readonly projectDisplayNames: Readonly<Record<string, string>>;
}
export interface ExtensionModelPreferencesSettingsPatch {
    readonly selectedModel?: string;
    readonly favoriteModels?: readonly string[];
    readonly enabledModels?: readonly string[];
    readonly thinkingLevel?: string;
}
export type ExtensionSettingsUpdatePayload = ExtensionModelPreferencesSettingsPatch & {
    readonly projectDisplayNames?: Readonly<Record<string, string>>;
};
export interface ExtensionSettingsGetResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS;
    readonly settings: ExtensionSettingsView;
}
export interface ExtensionSettingsUpdateResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS;
    readonly settings: ExtensionSettingsView;
}
export type ExtensionSettingsSelectedValue = {
    readonly key: typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES;
    readonly value: ExtensionModelPrefs;
} | {
    readonly key: typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME;
    readonly projectPath: string;
    readonly value: string | null;
};
export interface ExtensionSettingsGetSettingResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING;
    readonly setting: ExtensionSettingsSelectedValue;
}
export interface ExtensionSettingsUpdateSettingResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING;
    readonly setting: ExtensionSettingsSelectedValue;
}
export interface ExtensionDocsDiscoverPayload {
    readonly projectPaths?: readonly string[];
    readonly includeExtensions?: boolean;
}
export interface ExtensionDocsResolveTopicPayload {
    readonly topic: string;
}
export interface ExtensionDocsDiscoverResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS;
    readonly docs: unknown;
}
export interface ExtensionDocsResolveTopicResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC;
    readonly resolvedTopic: unknown;
}
```

### Declarations from `dist/registry-types.d.ts`

```ts
import type { ExtensionCapabilityScope, ExtensionContributionFamily, ExtensionContributionMatchView, ExtensionContributionRuntime, ExtensionContributionTargetView, ExtensionExecutionPlacement } from './contribution-types.js';
export type ExtensionPackageScopeKind = 'global' | 'project';
export interface ExtensionPackageScopeView {
    readonly kind: ExtensionPackageScopeKind;
    readonly label: string;
    readonly projectPath?: string;
}
export interface ExtensionContributionRegistryEntry {
    readonly extensionId: string;
    readonly extensionName: string;
    readonly extensionVersion: string;
    readonly scope: ExtensionPackageScopeView;
    readonly packagePath: string;
    readonly manifestPath: string;
    readonly contentHash: string;
    readonly projectPaths: readonly string[];
    readonly sessionId?: string;
    readonly appliesToAllRequestedProjects: boolean;
    readonly family: ExtensionContributionFamily;
    readonly contributionId: string;
    readonly title: string;
    readonly label: string;
    readonly category?: string;
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly declaredScopes?: readonly ExtensionCapabilityScope[];
    readonly networkOrigins?: readonly string[];
    readonly target?: ExtensionContributionTargetView;
    readonly matches?: ExtensionContributionMatchView;
    readonly runtime?: ExtensionContributionRuntime;
    readonly execution?: ExtensionExecutionPlacement;
    readonly entryPath?: string;
}
```

### Declarations from `dist/runtime-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { ExtensionContributionFamily } from './contribution-types.js';
export interface ExtensionRuntimeRegisterContributionResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION;
    readonly family: ExtensionContributionFamily;
    readonly registeredContributionId: string;
}
export interface ExtensionRuntimeUnregisterContributionResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION;
    readonly family: ExtensionContributionFamily;
    readonly unregisteredContributionId: string;
    readonly unregistered: boolean;
}
```

### Declarations from `dist/storage-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION, OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { JsonValue } from './json.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionStorageKind = ConstantValue<typeof OPENWAGGLE_EXTENSION.STORAGE.KIND>;
export type ExtensionStorageScopeSelector = (typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE_KINDS)[number];
export type ExtensionStorageScope = {
    readonly kind: typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND;
} | {
    readonly kind: typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND;
    readonly projectPath: string;
};
export interface ExtensionStorageResultBase {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE;
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
}
export interface ExtensionStorageGetResult extends ExtensionStorageResultBase {
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET;
    readonly key: string;
    readonly value: JsonValue | null;
}
export interface ExtensionStorageSetResult extends ExtensionStorageResultBase {
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.SET;
    readonly key: string;
    readonly value: JsonValue;
    readonly createdAt: number;
    readonly updatedAt: number;
}
export interface ExtensionStorageDeleteResult extends ExtensionStorageResultBase {
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE;
    readonly key: string;
    readonly deleted: true;
}
export interface ExtensionStorageListResult extends ExtensionStorageResultBase {
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST;
    readonly keys: readonly string[];
}
export {};
```

## Export `./constants`

Types: `dist/constants.d.ts`

### Declarations from `dist/constants.d.ts`

```ts
export declare const OPENWAGGLE_EXTENSION_BROKER: {
    readonly CAPABILITY: {
        readonly HOST_CONTEXT: "openwaggle.host.context";
        readonly STORAGE: "openwaggle.storage";
        readonly STATE: "openwaggle.state";
        readonly ACTIONS: "openwaggle.actions";
        readonly SETTINGS: "openwaggle.settings";
        readonly DOCS: "openwaggle.docs";
        readonly RUNTIME: "openwaggle.runtime";
    };
    readonly CAPABILITIES: readonly ("openwaggle.host.context" | "openwaggle.storage" | "openwaggle.state" | "openwaggle.actions" | "openwaggle.settings" | "openwaggle.docs" | "openwaggle.runtime")[];
    readonly CAPABILITY_METHODS: readonly [{
        readonly capability: "openwaggle.host.context";
        readonly methods: readonly ["get-scope"];
    }, {
        readonly capability: "openwaggle.storage";
        readonly methods: readonly ["get", "set", "delete", "list"];
    }, {
        readonly capability: "openwaggle.state";
        readonly methods: readonly ["get-state", "read-state"];
    }, {
        readonly capability: "openwaggle.actions";
        readonly methods: readonly ["select-project"];
    }, {
        readonly capability: "openwaggle.settings";
        readonly methods: readonly ["get-settings", "update-settings", "get-setting", "update-setting"];
    }, {
        readonly capability: "openwaggle.docs";
        readonly methods: readonly ["discover-docs", "resolve-docs-topic"];
    }, {
        readonly capability: "openwaggle.runtime";
        readonly methods: readonly ["register-contribution", "unregister-contribution"];
    }];
    readonly METHOD: {
        readonly GET_SCOPE: "get-scope";
        readonly GET: "get";
        readonly SET: "set";
        readonly DELETE: "delete";
        readonly LIST: "list";
        readonly GET_STATE: "get-state";
        readonly READ_STATE: "read-state";
        readonly SELECT_PROJECT: "select-project";
        readonly GET_SETTINGS: "get-settings";
        readonly UPDATE_SETTINGS: "update-settings";
        readonly GET_SETTING: "get-setting";
        readonly UPDATE_SETTING: "update-setting";
        readonly DISCOVER_DOCS: "discover-docs";
        readonly RESOLVE_DOCS_TOPIC: "resolve-docs-topic";
        readonly REGISTER_CONTRIBUTION: "register-contribution";
        readonly UNREGISTER_CONTRIBUTION: "unregister-contribution";
    };
    readonly METHODS: readonly ("get-scope" | "get" | "set" | "delete" | "list" | "get-state" | "read-state" | "select-project" | "get-settings" | "update-settings" | "get-setting" | "update-setting" | "discover-docs" | "resolve-docs-topic" | "register-contribution" | "unregister-contribution")[];
    readonly FAILURE_CODE: {
        readonly INVALID_INPUT: "invalid-input";
        readonly INVALID_PAYLOAD: "invalid-payload";
        readonly UNKNOWN_EXTENSION: "unknown-extension";
        readonly DISABLED_EXTENSION: "disabled-extension";
        readonly UNKNOWN_CONTRIBUTION: "unknown-contribution";
        readonly UNDECLARED_CAPABILITY: "undeclared-capability";
        readonly UNDECLARED_METHOD: "undeclared-method";
        readonly UNDECLARED_SCOPE: "undeclared-scope";
        readonly OUT_OF_SCOPE: "out-of-scope";
        readonly UNSUPPORTED_CAPABILITY: "unsupported-capability";
        readonly UNSUPPORTED_METHOD: "unsupported-method";
        readonly TRANSPORT_FAILED: "transport-failed";
    };
    readonly FAILURE_CODES: readonly ("invalid-input" | "invalid-payload" | "unknown-extension" | "disabled-extension" | "unknown-contribution" | "undeclared-capability" | "undeclared-method" | "undeclared-scope" | "out-of-scope" | "unsupported-capability" | "unsupported-method" | "transport-failed")[];
    readonly OUTCOME: {
        readonly SUCCEEDED: "succeeded";
        readonly REJECTED: "rejected";
    };
    readonly OUTCOMES: readonly ("succeeded" | "rejected")[];
    readonly STATE_SELECTOR: {
        readonly CURRENT_PROJECT: "current-project";
        readonly CURRENT_SESSION: "current-session";
        readonly CURRENT_BRANCH: "current-branch";
        readonly RECENT_PROJECTS: "recent-projects";
        readonly MODEL_PREFERENCES: "model-preferences";
    };
    readonly STATE_SELECTORS: readonly ("current-project" | "current-session" | "current-branch" | "recent-projects" | "model-preferences")[];
    readonly SETTING_KEY: {
        readonly MODEL_PREFERENCES: "model-preferences";
        readonly PROJECT_DISPLAY_NAME: "project-display-name";
    };
    readonly SETTING_KEYS: readonly ("model-preferences" | "project-display-name")[];
};
export declare const OPENWAGGLE_EXTENSION: {
    readonly MANIFEST_FILE: "openwaggle.extension.json";
    readonly SDK_VERSION: "0.1.0";
    readonly PROJECT_ROOT_SEGMENTS: readonly [".openwaggle", "extensions"];
    readonly GLOBAL_EXTENSIONS_DIR: "extensions";
    readonly SCOPE: {
        readonly GLOBAL_KIND: "global";
        readonly PROJECT_KIND: "project";
        readonly GLOBAL_ID: "global";
    };
    readonly LIMITS: {
        readonly ID_MAX_LENGTH: 96;
        readonly CONTRIBUTION_ID_MAX_LENGTH: 128;
        readonly NAME_MAX_LENGTH: 120;
        readonly DESCRIPTION_MAX_LENGTH: 2000;
        readonly RELATIVE_PATH_MAX_LENGTH: 260;
        readonly NETWORK_ORIGIN_MAX_LENGTH: 300;
        readonly RUNTIME_REQUIREMENT_BINARY_MAX_LENGTH: 120;
        readonly BUILD_COMMAND_MAX_LENGTH: 500;
        readonly BUILD_LOG_MAX_LENGTH: 4000;
        readonly BUILD_COMMAND_TIMEOUT_MS: number;
    };
    readonly CAPABILITY_SCOPES: readonly ["app", "project", "session", "branch"];
    readonly CONTRIBUTION_FAMILY: {
        readonly COMMANDS: "commands";
        readonly SLASH_COMMANDS: "slashCommands";
        readonly ROUTES: "routes";
        readonly SETTINGS_SECTIONS: "settingsSections";
        readonly SIDE_PANELS: "sidePanels";
        readonly DIALOGS: "dialogs";
        readonly TRANSCRIPT_RENDERERS: "transcriptRenderers";
        readonly TOOL_RENDERERS: "toolRenderers";
        readonly CUSTOM_MESSAGE_RENDERERS: "customMessageRenderers";
        readonly INTERACTION_RENDERERS: "interactionRenderers";
        readonly STATUS_WIDGETS: "statusWidgets";
    };
    readonly CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands", "routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly COMMAND_CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands"];
    readonly CONTRIBUTION_RUNTIME: {
        readonly FEDERATED_MODULE: "federated-module";
        readonly TRUSTED_RENDERER: "trusted-renderer";
    };
    readonly CONTRIBUTION_RUNTIMES: readonly ("federated-module" | "trusted-renderer")[];
    readonly EXECUTION_PLACEMENT: {
        readonly HOST_RENDERER: "host-renderer";
        readonly FRAME: "frame";
    };
    readonly EXECUTION_PLACEMENTS: readonly ("host-renderer" | "frame")[];
    readonly STORAGE: {
        readonly KIND: {
            readonly STATE: "state";
            readonly CONFIG: "config";
        };
        readonly KINDS: readonly ("state" | "config")[];
        readonly SCOPE: {
            readonly GLOBAL_KIND: "global";
            readonly PROJECT_KIND: "project";
            readonly GLOBAL_ID: "global";
        };
        readonly SCOPE_KINDS: readonly ("global" | "project")[];
        readonly KEY_MAX_LENGTH: 160;
    };
    readonly ENTRY_CONTRIBUTION_FAMILIES: readonly ["routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly SLOT_CONTRIBUTION_FAMILIES: readonly ["settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly INSTALL_SOURCE: {
        readonly PREBUILT: "prebuilt";
        readonly LOCAL_BUILD: "local-build";
    };
    readonly INSTALL_SOURCES: readonly ("prebuilt" | "local-build")[];
    readonly RUNTIME_REQUIREMENT_TYPE: {
        readonly BINARY: "binary";
        readonly COMMAND: "command";
    };
    readonly RUNTIME_REQUIREMENT_TYPES: readonly ("binary" | "command")[];
    readonly NETWORK_ACCESS_MODE: {
        readonly BROKERED: "brokered";
        readonly RESTRICTED: "restricted";
        readonly DIRECT: "direct";
    };
    readonly NETWORK_ACCESS_MODES: readonly ("brokered" | "restricted" | "direct")[];
};
```

## Export `./context`

Types: `dist/context.d.ts`

### Declarations from `dist/context.d.ts`

```ts
import type { ExtensionBrokerSdk } from './broker.js';
import type { JsonValue } from './json.js';
import { createOpenWaggleExtensionTheme, extensionThemeCssVariableEntries, type OpenWaggleExtensionTheme } from './theme.js';
import type { ExtensionContributionRegistryEntry } from './types.js';
import { createOpenWaggleExtensionUiStylesheet, OPENWAGGLE_EXTENSION_UI_ATTRIBUTES, OPENWAGGLE_EXTENSION_UI_CLASS_NAMES, openWaggleExtensionClassName } from './ui.js';
export interface OpenWaggleExtensionSurfaceContext {
    readonly extension: {
        readonly id: string;
        readonly name: string;
        readonly version: string;
    };
    readonly contribution: {
        readonly id: string;
        readonly title: string;
        readonly family: string;
    };
    readonly surface: {
        readonly family: string;
        readonly execution: string;
        readonly payload?: JsonValue;
    };
    readonly packagePath: string;
    readonly projectPaths: readonly string[];
    readonly theme: OpenWaggleExtensionTheme;
}
export interface OpenWaggleExtensionSurfaceSdk {
    readonly sendAction: (actionId: string, payload?: JsonValue) => Promise<void>;
    readonly respondInteraction: (value: JsonValue | null) => Promise<void>;
}
export type OpenWaggleExtensionSdk = ExtensionBrokerSdk & {
    readonly surface: OpenWaggleExtensionSurfaceSdk;
};
export interface OpenWaggleExtensionSharedModules {
    readonly sdk: {
        readonly openWaggleVersion: string;
    };
    readonly theme: {
        readonly current: OpenWaggleExtensionTheme;
        readonly createTheme: typeof createOpenWaggleExtensionTheme;
        readonly cssVariableEntries: typeof extensionThemeCssVariableEntries;
    };
    readonly ui: {
        readonly classNames: typeof OPENWAGGLE_EXTENSION_UI_CLASS_NAMES;
        readonly attributes: typeof OPENWAGGLE_EXTENSION_UI_ATTRIBUTES;
        readonly className: typeof openWaggleExtensionClassName;
        readonly createStylesheet: typeof createOpenWaggleExtensionUiStylesheet;
    };
}
export interface OpenWaggleExtensionMountContext extends OpenWaggleExtensionSurfaceContext {
    readonly root: HTMLElement;
    readonly sdk: OpenWaggleExtensionSdk;
    readonly modules: OpenWaggleExtensionSharedModules;
}
export type OpenWaggleExtensionMountCleanup = () => void;
export type OpenWaggleExtensionMountResult = undefined | OpenWaggleExtensionMountCleanup;
export interface OpenWaggleFederatedModule {
    readonly mount: (context: OpenWaggleExtensionMountContext) => OpenWaggleExtensionMountResult | Promise<OpenWaggleExtensionMountResult>;
}
export interface CreateOpenWaggleExtensionSurfaceContextInput {
    readonly entry: ExtensionContributionRegistryEntry;
    readonly surfacePayload?: JsonValue;
    readonly theme?: OpenWaggleExtensionTheme;
}
export declare function createNoopExtensionSurfaceSdk(): OpenWaggleExtensionSurfaceSdk;
export declare function createOpenWaggleExtensionSharedModules(theme?: OpenWaggleExtensionTheme): OpenWaggleExtensionSharedModules;
export declare function createOpenWaggleExtensionSurfaceContext(input: CreateOpenWaggleExtensionSurfaceContextInput): OpenWaggleExtensionSurfaceContext;
```

### Declarations from `dist/broker.d.ts`

```ts
import type { CreateOpenWaggleSdkOptions, ExtensionBrokerSdk, ExtensionBrokerTransport, ExtensionSdkIdentity, ExtensionSdkInvoke, ExtensionSdkInvokeRequest } from './sdk-types.js';
import type { ExtensionInvokeInput } from './types.js';
export type * from './sdk-types.js';
export declare function toInvokeInput(identity: ExtensionSdkIdentity, request: ExtensionSdkInvokeRequest): ExtensionInvokeInput;
export declare function createExtensionBrokerSdkFromInvoke(invoke: ExtensionSdkInvoke, options?: CreateOpenWaggleSdkOptions): ExtensionBrokerSdk;
export declare function createExtensionBrokerSdk(transport: ExtensionBrokerTransport, identity: ExtensionSdkIdentity, options?: CreateOpenWaggleSdkOptions): ExtensionBrokerSdk;
```

### Declarations from `dist/sdk-types.d.ts`

```ts
import type { JsonValue } from './json.js';
import type { ExtensionActionSelectProjectResult, ExtensionDocsDiscoverPayload, ExtensionDocsDiscoverResult, ExtensionDocsResolveTopicPayload, ExtensionDocsResolveTopicResult, ExtensionInvokeFailure, ExtensionInvokeInput, ExtensionInvokeResult, ExtensionInvokeScope, ExtensionInvokeSuccess, ExtensionModelPreferencesSettingsPatch, ExtensionRuntimeRegisterContributionPayload, ExtensionRuntimeRegisterContributionResult, ExtensionRuntimeUnregisterContributionPayload, ExtensionRuntimeUnregisterContributionResult, ExtensionSettingsGetResult, ExtensionSettingsGetSettingResult, ExtensionSettingsUpdatePayload, ExtensionSettingsUpdateResult, ExtensionSettingsUpdateSettingResult, ExtensionStateCurrentBranchReadResult, ExtensionStateCurrentProjectReadResult, ExtensionStateCurrentSessionReadResult, ExtensionStateModelPreferencesReadResult, ExtensionStateReadResult, ExtensionStateRecentProjectsReadResult, ExtensionStorageDeleteResult, ExtensionStorageGetResult, ExtensionStorageListResult, ExtensionStorageSetResult } from './types.js';
export type ExtensionOperationSuccess<TValue> = ExtensionInvokeSuccess<TValue>;
export type ExtensionStorageGetOperationResult = ExtensionOperationSuccess<ExtensionStorageGetResult> | ExtensionInvokeFailure;
export type ExtensionStorageSetOperationResult = ExtensionOperationSuccess<ExtensionStorageSetResult> | ExtensionInvokeFailure;
export type ExtensionStorageDeleteOperationResult = ExtensionOperationSuccess<ExtensionStorageDeleteResult> | ExtensionInvokeFailure;
export type ExtensionStorageListOperationResult = ExtensionOperationSuccess<ExtensionStorageListResult> | ExtensionInvokeFailure;
export type ExtensionRuntimeRegisterContributionOperationResult = ExtensionOperationSuccess<ExtensionRuntimeRegisterContributionResult> | ExtensionInvokeFailure;
export type ExtensionRuntimeUnregisterContributionOperationResult = ExtensionOperationSuccess<ExtensionRuntimeUnregisterContributionResult> | ExtensionInvokeFailure;
export type ExtensionStateReadOperationResult = ExtensionOperationSuccess<ExtensionStateReadResult> | ExtensionInvokeFailure;
export type ExtensionStateCurrentProjectReadOperationResult = ExtensionOperationSuccess<ExtensionStateCurrentProjectReadResult> | ExtensionInvokeFailure;
export type ExtensionStateCurrentSessionReadOperationResult = ExtensionOperationSuccess<ExtensionStateCurrentSessionReadResult> | ExtensionInvokeFailure;
export type ExtensionStateCurrentBranchReadOperationResult = ExtensionOperationSuccess<ExtensionStateCurrentBranchReadResult> | ExtensionInvokeFailure;
export type ExtensionStateRecentProjectsReadOperationResult = ExtensionOperationSuccess<ExtensionStateRecentProjectsReadResult> | ExtensionInvokeFailure;
export type ExtensionStateModelPreferencesReadOperationResult = ExtensionOperationSuccess<ExtensionStateModelPreferencesReadResult> | ExtensionInvokeFailure;
export type ExtensionSelectProjectOperationResult = ExtensionOperationSuccess<ExtensionActionSelectProjectResult> | ExtensionInvokeFailure;
export type ExtensionDocsDiscoverOperationResult = ExtensionOperationSuccess<ExtensionDocsDiscoverResult> | ExtensionInvokeFailure;
export type ExtensionDocsResolveTopicOperationResult = ExtensionOperationSuccess<ExtensionDocsResolveTopicResult> | ExtensionInvokeFailure;
export type ExtensionSettingsGetOperationResult = ExtensionOperationSuccess<ExtensionSettingsGetResult> | ExtensionInvokeFailure;
export type ExtensionSettingsGetSettingOperationResult = ExtensionOperationSuccess<ExtensionSettingsGetSettingResult> | ExtensionInvokeFailure;
export type ExtensionSettingsUpdateOperationResult = ExtensionOperationSuccess<ExtensionSettingsUpdateResult> | ExtensionInvokeFailure;
export type ExtensionSettingsUpdateSettingOperationResult = ExtensionOperationSuccess<ExtensionSettingsUpdateSettingResult> | ExtensionInvokeFailure;
export interface ExtensionSdkIdentity {
    readonly extensionId: string;
    readonly contributionId: string;
}
export interface ExtensionSdkInvokeRequest {
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly payload?: unknown;
}
export type ExtensionBrokerTransport = (input: ExtensionInvokeInput) => Promise<ExtensionInvokeResult>;
export type ExtensionSdkInvoke = (request: ExtensionSdkInvokeRequest) => Promise<ExtensionInvokeResult>;
export interface ExtensionStorageScopeSdk {
    readonly get: (scope: ExtensionInvokeScope, key: string) => Promise<ExtensionInvokeResult<ExtensionStorageGetResult>>;
    readonly set: (scope: ExtensionInvokeScope, key: string, value: JsonValue) => Promise<ExtensionInvokeResult<ExtensionStorageSetResult>>;
    readonly delete: (scope: ExtensionInvokeScope, key: string) => Promise<ExtensionInvokeResult<ExtensionStorageDeleteResult>>;
    readonly list: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStorageListResult>>;
}
export interface ExtensionPackageStorageKindSdk {
    readonly global: ExtensionStorageScopeSdk;
    readonly project: ExtensionStorageScopeSdk;
}
export interface ExtensionPackageStorageSdk {
    readonly packageState: ExtensionPackageStorageKindSdk;
    readonly packageConfig: ExtensionPackageStorageKindSdk;
}
export interface ExtensionOpenWaggleStateSdk {
    readonly get: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStateReadResult>>;
    readonly readCurrentProject: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStateCurrentProjectReadResult>>;
    readonly readCurrentSession: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStateCurrentSessionReadResult>>;
    readonly readCurrentBranch: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStateCurrentBranchReadResult>>;
    readonly readRecentProjects: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStateRecentProjectsReadResult>>;
    readonly readModelPreferences: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionStateModelPreferencesReadResult>>;
}
export interface ExtensionOpenWaggleSettingsSdk {
    readonly get: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionSettingsGetResult>>;
    readonly getModelPreferences: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult<ExtensionSettingsGetSettingResult>>;
    readonly updateModelPreferences: (scope: ExtensionInvokeScope, value: ExtensionModelPreferencesSettingsPatch) => Promise<ExtensionInvokeResult<ExtensionSettingsUpdateSettingResult>>;
    readonly getProjectDisplayName: (scope: ExtensionInvokeScope, projectPath: string) => Promise<ExtensionInvokeResult<ExtensionSettingsGetSettingResult>>;
    readonly setProjectDisplayName: (scope: ExtensionInvokeScope, projectPath: string, value: string | null) => Promise<ExtensionInvokeResult<ExtensionSettingsUpdateSettingResult>>;
    readonly update: (scope: ExtensionInvokeScope, settings: ExtensionSettingsUpdatePayload) => Promise<ExtensionInvokeResult<ExtensionSettingsUpdateResult>>;
}
export interface ExtensionOpenWaggleSdk {
    readonly state: ExtensionOpenWaggleStateSdk;
    readonly actions: {
        readonly selectProject: (scope: ExtensionInvokeScope, projectPath: string) => Promise<ExtensionInvokeResult<ExtensionActionSelectProjectResult>>;
        readonly openExternal: (url: string) => Promise<void>;
    };
    readonly settings: ExtensionOpenWaggleSettingsSdk;
    readonly docs: {
        readonly discover: (scope: ExtensionInvokeScope, input?: ExtensionDocsDiscoverPayload) => Promise<ExtensionInvokeResult<ExtensionDocsDiscoverResult>>;
        readonly resolveTopic: (scope: ExtensionInvokeScope, input: ExtensionDocsResolveTopicPayload) => Promise<ExtensionInvokeResult<ExtensionDocsResolveTopicResult>>;
    };
}
export interface ExtensionRuntimeContributionSdk {
    readonly registerContribution: (scope: ExtensionInvokeScope, registration: ExtensionRuntimeRegisterContributionPayload) => Promise<ExtensionInvokeResult<ExtensionRuntimeRegisterContributionResult>>;
    readonly unregisterContribution: (scope: ExtensionInvokeScope, unregistration: ExtensionRuntimeUnregisterContributionPayload) => Promise<ExtensionInvokeResult<ExtensionRuntimeUnregisterContributionResult>>;
}
export interface ExtensionBrokerSdk {
    readonly invoke: ExtensionSdkInvoke;
    readonly hostContext: {
        readonly getScope: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult>;
    };
    readonly storage: ExtensionPackageStorageSdk;
    readonly openWaggle: ExtensionOpenWaggleSdk;
    readonly runtime: ExtensionRuntimeContributionSdk;
}
export interface CreateOpenWaggleSdkOptions {
    readonly openExternal?: (url: string) => Promise<void>;
}
```

### Declarations from `dist/json.d.ts`

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
    [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];
```

### Declarations from `dist/types.d.ts`

```ts
export type * from './contribution-types.js';
export type * from './core-types.js';
export type * from './openwaggle-types.js';
export type * from './registry-types.js';
export type * from './runtime-types.js';
export type * from './storage-types.js';
```

### Declarations from `dist/contribution-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION } from './constants.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionCapabilityScope = (typeof OPENWAGGLE_EXTENSION.CAPABILITY_SCOPES)[number];
export type ExtensionContributionFamily = ConstantValue<typeof OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY>;
export type ExtensionContributionRuntime = ConstantValue<typeof OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME>;
export type ExtensionExecutionPlacement = ConstantValue<typeof OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT>;
export type ExtensionInstallSource = ConstantValue<typeof OPENWAGGLE_EXTENSION.INSTALL_SOURCE>;
export type ExtensionNetworkAccessMode = ConstantValue<typeof OPENWAGGLE_EXTENSION.NETWORK_ACCESS_MODE>;
export interface ExtensionContributionTargetView {
    readonly projectPaths?: readonly string[];
    readonly sessionIds?: readonly string[];
}
export interface ExtensionContributionMatchView {
    readonly toolNames?: readonly string[];
    readonly customMessageNames?: readonly string[];
    readonly interactionKinds?: readonly string[];
}
export interface ExtensionContributionRegistration {
    readonly family: ExtensionContributionFamily;
    readonly contribution: {
        readonly id: string;
        readonly title: string;
        readonly label?: string;
        readonly category?: string;
        readonly capability?: string;
        readonly method?: string;
        readonly methods?: readonly string[];
        readonly declaredScopes?: readonly ExtensionCapabilityScope[];
        readonly networkOrigins?: readonly string[];
        readonly target?: ExtensionContributionTargetView;
        readonly matches?: ExtensionContributionMatchView;
        readonly runtime?: ExtensionContributionRuntime;
        readonly execution?: ExtensionExecutionPlacement;
        readonly entry?: string;
    };
}
export interface ExtensionContributionUnregistration {
    readonly family: ExtensionContributionFamily;
    readonly contributionId: string;
}
export type ExtensionRuntimeRegisterContributionPayload = ExtensionContributionRegistration;
export type ExtensionRuntimeUnregisterContributionPayload = ExtensionContributionUnregistration;
export {};
```

### Declarations from `dist/constants.d.ts`

```ts
export declare const OPENWAGGLE_EXTENSION_BROKER: {
    readonly CAPABILITY: {
        readonly HOST_CONTEXT: "openwaggle.host.context";
        readonly STORAGE: "openwaggle.storage";
        readonly STATE: "openwaggle.state";
        readonly ACTIONS: "openwaggle.actions";
        readonly SETTINGS: "openwaggle.settings";
        readonly DOCS: "openwaggle.docs";
        readonly RUNTIME: "openwaggle.runtime";
    };
    readonly CAPABILITIES: readonly ("openwaggle.host.context" | "openwaggle.storage" | "openwaggle.state" | "openwaggle.actions" | "openwaggle.settings" | "openwaggle.docs" | "openwaggle.runtime")[];
    readonly CAPABILITY_METHODS: readonly [{
        readonly capability: "openwaggle.host.context";
        readonly methods: readonly ["get-scope"];
    }, {
        readonly capability: "openwaggle.storage";
        readonly methods: readonly ["get", "set", "delete", "list"];
    }, {
        readonly capability: "openwaggle.state";
        readonly methods: readonly ["get-state", "read-state"];
    }, {
        readonly capability: "openwaggle.actions";
        readonly methods: readonly ["select-project"];
    }, {
        readonly capability: "openwaggle.settings";
        readonly methods: readonly ["get-settings", "update-settings", "get-setting", "update-setting"];
    }, {
        readonly capability: "openwaggle.docs";
        readonly methods: readonly ["discover-docs", "resolve-docs-topic"];
    }, {
        readonly capability: "openwaggle.runtime";
        readonly methods: readonly ["register-contribution", "unregister-contribution"];
    }];
    readonly METHOD: {
        readonly GET_SCOPE: "get-scope";
        readonly GET: "get";
        readonly SET: "set";
        readonly DELETE: "delete";
        readonly LIST: "list";
        readonly GET_STATE: "get-state";
        readonly READ_STATE: "read-state";
        readonly SELECT_PROJECT: "select-project";
        readonly GET_SETTINGS: "get-settings";
        readonly UPDATE_SETTINGS: "update-settings";
        readonly GET_SETTING: "get-setting";
        readonly UPDATE_SETTING: "update-setting";
        readonly DISCOVER_DOCS: "discover-docs";
        readonly RESOLVE_DOCS_TOPIC: "resolve-docs-topic";
        readonly REGISTER_CONTRIBUTION: "register-contribution";
        readonly UNREGISTER_CONTRIBUTION: "unregister-contribution";
    };
    readonly METHODS: readonly ("get-scope" | "get" | "set" | "delete" | "list" | "get-state" | "read-state" | "select-project" | "get-settings" | "update-settings" | "get-setting" | "update-setting" | "discover-docs" | "resolve-docs-topic" | "register-contribution" | "unregister-contribution")[];
    readonly FAILURE_CODE: {
        readonly INVALID_INPUT: "invalid-input";
        readonly INVALID_PAYLOAD: "invalid-payload";
        readonly UNKNOWN_EXTENSION: "unknown-extension";
        readonly DISABLED_EXTENSION: "disabled-extension";
        readonly UNKNOWN_CONTRIBUTION: "unknown-contribution";
        readonly UNDECLARED_CAPABILITY: "undeclared-capability";
        readonly UNDECLARED_METHOD: "undeclared-method";
        readonly UNDECLARED_SCOPE: "undeclared-scope";
        readonly OUT_OF_SCOPE: "out-of-scope";
        readonly UNSUPPORTED_CAPABILITY: "unsupported-capability";
        readonly UNSUPPORTED_METHOD: "unsupported-method";
        readonly TRANSPORT_FAILED: "transport-failed";
    };
    readonly FAILURE_CODES: readonly ("invalid-input" | "invalid-payload" | "unknown-extension" | "disabled-extension" | "unknown-contribution" | "undeclared-capability" | "undeclared-method" | "undeclared-scope" | "out-of-scope" | "unsupported-capability" | "unsupported-method" | "transport-failed")[];
    readonly OUTCOME: {
        readonly SUCCEEDED: "succeeded";
        readonly REJECTED: "rejected";
    };
    readonly OUTCOMES: readonly ("succeeded" | "rejected")[];
    readonly STATE_SELECTOR: {
        readonly CURRENT_PROJECT: "current-project";
        readonly CURRENT_SESSION: "current-session";
        readonly CURRENT_BRANCH: "current-branch";
        readonly RECENT_PROJECTS: "recent-projects";
        readonly MODEL_PREFERENCES: "model-preferences";
    };
    readonly STATE_SELECTORS: readonly ("current-project" | "current-session" | "current-branch" | "recent-projects" | "model-preferences")[];
    readonly SETTING_KEY: {
        readonly MODEL_PREFERENCES: "model-preferences";
        readonly PROJECT_DISPLAY_NAME: "project-display-name";
    };
    readonly SETTING_KEYS: readonly ("model-preferences" | "project-display-name")[];
};
export declare const OPENWAGGLE_EXTENSION: {
    readonly MANIFEST_FILE: "openwaggle.extension.json";
    readonly SDK_VERSION: "0.1.0";
    readonly PROJECT_ROOT_SEGMENTS: readonly [".openwaggle", "extensions"];
    readonly GLOBAL_EXTENSIONS_DIR: "extensions";
    readonly SCOPE: {
        readonly GLOBAL_KIND: "global";
        readonly PROJECT_KIND: "project";
        readonly GLOBAL_ID: "global";
    };
    readonly LIMITS: {
        readonly ID_MAX_LENGTH: 96;
        readonly CONTRIBUTION_ID_MAX_LENGTH: 128;
        readonly NAME_MAX_LENGTH: 120;
        readonly DESCRIPTION_MAX_LENGTH: 2000;
        readonly RELATIVE_PATH_MAX_LENGTH: 260;
        readonly NETWORK_ORIGIN_MAX_LENGTH: 300;
        readonly RUNTIME_REQUIREMENT_BINARY_MAX_LENGTH: 120;
        readonly BUILD_COMMAND_MAX_LENGTH: 500;
        readonly BUILD_LOG_MAX_LENGTH: 4000;
        readonly BUILD_COMMAND_TIMEOUT_MS: number;
    };
    readonly CAPABILITY_SCOPES: readonly ["app", "project", "session", "branch"];
    readonly CONTRIBUTION_FAMILY: {
        readonly COMMANDS: "commands";
        readonly SLASH_COMMANDS: "slashCommands";
        readonly ROUTES: "routes";
        readonly SETTINGS_SECTIONS: "settingsSections";
        readonly SIDE_PANELS: "sidePanels";
        readonly DIALOGS: "dialogs";
        readonly TRANSCRIPT_RENDERERS: "transcriptRenderers";
        readonly TOOL_RENDERERS: "toolRenderers";
        readonly CUSTOM_MESSAGE_RENDERERS: "customMessageRenderers";
        readonly INTERACTION_RENDERERS: "interactionRenderers";
        readonly STATUS_WIDGETS: "statusWidgets";
    };
    readonly CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands", "routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly COMMAND_CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands"];
    readonly CONTRIBUTION_RUNTIME: {
        readonly FEDERATED_MODULE: "federated-module";
        readonly TRUSTED_RENDERER: "trusted-renderer";
    };
    readonly CONTRIBUTION_RUNTIMES: readonly ("federated-module" | "trusted-renderer")[];
    readonly EXECUTION_PLACEMENT: {
        readonly HOST_RENDERER: "host-renderer";
        readonly FRAME: "frame";
    };
    readonly EXECUTION_PLACEMENTS: readonly ("host-renderer" | "frame")[];
    readonly STORAGE: {
        readonly KIND: {
            readonly STATE: "state";
            readonly CONFIG: "config";
        };
        readonly KINDS: readonly ("state" | "config")[];
        readonly SCOPE: {
            readonly GLOBAL_KIND: "global";
            readonly PROJECT_KIND: "project";
            readonly GLOBAL_ID: "global";
        };
        readonly SCOPE_KINDS: readonly ("global" | "project")[];
        readonly KEY_MAX_LENGTH: 160;
    };
    readonly ENTRY_CONTRIBUTION_FAMILIES: readonly ["routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly SLOT_CONTRIBUTION_FAMILIES: readonly ["settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly INSTALL_SOURCE: {
        readonly PREBUILT: "prebuilt";
        readonly LOCAL_BUILD: "local-build";
    };
    readonly INSTALL_SOURCES: readonly ("prebuilt" | "local-build")[];
    readonly RUNTIME_REQUIREMENT_TYPE: {
        readonly BINARY: "binary";
        readonly COMMAND: "command";
    };
    readonly RUNTIME_REQUIREMENT_TYPES: readonly ("binary" | "command")[];
    readonly NETWORK_ACCESS_MODE: {
        readonly BROKERED: "brokered";
        readonly RESTRICTED: "restricted";
        readonly DIRECT: "direct";
    };
    readonly NETWORK_ACCESS_MODES: readonly ("brokered" | "restricted" | "direct")[];
};
```

### Declarations from `dist/core-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionBrokerCapability = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY>;
export type ExtensionBrokerMethod = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.METHOD>;
export type ExtensionInvokeFailureCode = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE>;
export type ExtensionInvokeOutcome = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.OUTCOME>;
export type ExtensionStateSelector = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR>;
export type ExtensionSettingsKey = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY>;
export type ExtensionInvokeScope = {
    readonly kind: 'app';
} | {
    readonly kind: 'project';
    readonly projectPath: string;
} | {
    readonly kind: 'session';
    readonly projectPath: string;
    readonly sessionId: string;
} | {
    readonly kind: 'branch';
    readonly projectPath: string;
    readonly sessionId: string;
    readonly branchId: string;
};
export interface ExtensionCapabilityAuditEntry {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly outcome: ExtensionInvokeOutcome;
    readonly timestamp: number;
    readonly failureCode?: ExtensionInvokeFailureCode;
}
export interface ExtensionInvokeInput {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly payload?: unknown;
}
export interface ExtensionInvokeError {
    readonly code: ExtensionInvokeFailureCode;
    readonly message: string;
    readonly issues?: readonly string[];
}
export interface ExtensionInvokeSuccess<TValue = unknown> {
    readonly ok: true;
    readonly value: TValue;
    readonly audit: ExtensionCapabilityAuditEntry;
}
export interface ExtensionInvokeFailure {
    readonly ok: false;
    readonly error: ExtensionInvokeError;
    readonly audit?: ExtensionCapabilityAuditEntry;
}
export type ExtensionInvokeResult<TValue = unknown> = ExtensionInvokeSuccess<TValue> | ExtensionInvokeFailure;
export {};
```

### Declarations from `dist/openwaggle-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { ExtensionInvokeScope, ExtensionStateSelector } from './core-types.js';
export interface ExtensionModelPrefs {
    readonly selectedModel: string;
    readonly favoriteModels: readonly string[];
    readonly enabledModels: readonly string[];
    readonly thinkingLevel: string;
}
export interface ExtensionProjectView {
    readonly projectPath: string;
    readonly displayName: string | null;
    readonly active: boolean;
}
export interface ExtensionSessionView {
    readonly sessionId: string;
    readonly title: string;
    readonly projectPath: string | null;
}
export interface ExtensionBranchView {
    readonly branchId: string;
    readonly sessionId: string;
    readonly name: string;
    readonly main: boolean;
    readonly archived: boolean;
}
export interface ExtensionStateReadResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE;
    readonly scope: ExtensionInvokeScope;
    readonly activeProjectPath: string | null;
    readonly currentProject: ExtensionProjectView | null;
    readonly currentSession: ExtensionSessionView | null;
    readonly currentBranch: ExtensionBranchView | null;
    readonly recentProjects: readonly string[];
    readonly modelPreferences: ExtensionModelPrefs;
}
export interface ExtensionSelectedStateReadResult<TValue> {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE;
    readonly scope: ExtensionInvokeScope;
    readonly selector: ExtensionStateSelector;
    readonly value: TValue;
}
export type ExtensionStateCurrentProjectReadResult = ExtensionSelectedStateReadResult<ExtensionProjectView | null>;
export type ExtensionStateCurrentSessionReadResult = ExtensionSelectedStateReadResult<ExtensionSessionView | null>;
export type ExtensionStateCurrentBranchReadResult = ExtensionSelectedStateReadResult<ExtensionBranchView | null>;
export type ExtensionStateRecentProjectsReadResult = ExtensionSelectedStateReadResult<readonly string[]>;
export type ExtensionStateModelPreferencesReadResult = ExtensionSelectedStateReadResult<ExtensionModelPrefs>;
export interface ExtensionActionSelectProjectResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT;
    readonly previousProjectPath: string | null;
    readonly projectPath: string;
    readonly recentProjects: readonly string[];
}
export interface ExtensionSettingsView {
    readonly modelPreferences: ExtensionModelPrefs;
    readonly projectDisplayNames: Readonly<Record<string, string>>;
}
export interface ExtensionModelPreferencesSettingsPatch {
    readonly selectedModel?: string;
    readonly favoriteModels?: readonly string[];
    readonly enabledModels?: readonly string[];
    readonly thinkingLevel?: string;
}
export type ExtensionSettingsUpdatePayload = ExtensionModelPreferencesSettingsPatch & {
    readonly projectDisplayNames?: Readonly<Record<string, string>>;
};
export interface ExtensionSettingsGetResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS;
    readonly settings: ExtensionSettingsView;
}
export interface ExtensionSettingsUpdateResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS;
    readonly settings: ExtensionSettingsView;
}
export type ExtensionSettingsSelectedValue = {
    readonly key: typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES;
    readonly value: ExtensionModelPrefs;
} | {
    readonly key: typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME;
    readonly projectPath: string;
    readonly value: string | null;
};
export interface ExtensionSettingsGetSettingResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING;
    readonly setting: ExtensionSettingsSelectedValue;
}
export interface ExtensionSettingsUpdateSettingResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING;
    readonly setting: ExtensionSettingsSelectedValue;
}
export interface ExtensionDocsDiscoverPayload {
    readonly projectPaths?: readonly string[];
    readonly includeExtensions?: boolean;
}
export interface ExtensionDocsResolveTopicPayload {
    readonly topic: string;
}
export interface ExtensionDocsDiscoverResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS;
    readonly docs: unknown;
}
export interface ExtensionDocsResolveTopicResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC;
    readonly resolvedTopic: unknown;
}
```

### Declarations from `dist/registry-types.d.ts`

```ts
import type { ExtensionCapabilityScope, ExtensionContributionFamily, ExtensionContributionMatchView, ExtensionContributionRuntime, ExtensionContributionTargetView, ExtensionExecutionPlacement } from './contribution-types.js';
export type ExtensionPackageScopeKind = 'global' | 'project';
export interface ExtensionPackageScopeView {
    readonly kind: ExtensionPackageScopeKind;
    readonly label: string;
    readonly projectPath?: string;
}
export interface ExtensionContributionRegistryEntry {
    readonly extensionId: string;
    readonly extensionName: string;
    readonly extensionVersion: string;
    readonly scope: ExtensionPackageScopeView;
    readonly packagePath: string;
    readonly manifestPath: string;
    readonly contentHash: string;
    readonly projectPaths: readonly string[];
    readonly sessionId?: string;
    readonly appliesToAllRequestedProjects: boolean;
    readonly family: ExtensionContributionFamily;
    readonly contributionId: string;
    readonly title: string;
    readonly label: string;
    readonly category?: string;
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly declaredScopes?: readonly ExtensionCapabilityScope[];
    readonly networkOrigins?: readonly string[];
    readonly target?: ExtensionContributionTargetView;
    readonly matches?: ExtensionContributionMatchView;
    readonly runtime?: ExtensionContributionRuntime;
    readonly execution?: ExtensionExecutionPlacement;
    readonly entryPath?: string;
}
```

### Declarations from `dist/runtime-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { ExtensionContributionFamily } from './contribution-types.js';
export interface ExtensionRuntimeRegisterContributionResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION;
    readonly family: ExtensionContributionFamily;
    readonly registeredContributionId: string;
}
export interface ExtensionRuntimeUnregisterContributionResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION;
    readonly family: ExtensionContributionFamily;
    readonly unregisteredContributionId: string;
    readonly unregistered: boolean;
}
```

### Declarations from `dist/storage-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION, OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { JsonValue } from './json.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionStorageKind = ConstantValue<typeof OPENWAGGLE_EXTENSION.STORAGE.KIND>;
export type ExtensionStorageScopeSelector = (typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE_KINDS)[number];
export type ExtensionStorageScope = {
    readonly kind: typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND;
} | {
    readonly kind: typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND;
    readonly projectPath: string;
};
export interface ExtensionStorageResultBase {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE;
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
}
export interface ExtensionStorageGetResult extends ExtensionStorageResultBase {
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET;
    readonly key: string;
    readonly value: JsonValue | null;
}
export interface ExtensionStorageSetResult extends ExtensionStorageResultBase {
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.SET;
    readonly key: string;
    readonly value: JsonValue;
    readonly createdAt: number;
    readonly updatedAt: number;
}
export interface ExtensionStorageDeleteResult extends ExtensionStorageResultBase {
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE;
    readonly key: string;
    readonly deleted: true;
}
export interface ExtensionStorageListResult extends ExtensionStorageResultBase {
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST;
    readonly keys: readonly string[];
}
export {};
```

### Declarations from `dist/theme.d.ts`

```ts
import type { CreateOpenWaggleExtensionThemeOptions, OpenWaggleExtensionTheme, OpenWaggleExtensionThemeCssVariableEntry } from './theme-types.js';
export { OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES } from './theme-data.js';
export type { CreateOpenWaggleExtensionThemeOptions, ExtensionThemeCssVariableResolver, OpenWaggleExtensionColorScheme, OpenWaggleExtensionTheme, OpenWaggleExtensionThemeCssVariableEntry, OpenWaggleExtensionThemeCssVariables, OpenWaggleExtensionThemeTokens, } from './theme-types.js';
export declare function createOpenWaggleExtensionTheme(options?: CreateOpenWaggleExtensionThemeOptions): OpenWaggleExtensionTheme;
export declare function extensionThemeCssVariableEntries(theme: OpenWaggleExtensionTheme): readonly OpenWaggleExtensionThemeCssVariableEntry[];
export declare function isOpenWaggleExtensionTheme(value: unknown): value is OpenWaggleExtensionTheme;
```

### Declarations from `dist/theme-types.d.ts`

```ts
export type OpenWaggleExtensionColorScheme = 'dark';
export interface OpenWaggleExtensionThemeTokens {
    readonly color: {
        readonly background: string;
        readonly surface: string;
        readonly surfaceRaised: string;
        readonly surfaceHover: string;
        readonly surfaceActive: string;
        readonly border: string;
        readonly borderStrong: string;
        readonly text: string;
        readonly textSubtle: string;
        readonly textMuted: string;
        readonly textDim: string;
        readonly accent: string;
        readonly accentDim: string;
        readonly success: string;
        readonly danger: string;
        readonly warning: string;
        readonly info: string;
    };
    readonly typography: {
        readonly sansFamily: string;
        readonly monoFamily: string;
    };
    readonly spacing: {
        readonly xs: string;
        readonly sm: string;
        readonly md: string;
        readonly lg: string;
        readonly xl: string;
    };
    readonly radius: {
        readonly sm: string;
        readonly md: string;
        readonly lg: string;
        readonly panel: string;
    };
    readonly focus: {
        readonly ring: string;
        readonly shadow: string;
    };
    readonly elevation: {
        readonly card: string;
        readonly overlay: string;
    };
}
export type OpenWaggleExtensionThemeCssVariables = OpenWaggleExtensionThemeTokens;
export interface OpenWaggleExtensionTheme {
    readonly colorScheme: OpenWaggleExtensionColorScheme;
    readonly tokens: OpenWaggleExtensionThemeTokens;
    readonly cssVariables: OpenWaggleExtensionThemeCssVariables;
}
export interface OpenWaggleExtensionThemeCssVariableEntry {
    readonly name: string;
    readonly value: string;
}
export type ExtensionThemeCssVariableResolver = (cssVariable: string, fallback: string) => string;
export interface CreateOpenWaggleExtensionThemeOptions {
    readonly resolveCssVariable?: ExtensionThemeCssVariableResolver;
}
```

### Declarations from `dist/theme-data.d.ts`

```ts
export declare const OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES: {
    readonly color: {
        readonly background: "--ow-color-background";
        readonly surface: "--ow-color-surface";
        readonly surfaceRaised: "--ow-color-surface-raised";
        readonly surfaceHover: "--ow-color-surface-hover";
        readonly surfaceActive: "--ow-color-surface-active";
        readonly border: "--ow-color-border";
        readonly borderStrong: "--ow-color-border-strong";
        readonly text: "--ow-color-text";
        readonly textSubtle: "--ow-color-text-subtle";
        readonly textMuted: "--ow-color-text-muted";
        readonly textDim: "--ow-color-text-dim";
        readonly accent: "--ow-color-accent";
        readonly accentDim: "--ow-color-accent-dim";
        readonly success: "--ow-color-success";
        readonly danger: "--ow-color-danger";
        readonly warning: "--ow-color-warning";
        readonly info: "--ow-color-info";
    };
    readonly typography: {
        readonly sansFamily: "--ow-font-family-sans";
        readonly monoFamily: "--ow-font-family-mono";
    };
    readonly spacing: {
        readonly xs: "--ow-space-xs";
        readonly sm: "--ow-space-sm";
        readonly md: "--ow-space-md";
        readonly lg: "--ow-space-lg";
        readonly xl: "--ow-space-xl";
    };
    readonly radius: {
        readonly sm: "--ow-radius-sm";
        readonly md: "--ow-radius-md";
        readonly lg: "--ow-radius-lg";
        readonly panel: "--ow-radius-panel";
    };
    readonly focus: {
        readonly ring: "--ow-focus-ring";
        readonly shadow: "--ow-focus-shadow";
    };
    readonly elevation: {
        readonly card: "--ow-elevation-card";
        readonly overlay: "--ow-elevation-overlay";
    };
};
export declare const DEFAULT_EXTENSION_THEME_TOKENS: {
    readonly color: {
        readonly background: "#141619";
        readonly surface: "#1a1d22";
        readonly surfaceRaised: "#1f232a";
        readonly surfaceHover: "#262b33";
        readonly surfaceActive: "#1d1a10";
        readonly border: "#1e2229";
        readonly borderStrong: "#2a3240";
        readonly text: "#e7e9ee";
        readonly textSubtle: "#c9cdd6";
        readonly textMuted: "#9098a8";
        readonly textDim: "#666f7d";
        readonly accent: "#f5a623";
        readonly accentDim: "#b87410";
        readonly success: "#4caf72";
        readonly danger: "#ef4444";
        readonly warning: "#f5a623";
        readonly info: "#61a8ff";
    };
    readonly typography: {
        readonly sansFamily: "Inter, \"SF Pro Text\", \"SF Pro Display\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif";
        readonly monoFamily: "\"SF Mono\", \"JetBrains Mono\", \"Cascadia Mono\", ui-monospace, monospace";
    };
    readonly spacing: {
        readonly xs: "4px";
        readonly sm: "8px";
        readonly md: "12px";
        readonly lg: "16px";
        readonly xl: "24px";
    };
    readonly radius: {
        readonly sm: "6px";
        readonly md: "9px";
        readonly lg: "12px";
        readonly panel: "22px";
    };
    readonly focus: {
        readonly ring: "#9aa3b2";
        readonly shadow: "0 0 0 1px color-mix(in srgb, #9aa3b2 76%, transparent), 0 0 0 3px color-mix(in srgb, #9aa3b2 15%, transparent)";
    };
    readonly elevation: {
        readonly card: "inset 0 1px 0 rgba(255, 255, 255, 0.02)";
        readonly overlay: "0 24px 80px rgba(0, 0, 0, 0.45)";
    };
};
export declare const SOURCE_EXTENSION_THEME_CSS_VARIABLES: {
    readonly color: {
        readonly background: "--color-bg";
        readonly surface: "--color-bg-secondary";
        readonly surfaceRaised: "--color-bg-tertiary";
        readonly surfaceHover: "--color-bg-hover";
        readonly surfaceActive: "--color-bg-active";
        readonly border: "--color-border";
        readonly borderStrong: "--color-border-light";
        readonly text: "--color-text-primary";
        readonly textSubtle: "--color-text-secondary";
        readonly textMuted: "--color-text-tertiary";
        readonly textDim: "--color-text-muted";
        readonly accent: "--color-accent";
        readonly accentDim: "--color-accent-dim";
        readonly success: "--color-success";
        readonly danger: "--color-error";
        readonly warning: "--color-warning";
        readonly info: "--color-info";
    };
    readonly typography: {
        readonly sansFamily: "--font-sans";
        readonly monoFamily: "--font-mono";
    };
    readonly radius: {
        readonly panel: "--radius-panel";
    };
};
export declare const EXTENSION_THEME_COLOR_KEYS: readonly ["background", "surface", "surfaceRaised", "surfaceHover", "surfaceActive", "border", "borderStrong", "text", "textSubtle", "textMuted", "textDim", "accent", "accentDim", "success", "danger", "warning", "info"];
export declare const EXTENSION_THEME_TYPOGRAPHY_KEYS: readonly ["sansFamily", "monoFamily"];
export declare const EXTENSION_THEME_SPACING_KEYS: readonly ["xs", "sm", "md", "lg", "xl"];
export declare const EXTENSION_THEME_RADIUS_KEYS: readonly ["sm", "md", "lg", "panel"];
export declare const EXTENSION_THEME_FOCUS_KEYS: readonly ["ring", "shadow"];
export declare const EXTENSION_THEME_ELEVATION_KEYS: readonly ["card", "overlay"];
```

### Declarations from `dist/ui.d.ts`

```ts
export type { OpenWaggleExtensionUiButtonVariant, OpenWaggleExtensionUiTone, } from './ui-constants.js';
export { OPENWAGGLE_EXTENSION_UI_ATTRIBUTES, OPENWAGGLE_EXTENSION_UI_CLASS_NAMES, } from './ui-constants.js';
export type OpenWaggleExtensionClassNamePart = string | false | null | undefined;
export declare function openWaggleExtensionClassName(...parts: readonly OpenWaggleExtensionClassNamePart[]): string;
export type { CreateOpenWaggleExtensionUiStylesheetOptions } from './ui-stylesheet.js';
export { createOpenWaggleExtensionUiStylesheet, extensionThemeCssVariableDeclarations, } from './ui-stylesheet.js';
```

### Declarations from `dist/ui-constants.d.ts`

```ts
export declare const OPENWAGGLE_EXTENSION_UI_CLASS_NAMES: {
    readonly root: "ow-extension-root";
    readonly panel: "ow-extension-panel";
    readonly stack: "ow-extension-stack";
    readonly row: "ow-extension-row";
    readonly heading: "ow-extension-heading";
    readonly text: "ow-extension-text";
    readonly muted: "ow-extension-muted";
    readonly divider: "ow-extension-divider";
    readonly button: "ow-extension-button";
    readonly input: "ow-extension-input";
    readonly textarea: "ow-extension-textarea";
    readonly select: "ow-extension-select";
    readonly checkbox: "ow-extension-checkbox";
    readonly badge: "ow-extension-badge";
    readonly field: "ow-extension-field";
    readonly alert: "ow-extension-alert";
};
export declare const OPENWAGGLE_EXTENSION_UI_ATTRIBUTES: {
    readonly tone: "data-ow-tone";
    readonly variant: "data-ow-variant";
};
export type OpenWaggleExtensionUiTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
export type OpenWaggleExtensionUiButtonVariant = 'primary' | 'secondary' | 'ghost';
```

### Declarations from `dist/ui-stylesheet.d.ts`

```ts
import type { OpenWaggleExtensionTheme } from './theme-types.js';
export interface CreateOpenWaggleExtensionUiStylesheetOptions {
    readonly theme?: OpenWaggleExtensionTheme;
    readonly scopeSelector?: string;
    readonly includeThemeVariables?: boolean;
}
export declare function extensionThemeCssVariableDeclarations(theme?: OpenWaggleExtensionTheme): string;
export declare function createOpenWaggleExtensionUiStylesheet(options?: CreateOpenWaggleExtensionUiStylesheetOptions): string;
```

## Export `./json`

Types: `dist/json.d.ts`

### Declarations from `dist/json.d.ts`

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
    [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];
```

## Export `./manifest`

Types: `dist/manifest.d.ts`

### Declarations from `dist/manifest.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION } from './constants.js';
import type { ExtensionCapabilityScope, ExtensionContributionRuntime, ExtensionExecutionPlacement, ExtensionInstallSource, ExtensionNetworkAccessMode } from './types.js';
export interface ExtensionCapabilityDeclaration {
    readonly id: string;
    readonly methods?: readonly string[];
    readonly scopes?: readonly ExtensionCapabilityScope[];
}
export interface ExtensionContributionBase {
    readonly id: string;
    readonly title: string;
    readonly label?: string;
    readonly category?: string;
    readonly target?: {
        readonly projectPaths?: readonly string[];
        readonly sessionIds?: readonly string[];
    };
    readonly matches?: {
        readonly toolNames?: readonly string[];
        readonly customMessageNames?: readonly string[];
        readonly interactionKinds?: readonly string[];
    };
}
export interface ExtensionCommandContribution extends ExtensionContributionBase {
    readonly capability?: string;
    readonly method?: string;
}
export interface ExtensionEntryContribution extends ExtensionContributionBase {
    readonly runtime: ExtensionContributionRuntime;
    readonly execution?: ExtensionExecutionPlacement;
    readonly entry: string;
}
export interface ExtensionContributions {
    readonly commands?: readonly ExtensionCommandContribution[];
    readonly slashCommands?: readonly ExtensionCommandContribution[];
    readonly routes?: readonly ExtensionEntryContribution[];
    readonly settingsSections?: readonly ExtensionEntryContribution[];
    readonly sidePanels?: readonly ExtensionEntryContribution[];
    readonly dialogs?: readonly ExtensionEntryContribution[];
    readonly transcriptRenderers?: readonly ExtensionEntryContribution[];
    readonly toolRenderers?: readonly ExtensionEntryContribution[];
    readonly customMessageRenderers?: readonly ExtensionEntryContribution[];
    readonly interactionRenderers?: readonly ExtensionEntryContribution[];
    readonly statusWidgets?: readonly ExtensionEntryContribution[];
}
export interface ExtensionRuntimeRequirementDeclaration {
    readonly id: string;
    readonly label: string;
    readonly kind?: 'binary' | 'command';
    readonly command?: string;
    readonly binary?: string;
}
export interface OpenWaggleExtensionManifest {
    readonly manifestVersion: 1;
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly description?: string;
    readonly sdk: {
        readonly openwaggle: string;
    };
    readonly sourceFiles: readonly string[];
    readonly builtArtifacts: readonly string[];
    readonly install?: {
        readonly source: ExtensionInstallSource;
    };
    readonly build?: {
        readonly command: string;
        readonly outputs?: readonly string[];
    };
    readonly docs?: {
        readonly topics?: readonly {
            readonly id: string;
            readonly title: string;
            readonly path: string;
            readonly description?: string;
            readonly aliases?: readonly string[];
            readonly keywords?: readonly string[];
        }[];
    };
    readonly network?: {
        readonly origins: readonly string[];
        readonly accessModes?: readonly ExtensionNetworkAccessMode[];
    };
    readonly capabilities?: readonly ExtensionCapabilityDeclaration[];
    readonly contributions?: ExtensionContributions;
    readonly pi?: {
        readonly resourceRoots?: readonly string[];
    };
    readonly trusted?: {
        readonly main?: string;
        readonly renderer?: string;
    };
    readonly runtimeRequirements?: readonly ExtensionRuntimeRequirementDeclaration[];
}
export type OpenWaggleExtensionManifestFile = typeof OPENWAGGLE_EXTENSION.MANIFEST_FILE;
```

### Declarations from `dist/constants.d.ts`

```ts
export declare const OPENWAGGLE_EXTENSION_BROKER: {
    readonly CAPABILITY: {
        readonly HOST_CONTEXT: "openwaggle.host.context";
        readonly STORAGE: "openwaggle.storage";
        readonly STATE: "openwaggle.state";
        readonly ACTIONS: "openwaggle.actions";
        readonly SETTINGS: "openwaggle.settings";
        readonly DOCS: "openwaggle.docs";
        readonly RUNTIME: "openwaggle.runtime";
    };
    readonly CAPABILITIES: readonly ("openwaggle.host.context" | "openwaggle.storage" | "openwaggle.state" | "openwaggle.actions" | "openwaggle.settings" | "openwaggle.docs" | "openwaggle.runtime")[];
    readonly CAPABILITY_METHODS: readonly [{
        readonly capability: "openwaggle.host.context";
        readonly methods: readonly ["get-scope"];
    }, {
        readonly capability: "openwaggle.storage";
        readonly methods: readonly ["get", "set", "delete", "list"];
    }, {
        readonly capability: "openwaggle.state";
        readonly methods: readonly ["get-state", "read-state"];
    }, {
        readonly capability: "openwaggle.actions";
        readonly methods: readonly ["select-project"];
    }, {
        readonly capability: "openwaggle.settings";
        readonly methods: readonly ["get-settings", "update-settings", "get-setting", "update-setting"];
    }, {
        readonly capability: "openwaggle.docs";
        readonly methods: readonly ["discover-docs", "resolve-docs-topic"];
    }, {
        readonly capability: "openwaggle.runtime";
        readonly methods: readonly ["register-contribution", "unregister-contribution"];
    }];
    readonly METHOD: {
        readonly GET_SCOPE: "get-scope";
        readonly GET: "get";
        readonly SET: "set";
        readonly DELETE: "delete";
        readonly LIST: "list";
        readonly GET_STATE: "get-state";
        readonly READ_STATE: "read-state";
        readonly SELECT_PROJECT: "select-project";
        readonly GET_SETTINGS: "get-settings";
        readonly UPDATE_SETTINGS: "update-settings";
        readonly GET_SETTING: "get-setting";
        readonly UPDATE_SETTING: "update-setting";
        readonly DISCOVER_DOCS: "discover-docs";
        readonly RESOLVE_DOCS_TOPIC: "resolve-docs-topic";
        readonly REGISTER_CONTRIBUTION: "register-contribution";
        readonly UNREGISTER_CONTRIBUTION: "unregister-contribution";
    };
    readonly METHODS: readonly ("get-scope" | "get" | "set" | "delete" | "list" | "get-state" | "read-state" | "select-project" | "get-settings" | "update-settings" | "get-setting" | "update-setting" | "discover-docs" | "resolve-docs-topic" | "register-contribution" | "unregister-contribution")[];
    readonly FAILURE_CODE: {
        readonly INVALID_INPUT: "invalid-input";
        readonly INVALID_PAYLOAD: "invalid-payload";
        readonly UNKNOWN_EXTENSION: "unknown-extension";
        readonly DISABLED_EXTENSION: "disabled-extension";
        readonly UNKNOWN_CONTRIBUTION: "unknown-contribution";
        readonly UNDECLARED_CAPABILITY: "undeclared-capability";
        readonly UNDECLARED_METHOD: "undeclared-method";
        readonly UNDECLARED_SCOPE: "undeclared-scope";
        readonly OUT_OF_SCOPE: "out-of-scope";
        readonly UNSUPPORTED_CAPABILITY: "unsupported-capability";
        readonly UNSUPPORTED_METHOD: "unsupported-method";
        readonly TRANSPORT_FAILED: "transport-failed";
    };
    readonly FAILURE_CODES: readonly ("invalid-input" | "invalid-payload" | "unknown-extension" | "disabled-extension" | "unknown-contribution" | "undeclared-capability" | "undeclared-method" | "undeclared-scope" | "out-of-scope" | "unsupported-capability" | "unsupported-method" | "transport-failed")[];
    readonly OUTCOME: {
        readonly SUCCEEDED: "succeeded";
        readonly REJECTED: "rejected";
    };
    readonly OUTCOMES: readonly ("succeeded" | "rejected")[];
    readonly STATE_SELECTOR: {
        readonly CURRENT_PROJECT: "current-project";
        readonly CURRENT_SESSION: "current-session";
        readonly CURRENT_BRANCH: "current-branch";
        readonly RECENT_PROJECTS: "recent-projects";
        readonly MODEL_PREFERENCES: "model-preferences";
    };
    readonly STATE_SELECTORS: readonly ("current-project" | "current-session" | "current-branch" | "recent-projects" | "model-preferences")[];
    readonly SETTING_KEY: {
        readonly MODEL_PREFERENCES: "model-preferences";
        readonly PROJECT_DISPLAY_NAME: "project-display-name";
    };
    readonly SETTING_KEYS: readonly ("model-preferences" | "project-display-name")[];
};
export declare const OPENWAGGLE_EXTENSION: {
    readonly MANIFEST_FILE: "openwaggle.extension.json";
    readonly SDK_VERSION: "0.1.0";
    readonly PROJECT_ROOT_SEGMENTS: readonly [".openwaggle", "extensions"];
    readonly GLOBAL_EXTENSIONS_DIR: "extensions";
    readonly SCOPE: {
        readonly GLOBAL_KIND: "global";
        readonly PROJECT_KIND: "project";
        readonly GLOBAL_ID: "global";
    };
    readonly LIMITS: {
        readonly ID_MAX_LENGTH: 96;
        readonly CONTRIBUTION_ID_MAX_LENGTH: 128;
        readonly NAME_MAX_LENGTH: 120;
        readonly DESCRIPTION_MAX_LENGTH: 2000;
        readonly RELATIVE_PATH_MAX_LENGTH: 260;
        readonly NETWORK_ORIGIN_MAX_LENGTH: 300;
        readonly RUNTIME_REQUIREMENT_BINARY_MAX_LENGTH: 120;
        readonly BUILD_COMMAND_MAX_LENGTH: 500;
        readonly BUILD_LOG_MAX_LENGTH: 4000;
        readonly BUILD_COMMAND_TIMEOUT_MS: number;
    };
    readonly CAPABILITY_SCOPES: readonly ["app", "project", "session", "branch"];
    readonly CONTRIBUTION_FAMILY: {
        readonly COMMANDS: "commands";
        readonly SLASH_COMMANDS: "slashCommands";
        readonly ROUTES: "routes";
        readonly SETTINGS_SECTIONS: "settingsSections";
        readonly SIDE_PANELS: "sidePanels";
        readonly DIALOGS: "dialogs";
        readonly TRANSCRIPT_RENDERERS: "transcriptRenderers";
        readonly TOOL_RENDERERS: "toolRenderers";
        readonly CUSTOM_MESSAGE_RENDERERS: "customMessageRenderers";
        readonly INTERACTION_RENDERERS: "interactionRenderers";
        readonly STATUS_WIDGETS: "statusWidgets";
    };
    readonly CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands", "routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly COMMAND_CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands"];
    readonly CONTRIBUTION_RUNTIME: {
        readonly FEDERATED_MODULE: "federated-module";
        readonly TRUSTED_RENDERER: "trusted-renderer";
    };
    readonly CONTRIBUTION_RUNTIMES: readonly ("federated-module" | "trusted-renderer")[];
    readonly EXECUTION_PLACEMENT: {
        readonly HOST_RENDERER: "host-renderer";
        readonly FRAME: "frame";
    };
    readonly EXECUTION_PLACEMENTS: readonly ("host-renderer" | "frame")[];
    readonly STORAGE: {
        readonly KIND: {
            readonly STATE: "state";
            readonly CONFIG: "config";
        };
        readonly KINDS: readonly ("state" | "config")[];
        readonly SCOPE: {
            readonly GLOBAL_KIND: "global";
            readonly PROJECT_KIND: "project";
            readonly GLOBAL_ID: "global";
        };
        readonly SCOPE_KINDS: readonly ("global" | "project")[];
        readonly KEY_MAX_LENGTH: 160;
    };
    readonly ENTRY_CONTRIBUTION_FAMILIES: readonly ["routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly SLOT_CONTRIBUTION_FAMILIES: readonly ["settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly INSTALL_SOURCE: {
        readonly PREBUILT: "prebuilt";
        readonly LOCAL_BUILD: "local-build";
    };
    readonly INSTALL_SOURCES: readonly ("prebuilt" | "local-build")[];
    readonly RUNTIME_REQUIREMENT_TYPE: {
        readonly BINARY: "binary";
        readonly COMMAND: "command";
    };
    readonly RUNTIME_REQUIREMENT_TYPES: readonly ("binary" | "command")[];
    readonly NETWORK_ACCESS_MODE: {
        readonly BROKERED: "brokered";
        readonly RESTRICTED: "restricted";
        readonly DIRECT: "direct";
    };
    readonly NETWORK_ACCESS_MODES: readonly ("brokered" | "restricted" | "direct")[];
};
```

### Declarations from `dist/types.d.ts`

```ts
export type * from './contribution-types.js';
export type * from './core-types.js';
export type * from './openwaggle-types.js';
export type * from './registry-types.js';
export type * from './runtime-types.js';
export type * from './storage-types.js';
```

### Declarations from `dist/contribution-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION } from './constants.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionCapabilityScope = (typeof OPENWAGGLE_EXTENSION.CAPABILITY_SCOPES)[number];
export type ExtensionContributionFamily = ConstantValue<typeof OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY>;
export type ExtensionContributionRuntime = ConstantValue<typeof OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME>;
export type ExtensionExecutionPlacement = ConstantValue<typeof OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT>;
export type ExtensionInstallSource = ConstantValue<typeof OPENWAGGLE_EXTENSION.INSTALL_SOURCE>;
export type ExtensionNetworkAccessMode = ConstantValue<typeof OPENWAGGLE_EXTENSION.NETWORK_ACCESS_MODE>;
export interface ExtensionContributionTargetView {
    readonly projectPaths?: readonly string[];
    readonly sessionIds?: readonly string[];
}
export interface ExtensionContributionMatchView {
    readonly toolNames?: readonly string[];
    readonly customMessageNames?: readonly string[];
    readonly interactionKinds?: readonly string[];
}
export interface ExtensionContributionRegistration {
    readonly family: ExtensionContributionFamily;
    readonly contribution: {
        readonly id: string;
        readonly title: string;
        readonly label?: string;
        readonly category?: string;
        readonly capability?: string;
        readonly method?: string;
        readonly methods?: readonly string[];
        readonly declaredScopes?: readonly ExtensionCapabilityScope[];
        readonly networkOrigins?: readonly string[];
        readonly target?: ExtensionContributionTargetView;
        readonly matches?: ExtensionContributionMatchView;
        readonly runtime?: ExtensionContributionRuntime;
        readonly execution?: ExtensionExecutionPlacement;
        readonly entry?: string;
    };
}
export interface ExtensionContributionUnregistration {
    readonly family: ExtensionContributionFamily;
    readonly contributionId: string;
}
export type ExtensionRuntimeRegisterContributionPayload = ExtensionContributionRegistration;
export type ExtensionRuntimeUnregisterContributionPayload = ExtensionContributionUnregistration;
export {};
```

### Declarations from `dist/core-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionBrokerCapability = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY>;
export type ExtensionBrokerMethod = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.METHOD>;
export type ExtensionInvokeFailureCode = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE>;
export type ExtensionInvokeOutcome = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.OUTCOME>;
export type ExtensionStateSelector = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR>;
export type ExtensionSettingsKey = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY>;
export type ExtensionInvokeScope = {
    readonly kind: 'app';
} | {
    readonly kind: 'project';
    readonly projectPath: string;
} | {
    readonly kind: 'session';
    readonly projectPath: string;
    readonly sessionId: string;
} | {
    readonly kind: 'branch';
    readonly projectPath: string;
    readonly sessionId: string;
    readonly branchId: string;
};
export interface ExtensionCapabilityAuditEntry {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly outcome: ExtensionInvokeOutcome;
    readonly timestamp: number;
    readonly failureCode?: ExtensionInvokeFailureCode;
}
export interface ExtensionInvokeInput {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly payload?: unknown;
}
export interface ExtensionInvokeError {
    readonly code: ExtensionInvokeFailureCode;
    readonly message: string;
    readonly issues?: readonly string[];
}
export interface ExtensionInvokeSuccess<TValue = unknown> {
    readonly ok: true;
    readonly value: TValue;
    readonly audit: ExtensionCapabilityAuditEntry;
}
export interface ExtensionInvokeFailure {
    readonly ok: false;
    readonly error: ExtensionInvokeError;
    readonly audit?: ExtensionCapabilityAuditEntry;
}
export type ExtensionInvokeResult<TValue = unknown> = ExtensionInvokeSuccess<TValue> | ExtensionInvokeFailure;
export {};
```

### Declarations from `dist/openwaggle-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { ExtensionInvokeScope, ExtensionStateSelector } from './core-types.js';
export interface ExtensionModelPrefs {
    readonly selectedModel: string;
    readonly favoriteModels: readonly string[];
    readonly enabledModels: readonly string[];
    readonly thinkingLevel: string;
}
export interface ExtensionProjectView {
    readonly projectPath: string;
    readonly displayName: string | null;
    readonly active: boolean;
}
export interface ExtensionSessionView {
    readonly sessionId: string;
    readonly title: string;
    readonly projectPath: string | null;
}
export interface ExtensionBranchView {
    readonly branchId: string;
    readonly sessionId: string;
    readonly name: string;
    readonly main: boolean;
    readonly archived: boolean;
}
export interface ExtensionStateReadResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE;
    readonly scope: ExtensionInvokeScope;
    readonly activeProjectPath: string | null;
    readonly currentProject: ExtensionProjectView | null;
    readonly currentSession: ExtensionSessionView | null;
    readonly currentBranch: ExtensionBranchView | null;
    readonly recentProjects: readonly string[];
    readonly modelPreferences: ExtensionModelPrefs;
}
export interface ExtensionSelectedStateReadResult<TValue> {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE;
    readonly scope: ExtensionInvokeScope;
    readonly selector: ExtensionStateSelector;
    readonly value: TValue;
}
export type ExtensionStateCurrentProjectReadResult = ExtensionSelectedStateReadResult<ExtensionProjectView | null>;
export type ExtensionStateCurrentSessionReadResult = ExtensionSelectedStateReadResult<ExtensionSessionView | null>;
export type ExtensionStateCurrentBranchReadResult = ExtensionSelectedStateReadResult<ExtensionBranchView | null>;
export type ExtensionStateRecentProjectsReadResult = ExtensionSelectedStateReadResult<readonly string[]>;
export type ExtensionStateModelPreferencesReadResult = ExtensionSelectedStateReadResult<ExtensionModelPrefs>;
export interface ExtensionActionSelectProjectResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT;
    readonly previousProjectPath: string | null;
    readonly projectPath: string;
    readonly recentProjects: readonly string[];
}
export interface ExtensionSettingsView {
    readonly modelPreferences: ExtensionModelPrefs;
    readonly projectDisplayNames: Readonly<Record<string, string>>;
}
export interface ExtensionModelPreferencesSettingsPatch {
    readonly selectedModel?: string;
    readonly favoriteModels?: readonly string[];
    readonly enabledModels?: readonly string[];
    readonly thinkingLevel?: string;
}
export type ExtensionSettingsUpdatePayload = ExtensionModelPreferencesSettingsPatch & {
    readonly projectDisplayNames?: Readonly<Record<string, string>>;
};
export interface ExtensionSettingsGetResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS;
    readonly settings: ExtensionSettingsView;
}
export interface ExtensionSettingsUpdateResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS;
    readonly settings: ExtensionSettingsView;
}
export type ExtensionSettingsSelectedValue = {
    readonly key: typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES;
    readonly value: ExtensionModelPrefs;
} | {
    readonly key: typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME;
    readonly projectPath: string;
    readonly value: string | null;
};
export interface ExtensionSettingsGetSettingResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING;
    readonly setting: ExtensionSettingsSelectedValue;
}
export interface ExtensionSettingsUpdateSettingResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING;
    readonly setting: ExtensionSettingsSelectedValue;
}
export interface ExtensionDocsDiscoverPayload {
    readonly projectPaths?: readonly string[];
    readonly includeExtensions?: boolean;
}
export interface ExtensionDocsResolveTopicPayload {
    readonly topic: string;
}
export interface ExtensionDocsDiscoverResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS;
    readonly docs: unknown;
}
export interface ExtensionDocsResolveTopicResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC;
    readonly resolvedTopic: unknown;
}
```

### Declarations from `dist/registry-types.d.ts`

```ts
import type { ExtensionCapabilityScope, ExtensionContributionFamily, ExtensionContributionMatchView, ExtensionContributionRuntime, ExtensionContributionTargetView, ExtensionExecutionPlacement } from './contribution-types.js';
export type ExtensionPackageScopeKind = 'global' | 'project';
export interface ExtensionPackageScopeView {
    readonly kind: ExtensionPackageScopeKind;
    readonly label: string;
    readonly projectPath?: string;
}
export interface ExtensionContributionRegistryEntry {
    readonly extensionId: string;
    readonly extensionName: string;
    readonly extensionVersion: string;
    readonly scope: ExtensionPackageScopeView;
    readonly packagePath: string;
    readonly manifestPath: string;
    readonly contentHash: string;
    readonly projectPaths: readonly string[];
    readonly sessionId?: string;
    readonly appliesToAllRequestedProjects: boolean;
    readonly family: ExtensionContributionFamily;
    readonly contributionId: string;
    readonly title: string;
    readonly label: string;
    readonly category?: string;
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly declaredScopes?: readonly ExtensionCapabilityScope[];
    readonly networkOrigins?: readonly string[];
    readonly target?: ExtensionContributionTargetView;
    readonly matches?: ExtensionContributionMatchView;
    readonly runtime?: ExtensionContributionRuntime;
    readonly execution?: ExtensionExecutionPlacement;
    readonly entryPath?: string;
}
```

### Declarations from `dist/runtime-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { ExtensionContributionFamily } from './contribution-types.js';
export interface ExtensionRuntimeRegisterContributionResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION;
    readonly family: ExtensionContributionFamily;
    readonly registeredContributionId: string;
}
export interface ExtensionRuntimeUnregisterContributionResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION;
    readonly family: ExtensionContributionFamily;
    readonly unregisteredContributionId: string;
    readonly unregistered: boolean;
}
```

### Declarations from `dist/storage-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION, OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { JsonValue } from './json.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionStorageKind = ConstantValue<typeof OPENWAGGLE_EXTENSION.STORAGE.KIND>;
export type ExtensionStorageScopeSelector = (typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE_KINDS)[number];
export type ExtensionStorageScope = {
    readonly kind: typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND;
} | {
    readonly kind: typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND;
    readonly projectPath: string;
};
export interface ExtensionStorageResultBase {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE;
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
}
export interface ExtensionStorageGetResult extends ExtensionStorageResultBase {
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET;
    readonly key: string;
    readonly value: JsonValue | null;
}
export interface ExtensionStorageSetResult extends ExtensionStorageResultBase {
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.SET;
    readonly key: string;
    readonly value: JsonValue;
    readonly createdAt: number;
    readonly updatedAt: number;
}
export interface ExtensionStorageDeleteResult extends ExtensionStorageResultBase {
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE;
    readonly key: string;
    readonly deleted: true;
}
export interface ExtensionStorageListResult extends ExtensionStorageResultBase {
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST;
    readonly keys: readonly string[];
}
export {};
```

### Declarations from `dist/json.d.ts`

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
    [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];
```

## Export `./theme`

Types: `dist/theme.d.ts`

### Declarations from `dist/theme.d.ts`

```ts
import type { CreateOpenWaggleExtensionThemeOptions, OpenWaggleExtensionTheme, OpenWaggleExtensionThemeCssVariableEntry } from './theme-types.js';
export { OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES } from './theme-data.js';
export type { CreateOpenWaggleExtensionThemeOptions, ExtensionThemeCssVariableResolver, OpenWaggleExtensionColorScheme, OpenWaggleExtensionTheme, OpenWaggleExtensionThemeCssVariableEntry, OpenWaggleExtensionThemeCssVariables, OpenWaggleExtensionThemeTokens, } from './theme-types.js';
export declare function createOpenWaggleExtensionTheme(options?: CreateOpenWaggleExtensionThemeOptions): OpenWaggleExtensionTheme;
export declare function extensionThemeCssVariableEntries(theme: OpenWaggleExtensionTheme): readonly OpenWaggleExtensionThemeCssVariableEntry[];
export declare function isOpenWaggleExtensionTheme(value: unknown): value is OpenWaggleExtensionTheme;
```

### Declarations from `dist/theme-types.d.ts`

```ts
export type OpenWaggleExtensionColorScheme = 'dark';
export interface OpenWaggleExtensionThemeTokens {
    readonly color: {
        readonly background: string;
        readonly surface: string;
        readonly surfaceRaised: string;
        readonly surfaceHover: string;
        readonly surfaceActive: string;
        readonly border: string;
        readonly borderStrong: string;
        readonly text: string;
        readonly textSubtle: string;
        readonly textMuted: string;
        readonly textDim: string;
        readonly accent: string;
        readonly accentDim: string;
        readonly success: string;
        readonly danger: string;
        readonly warning: string;
        readonly info: string;
    };
    readonly typography: {
        readonly sansFamily: string;
        readonly monoFamily: string;
    };
    readonly spacing: {
        readonly xs: string;
        readonly sm: string;
        readonly md: string;
        readonly lg: string;
        readonly xl: string;
    };
    readonly radius: {
        readonly sm: string;
        readonly md: string;
        readonly lg: string;
        readonly panel: string;
    };
    readonly focus: {
        readonly ring: string;
        readonly shadow: string;
    };
    readonly elevation: {
        readonly card: string;
        readonly overlay: string;
    };
}
export type OpenWaggleExtensionThemeCssVariables = OpenWaggleExtensionThemeTokens;
export interface OpenWaggleExtensionTheme {
    readonly colorScheme: OpenWaggleExtensionColorScheme;
    readonly tokens: OpenWaggleExtensionThemeTokens;
    readonly cssVariables: OpenWaggleExtensionThemeCssVariables;
}
export interface OpenWaggleExtensionThemeCssVariableEntry {
    readonly name: string;
    readonly value: string;
}
export type ExtensionThemeCssVariableResolver = (cssVariable: string, fallback: string) => string;
export interface CreateOpenWaggleExtensionThemeOptions {
    readonly resolveCssVariable?: ExtensionThemeCssVariableResolver;
}
```

### Declarations from `dist/theme-data.d.ts`

```ts
export declare const OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES: {
    readonly color: {
        readonly background: "--ow-color-background";
        readonly surface: "--ow-color-surface";
        readonly surfaceRaised: "--ow-color-surface-raised";
        readonly surfaceHover: "--ow-color-surface-hover";
        readonly surfaceActive: "--ow-color-surface-active";
        readonly border: "--ow-color-border";
        readonly borderStrong: "--ow-color-border-strong";
        readonly text: "--ow-color-text";
        readonly textSubtle: "--ow-color-text-subtle";
        readonly textMuted: "--ow-color-text-muted";
        readonly textDim: "--ow-color-text-dim";
        readonly accent: "--ow-color-accent";
        readonly accentDim: "--ow-color-accent-dim";
        readonly success: "--ow-color-success";
        readonly danger: "--ow-color-danger";
        readonly warning: "--ow-color-warning";
        readonly info: "--ow-color-info";
    };
    readonly typography: {
        readonly sansFamily: "--ow-font-family-sans";
        readonly monoFamily: "--ow-font-family-mono";
    };
    readonly spacing: {
        readonly xs: "--ow-space-xs";
        readonly sm: "--ow-space-sm";
        readonly md: "--ow-space-md";
        readonly lg: "--ow-space-lg";
        readonly xl: "--ow-space-xl";
    };
    readonly radius: {
        readonly sm: "--ow-radius-sm";
        readonly md: "--ow-radius-md";
        readonly lg: "--ow-radius-lg";
        readonly panel: "--ow-radius-panel";
    };
    readonly focus: {
        readonly ring: "--ow-focus-ring";
        readonly shadow: "--ow-focus-shadow";
    };
    readonly elevation: {
        readonly card: "--ow-elevation-card";
        readonly overlay: "--ow-elevation-overlay";
    };
};
export declare const DEFAULT_EXTENSION_THEME_TOKENS: {
    readonly color: {
        readonly background: "#141619";
        readonly surface: "#1a1d22";
        readonly surfaceRaised: "#1f232a";
        readonly surfaceHover: "#262b33";
        readonly surfaceActive: "#1d1a10";
        readonly border: "#1e2229";
        readonly borderStrong: "#2a3240";
        readonly text: "#e7e9ee";
        readonly textSubtle: "#c9cdd6";
        readonly textMuted: "#9098a8";
        readonly textDim: "#666f7d";
        readonly accent: "#f5a623";
        readonly accentDim: "#b87410";
        readonly success: "#4caf72";
        readonly danger: "#ef4444";
        readonly warning: "#f5a623";
        readonly info: "#61a8ff";
    };
    readonly typography: {
        readonly sansFamily: "Inter, \"SF Pro Text\", \"SF Pro Display\", -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif";
        readonly monoFamily: "\"SF Mono\", \"JetBrains Mono\", \"Cascadia Mono\", ui-monospace, monospace";
    };
    readonly spacing: {
        readonly xs: "4px";
        readonly sm: "8px";
        readonly md: "12px";
        readonly lg: "16px";
        readonly xl: "24px";
    };
    readonly radius: {
        readonly sm: "6px";
        readonly md: "9px";
        readonly lg: "12px";
        readonly panel: "22px";
    };
    readonly focus: {
        readonly ring: "#9aa3b2";
        readonly shadow: "0 0 0 1px color-mix(in srgb, #9aa3b2 76%, transparent), 0 0 0 3px color-mix(in srgb, #9aa3b2 15%, transparent)";
    };
    readonly elevation: {
        readonly card: "inset 0 1px 0 rgba(255, 255, 255, 0.02)";
        readonly overlay: "0 24px 80px rgba(0, 0, 0, 0.45)";
    };
};
export declare const SOURCE_EXTENSION_THEME_CSS_VARIABLES: {
    readonly color: {
        readonly background: "--color-bg";
        readonly surface: "--color-bg-secondary";
        readonly surfaceRaised: "--color-bg-tertiary";
        readonly surfaceHover: "--color-bg-hover";
        readonly surfaceActive: "--color-bg-active";
        readonly border: "--color-border";
        readonly borderStrong: "--color-border-light";
        readonly text: "--color-text-primary";
        readonly textSubtle: "--color-text-secondary";
        readonly textMuted: "--color-text-tertiary";
        readonly textDim: "--color-text-muted";
        readonly accent: "--color-accent";
        readonly accentDim: "--color-accent-dim";
        readonly success: "--color-success";
        readonly danger: "--color-error";
        readonly warning: "--color-warning";
        readonly info: "--color-info";
    };
    readonly typography: {
        readonly sansFamily: "--font-sans";
        readonly monoFamily: "--font-mono";
    };
    readonly radius: {
        readonly panel: "--radius-panel";
    };
};
export declare const EXTENSION_THEME_COLOR_KEYS: readonly ["background", "surface", "surfaceRaised", "surfaceHover", "surfaceActive", "border", "borderStrong", "text", "textSubtle", "textMuted", "textDim", "accent", "accentDim", "success", "danger", "warning", "info"];
export declare const EXTENSION_THEME_TYPOGRAPHY_KEYS: readonly ["sansFamily", "monoFamily"];
export declare const EXTENSION_THEME_SPACING_KEYS: readonly ["xs", "sm", "md", "lg", "xl"];
export declare const EXTENSION_THEME_RADIUS_KEYS: readonly ["sm", "md", "lg", "panel"];
export declare const EXTENSION_THEME_FOCUS_KEYS: readonly ["ring", "shadow"];
export declare const EXTENSION_THEME_ELEVATION_KEYS: readonly ["card", "overlay"];
```

## Export `./types`

Types: `dist/types.d.ts`

### Declarations from `dist/types.d.ts`

```ts
export type * from './contribution-types.js';
export type * from './core-types.js';
export type * from './openwaggle-types.js';
export type * from './registry-types.js';
export type * from './runtime-types.js';
export type * from './storage-types.js';
```

### Declarations from `dist/contribution-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION } from './constants.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionCapabilityScope = (typeof OPENWAGGLE_EXTENSION.CAPABILITY_SCOPES)[number];
export type ExtensionContributionFamily = ConstantValue<typeof OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY>;
export type ExtensionContributionRuntime = ConstantValue<typeof OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME>;
export type ExtensionExecutionPlacement = ConstantValue<typeof OPENWAGGLE_EXTENSION.EXECUTION_PLACEMENT>;
export type ExtensionInstallSource = ConstantValue<typeof OPENWAGGLE_EXTENSION.INSTALL_SOURCE>;
export type ExtensionNetworkAccessMode = ConstantValue<typeof OPENWAGGLE_EXTENSION.NETWORK_ACCESS_MODE>;
export interface ExtensionContributionTargetView {
    readonly projectPaths?: readonly string[];
    readonly sessionIds?: readonly string[];
}
export interface ExtensionContributionMatchView {
    readonly toolNames?: readonly string[];
    readonly customMessageNames?: readonly string[];
    readonly interactionKinds?: readonly string[];
}
export interface ExtensionContributionRegistration {
    readonly family: ExtensionContributionFamily;
    readonly contribution: {
        readonly id: string;
        readonly title: string;
        readonly label?: string;
        readonly category?: string;
        readonly capability?: string;
        readonly method?: string;
        readonly methods?: readonly string[];
        readonly declaredScopes?: readonly ExtensionCapabilityScope[];
        readonly networkOrigins?: readonly string[];
        readonly target?: ExtensionContributionTargetView;
        readonly matches?: ExtensionContributionMatchView;
        readonly runtime?: ExtensionContributionRuntime;
        readonly execution?: ExtensionExecutionPlacement;
        readonly entry?: string;
    };
}
export interface ExtensionContributionUnregistration {
    readonly family: ExtensionContributionFamily;
    readonly contributionId: string;
}
export type ExtensionRuntimeRegisterContributionPayload = ExtensionContributionRegistration;
export type ExtensionRuntimeUnregisterContributionPayload = ExtensionContributionUnregistration;
export {};
```

### Declarations from `dist/constants.d.ts`

```ts
export declare const OPENWAGGLE_EXTENSION_BROKER: {
    readonly CAPABILITY: {
        readonly HOST_CONTEXT: "openwaggle.host.context";
        readonly STORAGE: "openwaggle.storage";
        readonly STATE: "openwaggle.state";
        readonly ACTIONS: "openwaggle.actions";
        readonly SETTINGS: "openwaggle.settings";
        readonly DOCS: "openwaggle.docs";
        readonly RUNTIME: "openwaggle.runtime";
    };
    readonly CAPABILITIES: readonly ("openwaggle.host.context" | "openwaggle.storage" | "openwaggle.state" | "openwaggle.actions" | "openwaggle.settings" | "openwaggle.docs" | "openwaggle.runtime")[];
    readonly CAPABILITY_METHODS: readonly [{
        readonly capability: "openwaggle.host.context";
        readonly methods: readonly ["get-scope"];
    }, {
        readonly capability: "openwaggle.storage";
        readonly methods: readonly ["get", "set", "delete", "list"];
    }, {
        readonly capability: "openwaggle.state";
        readonly methods: readonly ["get-state", "read-state"];
    }, {
        readonly capability: "openwaggle.actions";
        readonly methods: readonly ["select-project"];
    }, {
        readonly capability: "openwaggle.settings";
        readonly methods: readonly ["get-settings", "update-settings", "get-setting", "update-setting"];
    }, {
        readonly capability: "openwaggle.docs";
        readonly methods: readonly ["discover-docs", "resolve-docs-topic"];
    }, {
        readonly capability: "openwaggle.runtime";
        readonly methods: readonly ["register-contribution", "unregister-contribution"];
    }];
    readonly METHOD: {
        readonly GET_SCOPE: "get-scope";
        readonly GET: "get";
        readonly SET: "set";
        readonly DELETE: "delete";
        readonly LIST: "list";
        readonly GET_STATE: "get-state";
        readonly READ_STATE: "read-state";
        readonly SELECT_PROJECT: "select-project";
        readonly GET_SETTINGS: "get-settings";
        readonly UPDATE_SETTINGS: "update-settings";
        readonly GET_SETTING: "get-setting";
        readonly UPDATE_SETTING: "update-setting";
        readonly DISCOVER_DOCS: "discover-docs";
        readonly RESOLVE_DOCS_TOPIC: "resolve-docs-topic";
        readonly REGISTER_CONTRIBUTION: "register-contribution";
        readonly UNREGISTER_CONTRIBUTION: "unregister-contribution";
    };
    readonly METHODS: readonly ("get-scope" | "get" | "set" | "delete" | "list" | "get-state" | "read-state" | "select-project" | "get-settings" | "update-settings" | "get-setting" | "update-setting" | "discover-docs" | "resolve-docs-topic" | "register-contribution" | "unregister-contribution")[];
    readonly FAILURE_CODE: {
        readonly INVALID_INPUT: "invalid-input";
        readonly INVALID_PAYLOAD: "invalid-payload";
        readonly UNKNOWN_EXTENSION: "unknown-extension";
        readonly DISABLED_EXTENSION: "disabled-extension";
        readonly UNKNOWN_CONTRIBUTION: "unknown-contribution";
        readonly UNDECLARED_CAPABILITY: "undeclared-capability";
        readonly UNDECLARED_METHOD: "undeclared-method";
        readonly UNDECLARED_SCOPE: "undeclared-scope";
        readonly OUT_OF_SCOPE: "out-of-scope";
        readonly UNSUPPORTED_CAPABILITY: "unsupported-capability";
        readonly UNSUPPORTED_METHOD: "unsupported-method";
        readonly TRANSPORT_FAILED: "transport-failed";
    };
    readonly FAILURE_CODES: readonly ("invalid-input" | "invalid-payload" | "unknown-extension" | "disabled-extension" | "unknown-contribution" | "undeclared-capability" | "undeclared-method" | "undeclared-scope" | "out-of-scope" | "unsupported-capability" | "unsupported-method" | "transport-failed")[];
    readonly OUTCOME: {
        readonly SUCCEEDED: "succeeded";
        readonly REJECTED: "rejected";
    };
    readonly OUTCOMES: readonly ("succeeded" | "rejected")[];
    readonly STATE_SELECTOR: {
        readonly CURRENT_PROJECT: "current-project";
        readonly CURRENT_SESSION: "current-session";
        readonly CURRENT_BRANCH: "current-branch";
        readonly RECENT_PROJECTS: "recent-projects";
        readonly MODEL_PREFERENCES: "model-preferences";
    };
    readonly STATE_SELECTORS: readonly ("current-project" | "current-session" | "current-branch" | "recent-projects" | "model-preferences")[];
    readonly SETTING_KEY: {
        readonly MODEL_PREFERENCES: "model-preferences";
        readonly PROJECT_DISPLAY_NAME: "project-display-name";
    };
    readonly SETTING_KEYS: readonly ("model-preferences" | "project-display-name")[];
};
export declare const OPENWAGGLE_EXTENSION: {
    readonly MANIFEST_FILE: "openwaggle.extension.json";
    readonly SDK_VERSION: "0.1.0";
    readonly PROJECT_ROOT_SEGMENTS: readonly [".openwaggle", "extensions"];
    readonly GLOBAL_EXTENSIONS_DIR: "extensions";
    readonly SCOPE: {
        readonly GLOBAL_KIND: "global";
        readonly PROJECT_KIND: "project";
        readonly GLOBAL_ID: "global";
    };
    readonly LIMITS: {
        readonly ID_MAX_LENGTH: 96;
        readonly CONTRIBUTION_ID_MAX_LENGTH: 128;
        readonly NAME_MAX_LENGTH: 120;
        readonly DESCRIPTION_MAX_LENGTH: 2000;
        readonly RELATIVE_PATH_MAX_LENGTH: 260;
        readonly NETWORK_ORIGIN_MAX_LENGTH: 300;
        readonly RUNTIME_REQUIREMENT_BINARY_MAX_LENGTH: 120;
        readonly BUILD_COMMAND_MAX_LENGTH: 500;
        readonly BUILD_LOG_MAX_LENGTH: 4000;
        readonly BUILD_COMMAND_TIMEOUT_MS: number;
    };
    readonly CAPABILITY_SCOPES: readonly ["app", "project", "session", "branch"];
    readonly CONTRIBUTION_FAMILY: {
        readonly COMMANDS: "commands";
        readonly SLASH_COMMANDS: "slashCommands";
        readonly ROUTES: "routes";
        readonly SETTINGS_SECTIONS: "settingsSections";
        readonly SIDE_PANELS: "sidePanels";
        readonly DIALOGS: "dialogs";
        readonly TRANSCRIPT_RENDERERS: "transcriptRenderers";
        readonly TOOL_RENDERERS: "toolRenderers";
        readonly CUSTOM_MESSAGE_RENDERERS: "customMessageRenderers";
        readonly INTERACTION_RENDERERS: "interactionRenderers";
        readonly STATUS_WIDGETS: "statusWidgets";
    };
    readonly CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands", "routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly COMMAND_CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands"];
    readonly CONTRIBUTION_RUNTIME: {
        readonly FEDERATED_MODULE: "federated-module";
        readonly TRUSTED_RENDERER: "trusted-renderer";
    };
    readonly CONTRIBUTION_RUNTIMES: readonly ("federated-module" | "trusted-renderer")[];
    readonly EXECUTION_PLACEMENT: {
        readonly HOST_RENDERER: "host-renderer";
        readonly FRAME: "frame";
    };
    readonly EXECUTION_PLACEMENTS: readonly ("host-renderer" | "frame")[];
    readonly STORAGE: {
        readonly KIND: {
            readonly STATE: "state";
            readonly CONFIG: "config";
        };
        readonly KINDS: readonly ("state" | "config")[];
        readonly SCOPE: {
            readonly GLOBAL_KIND: "global";
            readonly PROJECT_KIND: "project";
            readonly GLOBAL_ID: "global";
        };
        readonly SCOPE_KINDS: readonly ("global" | "project")[];
        readonly KEY_MAX_LENGTH: 160;
    };
    readonly ENTRY_CONTRIBUTION_FAMILIES: readonly ["routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly SLOT_CONTRIBUTION_FAMILIES: readonly ["settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly INSTALL_SOURCE: {
        readonly PREBUILT: "prebuilt";
        readonly LOCAL_BUILD: "local-build";
    };
    readonly INSTALL_SOURCES: readonly ("prebuilt" | "local-build")[];
    readonly RUNTIME_REQUIREMENT_TYPE: {
        readonly BINARY: "binary";
        readonly COMMAND: "command";
    };
    readonly RUNTIME_REQUIREMENT_TYPES: readonly ("binary" | "command")[];
    readonly NETWORK_ACCESS_MODE: {
        readonly BROKERED: "brokered";
        readonly RESTRICTED: "restricted";
        readonly DIRECT: "direct";
    };
    readonly NETWORK_ACCESS_MODES: readonly ("brokered" | "restricted" | "direct")[];
};
```

### Declarations from `dist/core-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionBrokerCapability = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY>;
export type ExtensionBrokerMethod = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.METHOD>;
export type ExtensionInvokeFailureCode = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE>;
export type ExtensionInvokeOutcome = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.OUTCOME>;
export type ExtensionStateSelector = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR>;
export type ExtensionSettingsKey = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY>;
export type ExtensionInvokeScope = {
    readonly kind: 'app';
} | {
    readonly kind: 'project';
    readonly projectPath: string;
} | {
    readonly kind: 'session';
    readonly projectPath: string;
    readonly sessionId: string;
} | {
    readonly kind: 'branch';
    readonly projectPath: string;
    readonly sessionId: string;
    readonly branchId: string;
};
export interface ExtensionCapabilityAuditEntry {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly outcome: ExtensionInvokeOutcome;
    readonly timestamp: number;
    readonly failureCode?: ExtensionInvokeFailureCode;
}
export interface ExtensionInvokeInput {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly payload?: unknown;
}
export interface ExtensionInvokeError {
    readonly code: ExtensionInvokeFailureCode;
    readonly message: string;
    readonly issues?: readonly string[];
}
export interface ExtensionInvokeSuccess<TValue = unknown> {
    readonly ok: true;
    readonly value: TValue;
    readonly audit: ExtensionCapabilityAuditEntry;
}
export interface ExtensionInvokeFailure {
    readonly ok: false;
    readonly error: ExtensionInvokeError;
    readonly audit?: ExtensionCapabilityAuditEntry;
}
export type ExtensionInvokeResult<TValue = unknown> = ExtensionInvokeSuccess<TValue> | ExtensionInvokeFailure;
export {};
```

### Declarations from `dist/openwaggle-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { ExtensionInvokeScope, ExtensionStateSelector } from './core-types.js';
export interface ExtensionModelPrefs {
    readonly selectedModel: string;
    readonly favoriteModels: readonly string[];
    readonly enabledModels: readonly string[];
    readonly thinkingLevel: string;
}
export interface ExtensionProjectView {
    readonly projectPath: string;
    readonly displayName: string | null;
    readonly active: boolean;
}
export interface ExtensionSessionView {
    readonly sessionId: string;
    readonly title: string;
    readonly projectPath: string | null;
}
export interface ExtensionBranchView {
    readonly branchId: string;
    readonly sessionId: string;
    readonly name: string;
    readonly main: boolean;
    readonly archived: boolean;
}
export interface ExtensionStateReadResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE;
    readonly scope: ExtensionInvokeScope;
    readonly activeProjectPath: string | null;
    readonly currentProject: ExtensionProjectView | null;
    readonly currentSession: ExtensionSessionView | null;
    readonly currentBranch: ExtensionBranchView | null;
    readonly recentProjects: readonly string[];
    readonly modelPreferences: ExtensionModelPrefs;
}
export interface ExtensionSelectedStateReadResult<TValue> {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE;
    readonly scope: ExtensionInvokeScope;
    readonly selector: ExtensionStateSelector;
    readonly value: TValue;
}
export type ExtensionStateCurrentProjectReadResult = ExtensionSelectedStateReadResult<ExtensionProjectView | null>;
export type ExtensionStateCurrentSessionReadResult = ExtensionSelectedStateReadResult<ExtensionSessionView | null>;
export type ExtensionStateCurrentBranchReadResult = ExtensionSelectedStateReadResult<ExtensionBranchView | null>;
export type ExtensionStateRecentProjectsReadResult = ExtensionSelectedStateReadResult<readonly string[]>;
export type ExtensionStateModelPreferencesReadResult = ExtensionSelectedStateReadResult<ExtensionModelPrefs>;
export interface ExtensionActionSelectProjectResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT;
    readonly previousProjectPath: string | null;
    readonly projectPath: string;
    readonly recentProjects: readonly string[];
}
export interface ExtensionSettingsView {
    readonly modelPreferences: ExtensionModelPrefs;
    readonly projectDisplayNames: Readonly<Record<string, string>>;
}
export interface ExtensionModelPreferencesSettingsPatch {
    readonly selectedModel?: string;
    readonly favoriteModels?: readonly string[];
    readonly enabledModels?: readonly string[];
    readonly thinkingLevel?: string;
}
export type ExtensionSettingsUpdatePayload = ExtensionModelPreferencesSettingsPatch & {
    readonly projectDisplayNames?: Readonly<Record<string, string>>;
};
export interface ExtensionSettingsGetResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS;
    readonly settings: ExtensionSettingsView;
}
export interface ExtensionSettingsUpdateResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS;
    readonly settings: ExtensionSettingsView;
}
export type ExtensionSettingsSelectedValue = {
    readonly key: typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES;
    readonly value: ExtensionModelPrefs;
} | {
    readonly key: typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME;
    readonly projectPath: string;
    readonly value: string | null;
};
export interface ExtensionSettingsGetSettingResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING;
    readonly setting: ExtensionSettingsSelectedValue;
}
export interface ExtensionSettingsUpdateSettingResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING;
    readonly setting: ExtensionSettingsSelectedValue;
}
export interface ExtensionDocsDiscoverPayload {
    readonly projectPaths?: readonly string[];
    readonly includeExtensions?: boolean;
}
export interface ExtensionDocsResolveTopicPayload {
    readonly topic: string;
}
export interface ExtensionDocsDiscoverResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS;
    readonly docs: unknown;
}
export interface ExtensionDocsResolveTopicResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC;
    readonly resolvedTopic: unknown;
}
```

### Declarations from `dist/registry-types.d.ts`

```ts
import type { ExtensionCapabilityScope, ExtensionContributionFamily, ExtensionContributionMatchView, ExtensionContributionRuntime, ExtensionContributionTargetView, ExtensionExecutionPlacement } from './contribution-types.js';
export type ExtensionPackageScopeKind = 'global' | 'project';
export interface ExtensionPackageScopeView {
    readonly kind: ExtensionPackageScopeKind;
    readonly label: string;
    readonly projectPath?: string;
}
export interface ExtensionContributionRegistryEntry {
    readonly extensionId: string;
    readonly extensionName: string;
    readonly extensionVersion: string;
    readonly scope: ExtensionPackageScopeView;
    readonly packagePath: string;
    readonly manifestPath: string;
    readonly contentHash: string;
    readonly projectPaths: readonly string[];
    readonly sessionId?: string;
    readonly appliesToAllRequestedProjects: boolean;
    readonly family: ExtensionContributionFamily;
    readonly contributionId: string;
    readonly title: string;
    readonly label: string;
    readonly category?: string;
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly declaredScopes?: readonly ExtensionCapabilityScope[];
    readonly networkOrigins?: readonly string[];
    readonly target?: ExtensionContributionTargetView;
    readonly matches?: ExtensionContributionMatchView;
    readonly runtime?: ExtensionContributionRuntime;
    readonly execution?: ExtensionExecutionPlacement;
    readonly entryPath?: string;
}
```

### Declarations from `dist/runtime-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { ExtensionContributionFamily } from './contribution-types.js';
export interface ExtensionRuntimeRegisterContributionResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION;
    readonly family: ExtensionContributionFamily;
    readonly registeredContributionId: string;
}
export interface ExtensionRuntimeUnregisterContributionResult {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION;
    readonly family: ExtensionContributionFamily;
    readonly unregisteredContributionId: string;
    readonly unregistered: boolean;
}
```

### Declarations from `dist/storage-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION, OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { JsonValue } from './json.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionStorageKind = ConstantValue<typeof OPENWAGGLE_EXTENSION.STORAGE.KIND>;
export type ExtensionStorageScopeSelector = (typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE_KINDS)[number];
export type ExtensionStorageScope = {
    readonly kind: typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND;
} | {
    readonly kind: typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND;
    readonly projectPath: string;
};
export interface ExtensionStorageResultBase {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE;
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
}
export interface ExtensionStorageGetResult extends ExtensionStorageResultBase {
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET;
    readonly key: string;
    readonly value: JsonValue | null;
}
export interface ExtensionStorageSetResult extends ExtensionStorageResultBase {
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.SET;
    readonly key: string;
    readonly value: JsonValue;
    readonly createdAt: number;
    readonly updatedAt: number;
}
export interface ExtensionStorageDeleteResult extends ExtensionStorageResultBase {
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE;
    readonly key: string;
    readonly deleted: true;
}
export interface ExtensionStorageListResult extends ExtensionStorageResultBase {
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST;
    readonly keys: readonly string[];
}
export {};
```

### Declarations from `dist/json.d.ts`

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
    [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];
```

## Export `./ui`

Types: `dist/ui.d.ts`

### Declarations from `dist/ui.d.ts`

```ts
export type { OpenWaggleExtensionUiButtonVariant, OpenWaggleExtensionUiTone, } from './ui-constants.js';
export { OPENWAGGLE_EXTENSION_UI_ATTRIBUTES, OPENWAGGLE_EXTENSION_UI_CLASS_NAMES, } from './ui-constants.js';
export type OpenWaggleExtensionClassNamePart = string | false | null | undefined;
export declare function openWaggleExtensionClassName(...parts: readonly OpenWaggleExtensionClassNamePart[]): string;
export type { CreateOpenWaggleExtensionUiStylesheetOptions } from './ui-stylesheet.js';
export { createOpenWaggleExtensionUiStylesheet, extensionThemeCssVariableDeclarations, } from './ui-stylesheet.js';
```

### Declarations from `dist/ui-constants.d.ts`

```ts
export declare const OPENWAGGLE_EXTENSION_UI_CLASS_NAMES: {
    readonly root: "ow-extension-root";
    readonly panel: "ow-extension-panel";
    readonly stack: "ow-extension-stack";
    readonly row: "ow-extension-row";
    readonly heading: "ow-extension-heading";
    readonly text: "ow-extension-text";
    readonly muted: "ow-extension-muted";
    readonly divider: "ow-extension-divider";
    readonly button: "ow-extension-button";
    readonly input: "ow-extension-input";
    readonly textarea: "ow-extension-textarea";
    readonly select: "ow-extension-select";
    readonly checkbox: "ow-extension-checkbox";
    readonly badge: "ow-extension-badge";
    readonly field: "ow-extension-field";
    readonly alert: "ow-extension-alert";
};
export declare const OPENWAGGLE_EXTENSION_UI_ATTRIBUTES: {
    readonly tone: "data-ow-tone";
    readonly variant: "data-ow-variant";
};
export type OpenWaggleExtensionUiTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
export type OpenWaggleExtensionUiButtonVariant = 'primary' | 'secondary' | 'ghost';
```

### Declarations from `dist/ui-stylesheet.d.ts`

```ts
import type { OpenWaggleExtensionTheme } from './theme-types.js';
export interface CreateOpenWaggleExtensionUiStylesheetOptions {
    readonly theme?: OpenWaggleExtensionTheme;
    readonly scopeSelector?: string;
    readonly includeThemeVariables?: boolean;
}
export declare function extensionThemeCssVariableDeclarations(theme?: OpenWaggleExtensionTheme): string;
export declare function createOpenWaggleExtensionUiStylesheet(options?: CreateOpenWaggleExtensionUiStylesheetOptions): string;
```

### Declarations from `dist/theme-types.d.ts`

```ts
export type OpenWaggleExtensionColorScheme = 'dark';
export interface OpenWaggleExtensionThemeTokens {
    readonly color: {
        readonly background: string;
        readonly surface: string;
        readonly surfaceRaised: string;
        readonly surfaceHover: string;
        readonly surfaceActive: string;
        readonly border: string;
        readonly borderStrong: string;
        readonly text: string;
        readonly textSubtle: string;
        readonly textMuted: string;
        readonly textDim: string;
        readonly accent: string;
        readonly accentDim: string;
        readonly success: string;
        readonly danger: string;
        readonly warning: string;
        readonly info: string;
    };
    readonly typography: {
        readonly sansFamily: string;
        readonly monoFamily: string;
    };
    readonly spacing: {
        readonly xs: string;
        readonly sm: string;
        readonly md: string;
        readonly lg: string;
        readonly xl: string;
    };
    readonly radius: {
        readonly sm: string;
        readonly md: string;
        readonly lg: string;
        readonly panel: string;
    };
    readonly focus: {
        readonly ring: string;
        readonly shadow: string;
    };
    readonly elevation: {
        readonly card: string;
        readonly overlay: string;
    };
}
export type OpenWaggleExtensionThemeCssVariables = OpenWaggleExtensionThemeTokens;
export interface OpenWaggleExtensionTheme {
    readonly colorScheme: OpenWaggleExtensionColorScheme;
    readonly tokens: OpenWaggleExtensionThemeTokens;
    readonly cssVariables: OpenWaggleExtensionThemeCssVariables;
}
export interface OpenWaggleExtensionThemeCssVariableEntry {
    readonly name: string;
    readonly value: string;
}
export type ExtensionThemeCssVariableResolver = (cssVariable: string, fallback: string) => string;
export interface CreateOpenWaggleExtensionThemeOptions {
    readonly resolveCssVariable?: ExtensionThemeCssVariableResolver;
}
```
