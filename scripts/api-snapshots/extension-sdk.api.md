# @openwaggle/extension-sdk

Package path: `packages/extension-sdk`

## Export `.`

Types: `dist/index.d.ts`

### Declarations from `dist/index.d.ts`

```ts
export type * from './agent-loop.js';
export { OPENWAGGLE_EXTENSION, OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
export type * from './context.js';
export { createNoopExtensionSurfaceSdk, createOpenWaggleExtensionSharedModules, createOpenWaggleExtensionSurfaceContext, } from './context.js';
export type * from './docs.js';
export type * from './json.js';
export type * from './manifest.js';
export { defineExtensionManifest } from './manifest.js';
export type * from './sdk-types.js';
export type * from './syntax.js';
export { createPlainExtensionSyntaxResult } from './syntax.js';
export type * from './theme.js';
export { createOpenWaggleExtensionTheme, extensionThemeCssVariableEntries, OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES, } from './theme.js';
export type * from './types.js';
export type * from './ui.js';
export { createOpenWaggleExtensionUiStylesheet, extensionThemeCssVariableDeclarations, OPENWAGGLE_EXTENSION_UI_ATTRIBUTES, OPENWAGGLE_EXTENSION_UI_CLASS_NAMES, openWaggleExtensionClassName, } from './ui.js';
```

### Declarations from `dist/agent-loop.d.ts`

```ts
export type * from './generated/agent-loop.js';
```

### Declarations from `dist/generated/agent-loop.d.ts`

```ts
import type { JsonValue } from '../json.js';
/** A tool call, and its result once it has one, for a tool renderer. */
export type OpenWaggleToolCallSurfaceInput = {
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
};
/** A custom message for a custom message renderer. */
export type OpenWaggleCustomMessageSurfaceInput = {
    readonly surface: 'custom-message';
    readonly message: {
        readonly name: string;
        readonly payload?: JsonValue;
    };
};
/** An interaction request for an interaction renderer. */
export type OpenWaggleInteractionSurfaceInput = {
    readonly surface: 'interaction';
    readonly interaction: {
        readonly id: string;
        readonly customType: string;
        readonly payload?: JsonValue;
    };
};
/** The transcript a transcript renderer draws. */
export type OpenWaggleTranscriptSurfaceInput = {
    readonly surface: 'transcript';
    readonly transcript: {
        readonly sessionId?: string;
        readonly messageCount: number;
        readonly payload?: JsonValue;
    };
};
/** The status a status widget shows. */
export type OpenWaggleStatusSurfaceInput = {
    readonly surface: 'status';
    readonly status: {
        readonly label: string;
        readonly payload?: JsonValue;
    };
};
/** What the host passes a renderer surface, by surface. */
export type OpenWaggleAgentLoopSurfaceInput = OpenWaggleCustomMessageSurfaceInput | OpenWaggleInteractionSurfaceInput | OpenWaggleStatusSurfaceInput | OpenWaggleToolCallSurfaceInput | OpenWaggleTranscriptSurfaceInput;
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

### Declarations from `dist/constants.d.ts`

```ts
export declare const OPENWAGGLE_EXTENSION_BROKER: {
    readonly CAPABILITY: {
        readonly HOST_CONTEXT: 'openwaggle.host.context';
        readonly STORAGE: 'openwaggle.storage';
        readonly STATE: 'openwaggle.state';
        readonly ACTIONS: 'openwaggle.actions';
        readonly SETTINGS: 'openwaggle.settings';
        readonly DOCS: 'openwaggle.docs';
        readonly RUNTIME: 'openwaggle.runtime';
        readonly RESOURCES: 'openwaggle.resources';
    };
    readonly CAPABILITIES: readonly ("openwaggle.actions" | "openwaggle.docs" | "openwaggle.host.context" | "openwaggle.resources" | "openwaggle.runtime" | "openwaggle.settings" | "openwaggle.state" | "openwaggle.storage")[];
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
    }, {
        readonly capability: "openwaggle.resources";
        readonly methods: readonly ["list-resources", "publish-resource"];
    }];
    readonly METHOD: {
        readonly GET_SCOPE: 'get-scope';
        readonly GET: 'get';
        readonly SET: 'set';
        readonly DELETE: 'delete';
        readonly LIST: 'list';
        readonly GET_STATE: 'get-state';
        readonly READ_STATE: 'read-state';
        readonly SELECT_PROJECT: 'select-project';
        readonly GET_SETTINGS: 'get-settings';
        readonly UPDATE_SETTINGS: 'update-settings';
        readonly GET_SETTING: 'get-setting';
        readonly UPDATE_SETTING: 'update-setting';
        readonly DISCOVER_DOCS: 'discover-docs';
        readonly RESOLVE_DOCS_TOPIC: 'resolve-docs-topic';
        readonly REGISTER_CONTRIBUTION: 'register-contribution';
        readonly UNREGISTER_CONTRIBUTION: 'unregister-contribution';
        readonly LIST_RESOURCES: 'list-resources';
        readonly PUBLISH_RESOURCE: 'publish-resource';
    };
    readonly METHODS: readonly ("delete" | "discover-docs" | "get" | "get-scope" | "get-setting" | "get-settings" | "get-state" | "list" | "list-resources" | "publish-resource" | "read-state" | "register-contribution" | "resolve-docs-topic" | "select-project" | "set" | "unregister-contribution" | "update-setting" | "update-settings")[];
    readonly FAILURE_CODE: {
        readonly INVALID_INPUT: 'invalid-input';
        readonly INVALID_PAYLOAD: 'invalid-payload';
        readonly UNKNOWN_EXTENSION: 'unknown-extension';
        readonly DISABLED_EXTENSION: 'disabled-extension';
        readonly UNKNOWN_CONTRIBUTION: 'unknown-contribution';
        readonly UNDECLARED_CAPABILITY: 'undeclared-capability';
        readonly UNDECLARED_METHOD: 'undeclared-method';
        readonly UNDECLARED_SCOPE: 'undeclared-scope';
        readonly OUT_OF_SCOPE: 'out-of-scope';
        readonly UNSUPPORTED_CAPABILITY: 'unsupported-capability';
        readonly UNSUPPORTED_METHOD: 'unsupported-method';
        readonly TRANSPORT_FAILED: 'transport-failed';
    };
    readonly FAILURE_CODES: readonly ("disabled-extension" | "invalid-input" | "invalid-payload" | "out-of-scope" | "transport-failed" | "undeclared-capability" | "undeclared-method" | "undeclared-scope" | "unknown-contribution" | "unknown-extension" | "unsupported-capability" | "unsupported-method")[];
    readonly OUTCOME: {
        readonly SUCCEEDED: 'succeeded';
        readonly REJECTED: 'rejected';
    };
    readonly OUTCOMES: readonly ("rejected" | "succeeded")[];
    readonly STATE_SELECTOR: {
        readonly CURRENT_PROJECT: 'current-project';
        readonly CURRENT_SESSION: 'current-session';
        readonly CURRENT_BRANCH: 'current-branch';
        readonly RECENT_PROJECTS: 'recent-projects';
        readonly MODEL_PREFERENCES: 'model-preferences';
    };
    readonly STATE_SELECTORS: readonly ("current-branch" | "current-project" | "current-session" | "model-preferences" | "recent-projects")[];
    readonly SETTING_KEY: {
        readonly MODEL_PREFERENCES: 'model-preferences';
        readonly PROJECT_DISPLAY_NAME: 'project-display-name';
    };
    readonly SETTING_KEYS: readonly ("model-preferences" | "project-display-name")[];
};
export declare const OPENWAGGLE_EXTENSION: {
    readonly MANIFEST_FILE: 'openwaggle.extension.json';
    readonly SDK_VERSION: '0.1.0';
    readonly PROJECT_ROOT_SEGMENTS: readonly ['.openwaggle', 'extensions'];
    readonly GLOBAL_EXTENSIONS_DIR: 'extensions';
    readonly SCOPE: {
        readonly GLOBAL_KIND: 'global';
        readonly PROJECT_KIND: 'project';
        readonly GLOBAL_ID: 'global';
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
    readonly PATTERNS: {
        readonly WINDOWS_ABSOLUTE_PATH: RegExp;
        readonly ID: RegExp;
        readonly CONTRIBUTION_ID: RegExp;
        readonly SEMVER_VERSION: RegExp;
    };
    readonly PATH: {
        readonly NUL_CHARACTER: '\0';
        readonly POSIX_SEPARATOR: '/';
        readonly WINDOWS_SEPARATOR: '\\';
        readonly RELATIVE_PARENT_SEGMENT: '..';
        readonly CURRENT_DIRECTORY_SEGMENT: '.';
    };
    readonly RUNTIME_MODULE_PROTOCOL: {
        readonly MODULE_CONTEXT_SEGMENT: '__context__';
    };
    readonly CAPABILITY_SCOPES: readonly ['app', 'project', 'session', 'branch'];
    readonly CONTRIBUTION_FAMILY: {
        readonly COMMANDS: 'commands';
        readonly SLASH_COMMANDS: 'slashCommands';
        readonly ROUTES: 'routes';
        readonly SETTINGS_SECTIONS: 'settingsSections';
        readonly SIDE_PANELS: 'sidePanels';
        readonly DIALOGS: 'dialogs';
        readonly TRANSCRIPT_RENDERERS: 'transcriptRenderers';
        readonly TOOL_RENDERERS: 'toolRenderers';
        readonly CUSTOM_MESSAGE_RENDERERS: 'customMessageRenderers';
        readonly INTERACTION_RENDERERS: 'interactionRenderers';
        readonly STATUS_WIDGETS: 'statusWidgets';
        readonly SESSION_SUMMARY_SECTIONS: 'sessionSummarySections';
    };
    readonly CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands", "routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets", "sessionSummarySections"];
    readonly COMMAND_CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands"];
    readonly CONTRIBUTION_RUNTIME: {
        readonly FEDERATED_MODULE: 'federated-module';
        readonly TRUSTED_RENDERER: 'trusted-renderer';
    };
    readonly CONTRIBUTION_RUNTIMES: readonly ("federated-module" | "trusted-renderer")[];
    readonly EXECUTION_PLACEMENT: {
        readonly HOST_RENDERER: 'host-renderer';
        readonly FRAME: 'frame';
    };
    readonly EXECUTION_PLACEMENTS: readonly ("frame" | "host-renderer")[];
    readonly STORAGE: {
        readonly KIND: {
            readonly STATE: 'state';
            readonly CONFIG: 'config';
        };
        readonly KINDS: readonly ("config" | "state")[];
        readonly SCOPE: {
            readonly GLOBAL_KIND: 'global';
            readonly PROJECT_KIND: 'project';
            readonly GLOBAL_ID: 'global';
        };
        readonly SCOPE_KINDS: readonly ("global" | "project")[];
        readonly KEY_MAX_LENGTH: 160;
    };
    readonly ENTRY_CONTRIBUTION_FAMILIES: readonly ["routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly SLOT_CONTRIBUTION_FAMILIES: readonly ["settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly INSTALL_SOURCE: {
        readonly PREBUILT: 'prebuilt';
        readonly LOCAL_BUILD: 'local-build';
    };
    readonly INSTALL_SOURCES: readonly ("local-build" | "prebuilt")[];
    readonly RUNTIME_REQUIREMENT_TYPE: {
        readonly BINARY: 'binary';
        readonly COMMAND: 'command';
    };
    readonly RUNTIME_REQUIREMENT_TYPES: readonly ("binary" | "command")[];
    readonly NETWORK_ACCESS_MODE: {
        readonly BROKERED: 'brokered';
        readonly RESTRICTED: 'restricted';
        readonly DIRECT: 'direct';
    };
    readonly NETWORK_ACCESS_MODES: readonly ("brokered" | "direct" | "restricted")[];
};
```

### Declarations from `dist/context.d.ts`

```ts
import type { ExtensionBrokerSdk } from './sdk-types.js';
import type { JsonValue } from './json.js';
import { type OpenWaggleExtensionSyntaxSdk } from './syntax.js';
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
    /** Present when the host resolved this surface for a specific Session. */
    readonly sessionId?: string;
    readonly theme: OpenWaggleExtensionTheme;
}
export interface OpenWaggleExtensionSurfaceSdk {
    readonly sendAction: (actionId: string, payload?: JsonValue) => Promise<void>;
    readonly respondInteraction: (value: JsonValue | null) => Promise<void>;
    readonly syntax: OpenWaggleExtensionSyntaxSdk;
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

### Declarations from `dist/sdk-types.d.ts`

```ts
import type { JsonValue } from './json.js';
import type { ExtensionActionSelectProjectResult, ExtensionDocsDiscoverPayload, ExtensionDocsDiscoverResult, ExtensionDocsResolveTopicPayload, ExtensionDocsResolveTopicResult, ExtensionInvokeFailure, ExtensionInvokeInput, ExtensionInvokeResult, ExtensionInvokeScope, ExtensionInvokeSuccess, ExtensionModelPreferencesSettingsPatch, ExtensionRuntimeRegisterContributionPayload, ExtensionRuntimeRegisterContributionResult, ExtensionRuntimeUnregisterContributionPayload, ExtensionRuntimeUnregisterContributionResult, ExtensionSessionResourcePublishPayload, ExtensionSessionResourcePublishResult, ExtensionSessionResourcesListPayload, ExtensionSessionResourcesListResult, ExtensionSettingsGetResult, ExtensionSettingsGetSettingResult, ExtensionSettingsUpdatePayload, ExtensionSettingsUpdateResult, ExtensionSettingsUpdateSettingResult, ExtensionStateCurrentBranchReadResult, ExtensionStateCurrentProjectReadResult, ExtensionStateCurrentSessionReadResult, ExtensionStateModelPreferencesReadResult, ExtensionStateReadResult, ExtensionStateRecentProjectsReadResult, ExtensionStorageDeleteResult, ExtensionStorageGetResult, ExtensionStorageListResult, ExtensionStorageSetResult } from './types.js';
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
export type ExtensionSessionResourcesListOperationResult = ExtensionOperationSuccess<ExtensionSessionResourcesListResult> | ExtensionInvokeFailure;
export type ExtensionSessionResourcePublishOperationResult = ExtensionOperationSuccess<ExtensionSessionResourcePublishResult> | ExtensionInvokeFailure;
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
    readonly resources: ExtensionOpenWaggleResourcesSdk;
}
export type ExtensionSessionInvokeScope = Extract<ExtensionInvokeScope, {
    readonly kind: 'session';
}>;
export interface ExtensionOpenWaggleResourcesSdk {
    readonly list: (scope: ExtensionSessionInvokeScope, input?: ExtensionSessionResourcesListPayload) => Promise<ExtensionInvokeResult<ExtensionSessionResourcesListResult>>;
    readonly publish: (scope: ExtensionSessionInvokeScope, resource: ExtensionSessionResourcePublishPayload) => Promise<ExtensionInvokeResult<ExtensionSessionResourcePublishResult>>;
}
/** @deprecated Use {@link ExtensionOpenWaggleResourcesSdk}. */
export type ExtensionOpenWaggleSessionResourcesSdk = ExtensionOpenWaggleResourcesSdk;
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
export type * from './validation-types.js';
```

### Declarations from `dist/contribution-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION } from './constants.js';
import type { ExtensionContributionRegistration, ExtensionContributionUnregistration } from './generated/manifest.js';
export type { ExtensionCapabilityScope, ExtensionContributionFamily, ExtensionContributionMatchView, ExtensionContributionRuntime, ExtensionContributionTargetView, ExtensionExecutionPlacement, ExtensionInstallSource, } from './generated/manifest.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionNetworkAccessMode = ConstantValue<typeof OPENWAGGLE_EXTENSION.NETWORK_ACCESS_MODE>;
export type ExtensionRuntimeRegisterContributionPayload = ExtensionContributionRegistration;
export type ExtensionRuntimeUnregisterContributionPayload = ExtensionContributionUnregistration;
```

### Declarations from `dist/generated/manifest.d.ts`

```ts
/** The scopes a broker capability can be called in. */
export type ExtensionCapabilityScope = 'app' | 'branch' | 'project' | 'session';
/** A contribution family: the manifest key a contribution is declared under. */
export type ExtensionContributionFamily = 'commands' | 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'routes' | 'sessionSummarySections' | 'settingsSections' | 'sidePanels' | 'slashCommands' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
/** How a contribution's entry module runs. */
export type ExtensionContributionRuntime = 'federated-module' | 'trusted-renderer';
/** Where a contribution's entry module runs. */
export type ExtensionExecutionPlacement = 'frame' | 'host-renderer';
/** Whether OpenWaggle installs the package's prebuilt artifacts or builds it locally. */
export type ExtensionInstallSource = 'local-build' | 'prebuilt';
/** The projects and sessions a contribution is limited to. */
export type ExtensionContributionTargetView = {
    readonly projectPaths?: readonly string[];
    readonly sessionIds?: readonly string[];
};
/** The tool calls, custom messages and interactions a renderer contribution handles. */
export type ExtensionContributionMatchView = {
    readonly toolNames?: readonly string[];
    readonly customMessageNames?: readonly string[];
    readonly interactionKinds?: readonly string[];
};
/** A broker capability the extension uses, with the methods and scopes it calls. */
export type ExtensionCapabilityDeclaration = {
    readonly id: string;
    readonly methods?: readonly string[];
    readonly scopes?: readonly ExtensionCapabilityScope[];
};
/** A command or slash command. */
export type ExtensionCommandContribution = {
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly id: string;
    readonly title: string;
    readonly category?: string;
    readonly target?: ExtensionContributionTargetView;
};
/**
 * A contribution that mounts an entry module: a route, or a settings section, dialog, renderer
 * or status widget.
 */
export type ExtensionSurfaceContribution = {
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly id: string;
    readonly title: string;
    readonly runtime: ExtensionContributionRuntime;
    readonly execution: ExtensionExecutionPlacement;
    readonly entry: string;
    readonly target?: ExtensionContributionTargetView;
    readonly matches?: ExtensionContributionMatchView;
};
/** A side panel's Panel rail icon: a Lucide icon name in kebab-case, or a package `.svg` file. */
export type ExtensionSidePanelIcon = string | {
    readonly svg: string;
};
/** A side panel, with its optional Panel rail icon. */
export type ExtensionSidePanelContribution = {
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly id: string;
    readonly title: string;
    readonly runtime: ExtensionContributionRuntime;
    readonly execution: ExtensionExecutionPlacement;
    readonly entry: string;
    readonly target?: ExtensionContributionTargetView;
    readonly matches?: ExtensionContributionMatchView;
    readonly icon?: ExtensionSidePanelIcon;
};
/** Any contribution that mounts an entry module. */
export type ExtensionEntryContribution = ExtensionSidePanelContribution | ExtensionSurfaceContribution;
/** A row of a Session Summary section. */
export type ExtensionSessionSummaryRow = {
    readonly id: string;
    readonly label: string;
    readonly value?: string;
    readonly badge?: string;
    readonly count?: number;
    readonly resourceId?: string;
    readonly action?: {
        readonly family: 'commands' | 'dialogs' | 'sidePanels';
        readonly contributionId: string;
    };
};
/** Whether a Session Summary section starts expanded, can collapse, and collapses by itself. */
export type ExtensionSessionSummaryDisclosure = {
    readonly defaultExpanded?: boolean;
    readonly collapsible?: boolean;
    readonly autoCollapseAfterMs?: number;
};
/** The status a Session Summary section shows. */
export type ExtensionSessionSummaryState = {
    readonly status: 'failure';
    readonly message: string;
} | {
    readonly status: 'live' | 'loading';
    readonly message?: string;
} | {
    readonly status: 'ready';
};
/** A declarative Session Summary section. */
export type ExtensionSessionSummaryContribution = {
    readonly id: string;
    readonly title: string;
    readonly placement?: 'context' | 'coordination' | 'details';
    readonly target?: ExtensionContributionTargetView;
    readonly disclosure?: ExtensionSessionSummaryDisclosure;
    readonly state?: ExtensionSessionSummaryState;
    readonly rows: readonly ExtensionSessionSummaryRow[];
};
/** Every contribution a manifest declares, by family. */
export type ExtensionContributions = {
    readonly commands?: readonly ExtensionCommandContribution[];
    readonly slashCommands?: readonly ExtensionCommandContribution[];
    readonly routes?: readonly ExtensionSurfaceContribution[];
    readonly settingsSections?: readonly ExtensionSurfaceContribution[];
    readonly sidePanels?: readonly ExtensionSidePanelContribution[];
    readonly dialogs?: readonly ExtensionSurfaceContribution[];
    readonly transcriptRenderers?: readonly ExtensionSurfaceContribution[];
    readonly toolRenderers?: readonly ExtensionSurfaceContribution[];
    readonly customMessageRenderers?: readonly ExtensionSurfaceContribution[];
    readonly interactionRenderers?: readonly ExtensionSurfaceContribution[];
    readonly statusWidgets?: readonly ExtensionSurfaceContribution[];
    readonly sessionSummarySections?: readonly ExtensionSessionSummaryContribution[];
};
/** A contribution registered at runtime, with its family. */
export type ExtensionContributionRegistration = {
    readonly family: 'commands' | 'slashCommands';
    readonly contribution: ExtensionCommandContribution;
} | {
    readonly family: 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'settingsSections' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
    readonly contribution: ExtensionSurfaceContribution;
} | {
    readonly family: 'routes';
    readonly contribution: ExtensionSurfaceContribution;
} | {
    readonly family: 'sessionSummarySections';
    readonly contribution: ExtensionSessionSummaryContribution;
} | {
    readonly family: 'sidePanels';
    readonly contribution: ExtensionSidePanelContribution;
};
/** A runtime contribution to remove, by family and id. */
export type ExtensionContributionUnregistration = {
    readonly family: ExtensionContributionFamily;
    readonly contributionId: string;
};
/** A binary or package command the extension needs before it runs. */
export type ExtensionRuntimeRequirementDeclaration = {
    readonly id: string;
    readonly label: string;
    readonly kind?: 'binary' | 'command';
    readonly command?: string;
    readonly binary?: string;
};
/** A documentation topic the extension ships. */
export type ExtensionDocsTopicDeclaration = {
    readonly id: string;
    readonly title: string;
    readonly path: string;
    readonly description?: string;
    readonly aliases?: readonly string[];
    readonly keywords?: readonly string[];
};
/** An `openwaggle.extension.json` manifest. */
export type OpenWaggleExtensionManifest = {
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
        readonly topics?: readonly ExtensionDocsTopicDeclaration[];
    };
    readonly network?: {
        readonly origins: readonly string[];
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
};
```

### Declarations from `dist/core-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { ExtensionCapabilityAuditEntry, ExtensionInvokeFailure } from './generated/broker.js';
export type { ExtensionCapabilityAuditEntry, ExtensionHostContextResult, ExtensionInvokeError, ExtensionInvokeFailure, ExtensionInvokeFailureCode, ExtensionInvokeInput, ExtensionInvokeOutcome, ExtensionInvokeScope, } from './generated/broker.js';
export type { ExtensionInvokeSuccessValue } from './generated/broker-result.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionBrokerCapability = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY>;
export type ExtensionBrokerMethod = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.METHOD>;
export type ExtensionStateSelector = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR>;
export type ExtensionSettingsKey = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY>;
/**
 * A broker success whose value one operation's decoder has narrowed. The default is a value not
 * decoded yet.
 */
export interface ExtensionInvokeSuccess<TValue = unknown> {
    readonly ok: true;
    readonly value: TValue;
    readonly audit: ExtensionCapabilityAuditEntry;
}
export type ExtensionInvokeResult<TValue = unknown> = ExtensionInvokeSuccess<TValue> | ExtensionInvokeFailure;
```

### Declarations from `dist/generated/broker.d.ts`

```ts
/** Why a broker call failed. */
export type ExtensionInvokeFailureCode = 'disabled-extension' | 'invalid-input' | 'invalid-payload' | 'out-of-scope' | 'transport-failed' | 'undeclared-capability' | 'undeclared-method' | 'undeclared-scope' | 'unknown-contribution' | 'unknown-extension' | 'unsupported-capability' | 'unsupported-method';
/** Whether the broker ran a call or refused it. */
export type ExtensionInvokeOutcome = 'rejected' | 'succeeded';
/** Where a broker call applies: the app, a project, a session or a branch. */
export type ExtensionInvokeScope = {
    readonly kind: 'app';
} | {
    readonly kind: 'branch';
    readonly projectPath: string;
    readonly sessionId: string;
    readonly branchId: string;
} | {
    readonly kind: 'project';
    readonly projectPath: string;
} | {
    readonly kind: 'session';
    readonly projectPath: string;
    readonly sessionId: string;
};
/** One broker call as the host receives it. */
export type ExtensionInvokeInput = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly payload?: unknown;
};
/** Why the broker refused or failed a call. */
export type ExtensionInvokeError = {
    readonly code: ExtensionInvokeFailureCode;
    readonly message: string;
    readonly issues?: readonly string[];
};
/** The audit record the broker keeps for every call. */
export type ExtensionCapabilityAuditEntry = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly outcome: ExtensionInvokeOutcome;
    readonly timestamp: number;
    readonly failureCode?: ExtensionInvokeFailureCode;
};
/** A broker call that failed. */
export type ExtensionInvokeFailure = {
    readonly ok: false;
    readonly error: ExtensionInvokeError;
    readonly audit?: ExtensionCapabilityAuditEntry;
};
/** The result of `hostContext.getScope`: the scope the host resolved for the contribution. */
export type ExtensionHostContextResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.host.context';
    readonly method: 'get-scope';
    readonly scope: ExtensionInvokeScope;
    readonly declaredScopes: readonly ('app' | 'branch' | 'project' | 'session')[];
};
```

### Declarations from `dist/generated/broker-result.d.ts`

```ts
import type { ExtensionHostContextResult } from './broker.js';
import type { ExtensionDocsDiscoverResult, ExtensionDocsResolveTopicResult } from './docs.js';
import type { ExtensionActionSelectProjectResult, ExtensionSessionResourcePublishResult, ExtensionSessionResourcesListResult, ExtensionSettingsGetResult, ExtensionSettingsGetSettingResult, ExtensionSettingsUpdateResult, ExtensionSettingsUpdateSettingResult, ExtensionStateCurrentBranchReadResult, ExtensionStateCurrentProjectReadResult, ExtensionStateCurrentSessionReadResult, ExtensionStateModelPreferencesReadResult, ExtensionStateReadResult, ExtensionStateRecentProjectsReadResult } from './openwaggle.js';
import type { ExtensionRuntimeRegisterContributionResult, ExtensionRuntimeUnregisterContributionResult, ExtensionStorageDeleteResult, ExtensionStorageGetResult, ExtensionStorageListResult, ExtensionStorageSetResult } from './storage.js';
/** Every result value the broker returns, one per capability method. */
export type ExtensionInvokeSuccessValue = ExtensionActionSelectProjectResult | ExtensionDocsDiscoverResult | ExtensionDocsResolveTopicResult | ExtensionHostContextResult | ExtensionRuntimeRegisterContributionResult | ExtensionRuntimeUnregisterContributionResult | ExtensionSessionResourcePublishResult | ExtensionSessionResourcesListResult | ExtensionSettingsGetResult | ExtensionSettingsGetSettingResult | ExtensionSettingsUpdateResult | ExtensionSettingsUpdateSettingResult | ExtensionStateCurrentBranchReadResult | ExtensionStateCurrentProjectReadResult | ExtensionStateCurrentSessionReadResult | ExtensionStateModelPreferencesReadResult | ExtensionStateReadResult | ExtensionStateRecentProjectsReadResult | ExtensionStorageDeleteResult | ExtensionStorageGetResult | ExtensionStorageListResult | ExtensionStorageSetResult;
```

### Declarations from `dist/generated/docs.d.ts`

```ts
export type ExtensionDocsDiscoverPayload = {
    readonly projectPaths?: readonly string[];
    readonly includeExtensions?: boolean;
};
export type ExtensionDocsResolveTopicPayload = {
    readonly topic: string;
};
export type ExtensionDocsDiscoverResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.docs';
    readonly method: 'discover-docs';
    readonly docs: ExtensionDocsDiscoveryView;
};
export type ExtensionDocsResolveTopicResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.docs';
    readonly method: 'resolve-docs-topic';
    readonly resolvedTopic: FirstPartyDocsTopicSummary | null;
};
export type ExtensionDocsDiscoveryView = {
    readonly generatedAt: string;
    readonly bundlePath: string;
    readonly firstPartyTopics: readonly FirstPartyDocsTopicSummary[];
    readonly extensionTopics: readonly {
        readonly topic: string;
        readonly localTopic: string;
        readonly title: string;
        readonly description?: string;
        readonly path: string;
        readonly aliases: readonly string[];
        readonly keywords: readonly string[];
        readonly contentHash: string | null;
        readonly provenance: {
            readonly extensionId: string;
            readonly extensionName: string | null;
            readonly extensionVersion: string | null;
            readonly scope: {
                readonly kind: 'global' | 'project';
                readonly label: string;
                readonly projectPath?: string;
            };
            readonly packagePath: string;
            readonly manifestPath: string;
            readonly path: string;
            readonly packageContentHash: string | null;
            readonly trust: 'trusted' | 'unknown' | 'untrusted';
            readonly lifecycle: 'disabled' | 'enabled' | 'unavailable';
        };
        readonly diagnostics: readonly {
            readonly severity: 'error' | 'warning';
            readonly code: string;
            readonly message: string;
            readonly path?: string;
        }[];
    }[];
    readonly diagnostics: readonly {
        readonly severity: 'error' | 'warning';
        readonly code: string;
        readonly message: string;
        readonly path?: string;
    }[];
};
export type FirstPartyDocsTopicSummary = {
    readonly topic: string;
    readonly source: 'openwaggle' | 'pi';
    readonly group: string;
    readonly title: string;
    readonly description?: string;
    readonly section?: string;
    readonly order: number;
    readonly path: string;
    readonly bundlePath: string;
    readonly sourcePath: string;
    readonly aliases: readonly string[];
    readonly keywords: readonly string[];
    readonly contentHash: string;
};
```

### Declarations from `dist/generated/openwaggle.d.ts`

```ts
import type { ExtensionInvokeScope } from './broker.js';
export type ExtensionModelPrefs = {
    readonly selectedModel: string;
    readonly favoriteModels: readonly string[];
    readonly enabledModels: readonly string[];
    readonly thinkingLevel: string;
};
export type ExtensionProjectView = {
    readonly projectPath: string;
    readonly displayName: string | null;
    readonly active: boolean;
};
export type ExtensionSessionView = {
    readonly sessionId: string;
    readonly title: string;
    readonly projectPath: string | null;
};
export type ExtensionBranchView = {
    readonly branchId: string;
    readonly sessionId: string;
    readonly name: string;
    readonly main: boolean;
    readonly archived: boolean;
};
export type ExtensionStateReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'get-state';
    readonly scope: ExtensionInvokeScope;
    readonly activeProjectPath: string | null;
    readonly currentProject: ExtensionProjectView | null;
    readonly currentSession: ExtensionSessionView | null;
    readonly currentBranch: ExtensionBranchView | null;
    readonly recentProjects: readonly string[];
    readonly modelPreferences: ExtensionModelPrefs;
};
export type ExtensionStateCurrentProjectReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'read-state';
    readonly scope: ExtensionInvokeScope;
    readonly selector: 'current-branch' | 'current-project' | 'current-session' | 'model-preferences' | 'recent-projects';
    readonly value: {
        readonly active: boolean;
        readonly displayName: string | null;
        readonly projectPath: string;
    } | null;
};
export type ExtensionStateCurrentSessionReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'read-state';
    readonly scope: ExtensionInvokeScope;
    readonly selector: 'current-branch' | 'current-project' | 'current-session' | 'model-preferences' | 'recent-projects';
    readonly value: {
        readonly projectPath: string | null;
        readonly sessionId: string;
        readonly title: string;
    } | null;
};
export type ExtensionStateCurrentBranchReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'read-state';
    readonly scope: ExtensionInvokeScope;
    readonly selector: 'current-branch' | 'current-project' | 'current-session' | 'model-preferences' | 'recent-projects';
    readonly value: {
        readonly archived: boolean;
        readonly branchId: string;
        readonly main: boolean;
        readonly name: string;
        readonly sessionId: string;
    } | null;
};
export type ExtensionStateRecentProjectsReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'read-state';
    readonly scope: ExtensionInvokeScope;
    readonly selector: 'current-branch' | 'current-project' | 'current-session' | 'model-preferences' | 'recent-projects';
    readonly value: readonly string[];
};
export type ExtensionStateModelPreferencesReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'read-state';
    readonly scope: ExtensionInvokeScope;
    readonly selector: 'current-branch' | 'current-project' | 'current-session' | 'model-preferences' | 'recent-projects';
    readonly value: {
        readonly enabledModels: readonly string[];
        readonly favoriteModels: readonly string[];
        readonly selectedModel: string;
        readonly thinkingLevel: string;
    };
};
export type ExtensionActionSelectProjectResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.actions';
    readonly method: 'select-project';
    readonly previousProjectPath: string | null;
    readonly projectPath: string;
    readonly recentProjects: readonly string[];
};
export type ExtensionSessionResourceKind = 'change-request' | 'commit' | 'file' | 'image' | 'link' | 'site' | 'tool' | 'web-search';
export type ExtensionSessionResourceRole = 'output' | 'source';
export type ExtensionSessionResourceView = {
    readonly id: string;
    readonly title: string;
    readonly kind: ExtensionSessionResourceKind;
    readonly mimeType: string | null;
    readonly available: boolean;
    readonly isSource: boolean;
    readonly isOutput: boolean;
};
export type ExtensionSessionResourcePublishPayload = {
    readonly key: string;
    readonly title: string;
    readonly kind: 'image' | 'link';
    readonly role: ExtensionSessionResourceRole;
    readonly locator: string;
};
export type ExtensionSessionResourcesListPayload = {
    readonly cursor?: string | null;
    readonly limit?: number;
};
export type ExtensionSessionResourcesListResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.resources';
    readonly sessionId: string;
    readonly method: 'list-resources';
    readonly resources: readonly ExtensionSessionResourceView[];
    readonly total: number;
    readonly nextCursor: string | null;
};
export type ExtensionSessionResourcePublishResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.resources';
    readonly sessionId: string;
    readonly method: 'publish-resource';
    readonly resource: ExtensionSessionResourceView;
};
export type ExtensionSettingsView = {
    readonly modelPreferences: ExtensionModelPrefs;
    readonly projectDisplayNames: Readonly<Record<string, string>>;
};
export type ExtensionModelPreferencesSettingsPatch = {
    readonly selectedModel?: string;
    readonly favoriteModels?: readonly string[];
    readonly enabledModels?: readonly string[];
    /** Accepted for SDK compatibility and ignored: extensions cannot change the thinking level. */
    readonly thinkingLevel?: string;
};
export type ExtensionSettingsUpdatePayload = {
    readonly selectedModel?: string;
    readonly favoriteModels?: readonly string[];
    readonly enabledModels?: readonly string[];
    /** Accepted for SDK compatibility and ignored: extensions cannot change the thinking level. */
    readonly thinkingLevel?: string;
    readonly projectDisplayNames?: Readonly<Record<string, string>>;
};
export type ExtensionSettingsGetResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.settings';
    readonly method: 'get-settings';
    readonly settings: ExtensionSettingsView;
};
export type ExtensionSettingsUpdateResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.settings';
    readonly method: 'update-settings';
    readonly settings: ExtensionSettingsView;
};
export type ExtensionSettingsSelectedValue = {
    readonly key: 'model-preferences';
    readonly value: ExtensionModelPrefs;
} | {
    readonly key: 'project-display-name';
    readonly projectPath: string;
    readonly value: string | null;
};
export type ExtensionSettingsGetSettingResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.settings';
    readonly method: 'get-setting';
    readonly setting: ExtensionSettingsSelectedValue;
};
export type ExtensionSettingsUpdateSettingResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.settings';
    readonly method: 'update-setting';
    readonly setting: ExtensionSettingsSelectedValue;
};
```

### Declarations from `dist/generated/storage.d.ts`

```ts
import type { JsonValue } from '../json.js';
/** Which package store a call uses: package state or package configuration. */
export type ExtensionStorageKind = 'config' | 'state';
/** Which storage scope a call reads or writes. */
export type ExtensionStorageScopeSelector = 'global' | 'project';
/** The storage scope a result belongs to. */
export type ExtensionStorageScope = {
    readonly kind: 'global';
} | {
    readonly kind: 'project';
    readonly projectPath: string;
};
export type ExtensionStorageGetResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.storage';
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
    readonly method: 'get';
    readonly key: string;
    readonly value: JsonValue;
};
export type ExtensionStorageSetResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.storage';
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
    readonly method: 'set';
    readonly key: string;
    readonly value: JsonValue;
    readonly createdAt: number;
    readonly updatedAt: number;
};
export type ExtensionStorageDeleteResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.storage';
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
    readonly method: 'delete';
    readonly key: string;
    readonly deleted: true;
};
export type ExtensionStorageListResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.storage';
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
    readonly method: 'list';
    readonly keys: readonly string[];
};
export type ExtensionRuntimeRegisterContributionResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.runtime';
    readonly family: 'commands' | 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'routes' | 'sessionSummarySections' | 'settingsSections' | 'sidePanels' | 'slashCommands' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
    readonly method: 'register-contribution';
    readonly registeredContributionId: string;
};
export type ExtensionRuntimeUnregisterContributionResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.runtime';
    readonly family: 'commands' | 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'routes' | 'sessionSummarySections' | 'settingsSections' | 'sidePanels' | 'slashCommands' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
    readonly method: 'unregister-contribution';
    readonly unregisteredContributionId: string;
    readonly unregistered: boolean;
};
```

### Declarations from `dist/openwaggle-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { ExtensionInvokeScope, ExtensionStateSelector } from './core-types.js';
export type { ExtensionDocsDiscoverPayload, ExtensionDocsDiscoverResult, ExtensionDocsResolveTopicPayload, ExtensionDocsResolveTopicResult, } from './generated/docs.js';
export type * from './generated/openwaggle.js';
/** The result of reading one state selector; each `ExtensionState*ReadResult` narrows it. */
export interface ExtensionSelectedStateReadResult<TValue> {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE;
    readonly scope: ExtensionInvokeScope;
    readonly selector: ExtensionStateSelector;
    readonly value: TValue;
}
```

### Declarations from `dist/registry-types.d.ts`

```ts
import type { ExtensionCapabilityScope, ExtensionContributionFamily, ExtensionContributionMatchView, ExtensionContributionRuntime, ExtensionContributionTargetView, ExtensionExecutionPlacement } from './contribution-types.js';
import type { ExtensionSessionSummaryDisclosure, ExtensionSessionSummaryRow, ExtensionSessionSummaryState } from './generated/manifest.js';
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
    readonly sessionSummary?: {
        readonly placement: 'context' | 'coordination' | 'details';
        readonly disclosure?: ExtensionSessionSummaryDisclosure;
        readonly state?: ExtensionSessionSummaryState;
        readonly rows: readonly ExtensionSessionSummaryRow[];
    };
}
```

### Declarations from `dist/runtime-types.d.ts`

```ts
export type { ExtensionRuntimeRegisterContributionResult, ExtensionRuntimeUnregisterContributionResult, } from './generated/storage.js';
```

### Declarations from `dist/storage-types.d.ts`

```ts
import type { ExtensionStorageGetResult } from './generated/storage.js';
export type { ExtensionStorageDeleteResult, ExtensionStorageGetResult, ExtensionStorageKind, ExtensionStorageListResult, ExtensionStorageScope, ExtensionStorageScopeSelector, ExtensionStorageSetResult, } from './generated/storage.js';
/** The fields every storage result carries. */
export type ExtensionStorageResultBase = Pick<ExtensionStorageGetResult, 'extensionId' | 'contributionId' | 'capability' | 'storageKind' | 'storageScope'>;
```

### Declarations from `dist/validation-types.d.ts`

```ts
/**
 * One reason a value failed validation. `path` is the dotted field path the host reports in its
 * diagnostics, such as `contributions.sidePanels.0.icon`, with array items by index, and
 * `(root)` for the value itself.
 */
export interface ExtensionValidationIssue {
    readonly path: string;
    readonly message: string;
}
/** What a `validate*` helper returns: the valid value, or every issue it found. */
export type ExtensionValidationResult<TValue> = {
    readonly success: true;
    readonly value: TValue;
} | {
    readonly success: false;
    readonly issues: readonly ExtensionValidationIssue[];
};
```

### Declarations from `dist/syntax.d.ts`

```ts
export type OpenWaggleExtensionSyntaxPriority = 'visible' | 'near-viewport' | 'background';
export interface OpenWaggleExtensionSyntaxHighlightInput {
    readonly source: string;
    readonly language?: string;
    readonly path?: string;
    readonly priority?: OpenWaggleExtensionSyntaxPriority;
}
export interface OpenWaggleExtensionSyntaxToken {
    readonly content: string;
    readonly color?: string;
    readonly backgroundColor?: string;
    readonly fontStyle?: number;
}
export interface OpenWaggleExtensionSyntaxHighlightResult {
    readonly status: 'highlighted' | 'plain-text';
    readonly language: string;
    readonly foreground?: string;
    readonly background?: string;
    readonly lines: readonly (readonly OpenWaggleExtensionSyntaxToken[])[];
    readonly diagnostic?: string;
}
export interface OpenWaggleExtensionSyntaxHighlightOptions {
    readonly signal?: AbortSignal;
}
export interface OpenWaggleExtensionSyntaxSdk {
    readonly highlight: (input: OpenWaggleExtensionSyntaxHighlightInput, options?: OpenWaggleExtensionSyntaxHighlightOptions) => Promise<OpenWaggleExtensionSyntaxHighlightResult>;
}
export declare function createPlainExtensionSyntaxResult(input: {
    readonly source: string;
    readonly language?: string;
    readonly diagnostic?: string;
}): OpenWaggleExtensionSyntaxHighlightResult;
```

### Declarations from `dist/theme.d.ts`

```ts
import type { CreateOpenWaggleExtensionThemeOptions, OpenWaggleExtensionTheme, OpenWaggleExtensionThemeCssVariableEntry } from './theme-types.js';
export { OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES } from './theme-data.js';
export type { CreateOpenWaggleExtensionThemeOptions, ExtensionThemeCssVariableResolver, OpenWaggleExtensionColorScheme, OpenWaggleExtensionTheme, OpenWaggleExtensionThemeCssVariableEntry, OpenWaggleExtensionThemeCssVariables, OpenWaggleExtensionThemeTokens, OpenWaggleExtensionTypeScaleEntry, } from './theme-types.js';
export declare function createOpenWaggleExtensionTheme(options?: CreateOpenWaggleExtensionThemeOptions): OpenWaggleExtensionTheme;
export declare function extensionThemeCssVariableEntries(theme: OpenWaggleExtensionTheme): readonly OpenWaggleExtensionThemeCssVariableEntry[];
```

### Declarations from `dist/theme-types.d.ts`

```ts
export type OpenWaggleExtensionColorScheme = 'dark' | 'light' | 'high-contrast-dark' | 'high-contrast-light';
export interface OpenWaggleExtensionTypeScaleEntry {
    readonly fontSize: string;
    readonly lineHeight: string;
}
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
        readonly dangerText: string;
        readonly warning: string;
        readonly info: string;
        readonly infoText: string;
        readonly review: string;
        readonly plan: string;
        readonly progress: string;
        readonly neutral: string;
    };
    readonly typography: {
        readonly sansFamily: string;
        readonly monoFamily: string;
        readonly typeScale: {
            readonly xs: OpenWaggleExtensionTypeScaleEntry;
            readonly sm: OpenWaggleExtensionTypeScaleEntry;
            readonly base: OpenWaggleExtensionTypeScaleEntry;
            readonly lg: OpenWaggleExtensionTypeScaleEntry;
            readonly xl: OpenWaggleExtensionTypeScaleEntry;
            readonly twoXl: OpenWaggleExtensionTypeScaleEntry;
        };
    };
    readonly spacing: {
        readonly unit: string;
    };
    readonly radius: {
        readonly xs: string;
        readonly sm: string;
        readonly md: string;
        readonly lg: string;
        readonly xl: string;
        readonly twoXl: string;
        readonly threeXl: string;
        readonly fourXl: string;
    };
    readonly shadow: {
        readonly twoXs: string;
        readonly xs: string;
        readonly sm: string;
        readonly md: string;
        readonly lg: string;
        readonly xl: string;
        readonly twoXl: string;
    };
    readonly focus: {
        readonly ring: string;
        readonly shadow: string;
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
    readonly colorScheme?: OpenWaggleExtensionColorScheme;
    readonly resolveCssVariable?: ExtensionThemeCssVariableResolver;
}
```

### Declarations from `dist/theme-data.d.ts`

```ts
export declare const OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES: {
    readonly color: {
        readonly background: '--ow-color-background';
        readonly surface: '--ow-color-surface';
        readonly surfaceRaised: '--ow-color-surface-raised';
        readonly surfaceHover: '--ow-color-surface-hover';
        readonly surfaceActive: '--ow-color-surface-active';
        readonly border: '--ow-color-border';
        readonly borderStrong: '--ow-color-border-strong';
        readonly text: '--ow-color-text';
        readonly textSubtle: '--ow-color-text-subtle';
        readonly textMuted: '--ow-color-text-muted';
        readonly textDim: '--ow-color-text-dim';
        readonly accent: '--ow-color-accent';
        readonly accentDim: '--ow-color-accent-dim';
        readonly success: '--ow-color-success';
        readonly danger: '--ow-color-danger';
        readonly dangerText: '--ow-color-danger-text';
        readonly warning: '--ow-color-warning';
        readonly info: '--ow-color-info';
        readonly infoText: '--ow-color-info-text';
        readonly review: '--ow-color-review';
        readonly plan: '--ow-color-plan';
        readonly progress: '--ow-color-progress';
        readonly neutral: '--ow-color-neutral';
    };
    readonly typography: {
        readonly sansFamily: '--ow-font-family-sans';
        readonly monoFamily: '--ow-font-family-mono';
        readonly typeScale: {
            readonly xs: {
                readonly fontSize: '--ow-text-xs';
                readonly lineHeight: '--ow-text-xs--line-height';
            };
            readonly sm: {
                readonly fontSize: '--ow-text-sm';
                readonly lineHeight: '--ow-text-sm--line-height';
            };
            readonly base: {
                readonly fontSize: '--ow-text-base';
                readonly lineHeight: '--ow-text-base--line-height';
            };
            readonly lg: {
                readonly fontSize: '--ow-text-lg';
                readonly lineHeight: '--ow-text-lg--line-height';
            };
            readonly xl: {
                readonly fontSize: '--ow-text-xl';
                readonly lineHeight: '--ow-text-xl--line-height';
            };
            readonly twoXl: {
                readonly fontSize: '--ow-text-2xl';
                readonly lineHeight: '--ow-text-2xl--line-height';
            };
        };
    };
    readonly spacing: {
        readonly unit: '--ow-spacing';
    };
    readonly radius: {
        readonly xs: '--ow-radius-xs';
        readonly sm: '--ow-radius-sm';
        readonly md: '--ow-radius-md';
        readonly lg: '--ow-radius-lg';
        readonly xl: '--ow-radius-xl';
        readonly twoXl: '--ow-radius-2xl';
        readonly threeXl: '--ow-radius-3xl';
        readonly fourXl: '--ow-radius-4xl';
    };
    readonly shadow: {
        readonly twoXs: '--ow-shadow-2xs';
        readonly xs: '--ow-shadow-xs';
        readonly sm: '--ow-shadow-sm';
        readonly md: '--ow-shadow-md';
        readonly lg: '--ow-shadow-lg';
        readonly xl: '--ow-shadow-xl';
        readonly twoXl: '--ow-shadow-2xl';
    };
    readonly focus: {
        readonly ring: '--ow-focus-ring';
        readonly shadow: '--ow-focus-shadow';
    };
};
export declare const DEFAULT_EXTENSION_THEME_TOKENS: {
    readonly color: {
        readonly background: '#141719';
        readonly surface: '#1a1d22';
        readonly surfaceRaised: '#20242b';
        readonly surfaceHover: '#262b33';
        readonly surfaceActive: '#2b313a';
        readonly border: '#1e2229';
        readonly borderStrong: '#2a3240';
        readonly text: '#e7e9ee';
        readonly textSubtle: '#c9cdd6';
        readonly textMuted: '#9098a8';
        readonly textDim: '#8f98a8';
        readonly accent: '#f5a623';
        readonly accentDim: '#d18a2c';
        readonly success: '#4caf72';
        readonly danger: '#ef4444';
        readonly dangerText: '#f87171';
        readonly warning: '#f97316';
        readonly info: '#3b82f6';
        readonly infoText: '#60a5fa';
        readonly review: '#a78bfa';
        readonly plan: '#e879f9';
        readonly progress: '#7dd3fc';
        readonly neutral: '#9098a8';
    };
    readonly typography: {
        readonly sansFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';
        readonly monoFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
        readonly typeScale: {
            readonly xs: {
                readonly fontSize: '0.75rem';
                readonly lineHeight: 'calc(1 / 0.75)';
            };
            readonly sm: {
                readonly fontSize: '0.875rem';
                readonly lineHeight: 'calc(1.25 / 0.875)';
            };
            readonly base: {
                readonly fontSize: '1rem';
                readonly lineHeight: 'calc(1.5 / 1)';
            };
            readonly lg: {
                readonly fontSize: '1.125rem';
                readonly lineHeight: 'calc(1.75 / 1.125)';
            };
            readonly xl: {
                readonly fontSize: '1.25rem';
                readonly lineHeight: 'calc(1.75 / 1.25)';
            };
            readonly twoXl: {
                readonly fontSize: '1.5rem';
                readonly lineHeight: 'calc(2 / 1.5)';
            };
        };
    };
    readonly spacing: {
        readonly unit: '0.25rem';
    };
    readonly radius: {
        readonly xs: '0.125rem';
        readonly sm: '0.25rem';
        readonly md: '0.375rem';
        readonly lg: '0.5rem';
        readonly xl: '0.75rem';
        readonly twoXl: '1rem';
        readonly threeXl: '1.5rem';
        readonly fourXl: '2rem';
    };
    readonly shadow: {
        readonly twoXs: '0 1px rgb(0 0 0 / 0.05)';
        readonly xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)';
        readonly sm: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)';
        readonly md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)';
        readonly lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)';
        readonly xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)';
        readonly twoXl: '0 25px 50px -12px rgb(0 0 0 / 0.25)';
    };
    readonly focus: {
        readonly ring: 'transparent';
        readonly shadow: 'none';
    };
};
export declare const SOURCE_EXTENSION_THEME_CSS_VARIABLES: {
    readonly color: {
        readonly background: '--color-bg';
        readonly surface: '--color-bg-secondary';
        readonly surfaceRaised: '--color-bg-tertiary';
        readonly surfaceHover: '--color-bg-hover';
        readonly surfaceActive: '--color-bg-active';
        readonly border: '--color-border';
        readonly borderStrong: '--color-border-light';
        readonly text: '--color-text-primary';
        readonly textSubtle: '--color-text-secondary';
        readonly textMuted: '--color-text-tertiary';
        readonly textDim: '--color-text-muted';
        readonly accent: '--color-accent';
        readonly accentDim: '--color-accent-dim';
        readonly success: '--color-success';
        readonly danger: '--color-error';
        readonly dangerText: '--color-error-text';
        readonly warning: '--color-warning';
        readonly info: '--color-info';
        readonly infoText: '--color-info-text';
        readonly review: '--color-review';
        readonly plan: '--color-plan';
        readonly progress: '--color-progress';
        readonly neutral: '--color-neutral';
    };
    readonly typography: {
        readonly sansFamily: '--font-sans';
        readonly monoFamily: '--font-mono';
        readonly typeScale: {
            readonly xs: {
                readonly fontSize: '--text-xs';
                readonly lineHeight: '--text-xs--line-height';
            };
            readonly sm: {
                readonly fontSize: '--text-sm';
                readonly lineHeight: '--text-sm--line-height';
            };
            readonly base: {
                readonly fontSize: '--text-base';
                readonly lineHeight: '--text-base--line-height';
            };
            readonly lg: {
                readonly fontSize: '--text-lg';
                readonly lineHeight: '--text-lg--line-height';
            };
            readonly xl: {
                readonly fontSize: '--text-xl';
                readonly lineHeight: '--text-xl--line-height';
            };
            readonly twoXl: {
                readonly fontSize: '--text-2xl';
                readonly lineHeight: '--text-2xl--line-height';
            };
        };
    };
    readonly spacing: {
        readonly unit: '--spacing';
    };
    readonly radius: {
        readonly xs: '--radius-xs';
        readonly sm: '--radius-sm';
        readonly md: '--radius-md';
        readonly lg: '--radius-lg';
        readonly xl: '--radius-xl';
        readonly twoXl: '--radius-2xl';
        readonly threeXl: '--radius-3xl';
        readonly fourXl: '--radius-4xl';
    };
    readonly shadow: {
        readonly twoXs: '--shadow-2xs';
        readonly xs: '--shadow-xs';
        readonly sm: '--shadow-sm';
        readonly md: '--shadow-md';
        readonly lg: '--shadow-lg';
        readonly xl: '--shadow-xl';
        readonly twoXl: '--shadow-2xl';
    };
    readonly focus: {
        readonly ring: '--focus-ring';
        readonly shadow: '--focus-shadow';
    };
};
export declare const EXTENSION_THEME_COLOR_KEYS: readonly ['background', 'surface', 'surfaceRaised', 'surfaceHover', 'surfaceActive', 'border', 'borderStrong', 'text', 'textSubtle', 'textMuted', 'textDim', 'accent', 'accentDim', 'success', 'danger', 'dangerText', 'warning', 'info', 'infoText', 'review', 'plan', 'progress', 'neutral'];
export declare const EXTENSION_THEME_TYPE_SCALE_KEYS: readonly ['xs', 'sm', 'base', 'lg', 'xl', 'twoXl'];
export declare const EXTENSION_THEME_TYPE_SCALE_ENTRY_KEYS: readonly ['fontSize', 'lineHeight'];
export declare const EXTENSION_THEME_SPACING_KEYS: readonly ['unit'];
export declare const EXTENSION_THEME_RADIUS_KEYS: readonly ['xs', 'sm', 'md', 'lg', 'xl', 'twoXl', 'threeXl', 'fourXl'];
export declare const EXTENSION_THEME_SHADOW_KEYS: readonly ['twoXs', 'xs', 'sm', 'md', 'lg', 'xl', 'twoXl'];
export declare const EXTENSION_THEME_FOCUS_KEYS: readonly ['ring', 'shadow'];
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
    readonly root: 'ow-extension-root';
    readonly panel: 'ow-extension-panel';
    readonly stack: 'ow-extension-stack';
    readonly row: 'ow-extension-row';
    readonly heading: 'ow-extension-heading';
    readonly text: 'ow-extension-text';
    readonly muted: 'ow-extension-muted';
    readonly divider: 'ow-extension-divider';
    readonly button: 'ow-extension-button';
    readonly input: 'ow-extension-input';
    readonly textarea: 'ow-extension-textarea';
    readonly select: 'ow-extension-select';
    readonly checkbox: 'ow-extension-checkbox';
    readonly badge: 'ow-extension-badge';
    readonly field: 'ow-extension-field';
    readonly alert: 'ow-extension-alert';
    readonly syntaxBlock: 'ow-syntax-block';
    readonly syntaxLineNumber: 'ow-syntax-line-number';
};
export declare const OPENWAGGLE_EXTENSION_UI_ATTRIBUTES: {
    readonly tone: 'data-ow-tone';
    readonly variant: 'data-ow-variant';
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

### Declarations from `dist/docs.d.ts`

```ts
export type * from './generated/docs.js';
```

### Declarations from `dist/manifest.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION } from './constants.js';
import type { OpenWaggleExtensionManifest } from './generated/manifest.js';
export type * from './generated/manifest.js';
export type OpenWaggleExtensionManifestFile = typeof OPENWAGGLE_EXTENSION.MANIFEST_FILE;
/**
 * Returns the manifest unchanged, typed as precisely as it was written. It checks the shape at
 * compile time only; `validateExtensionManifest` from `@openwaggle/extension-sdk/validation`
 * checks a manifest at run time.
 */
export declare function defineExtensionManifest<const TManifest extends OpenWaggleExtensionManifest>(manifest: TManifest): TManifest;
```

## Export `./agent-loop`

Types: `dist/agent-loop.d.ts`

### Declarations from `dist/agent-loop.d.ts`

```ts
export type * from './generated/agent-loop.js';
```

### Declarations from `dist/generated/agent-loop.d.ts`

```ts
import type { JsonValue } from '../json.js';
/** A tool call, and its result once it has one, for a tool renderer. */
export type OpenWaggleToolCallSurfaceInput = {
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
};
/** A custom message for a custom message renderer. */
export type OpenWaggleCustomMessageSurfaceInput = {
    readonly surface: 'custom-message';
    readonly message: {
        readonly name: string;
        readonly payload?: JsonValue;
    };
};
/** An interaction request for an interaction renderer. */
export type OpenWaggleInteractionSurfaceInput = {
    readonly surface: 'interaction';
    readonly interaction: {
        readonly id: string;
        readonly customType: string;
        readonly payload?: JsonValue;
    };
};
/** The transcript a transcript renderer draws. */
export type OpenWaggleTranscriptSurfaceInput = {
    readonly surface: 'transcript';
    readonly transcript: {
        readonly sessionId?: string;
        readonly messageCount: number;
        readonly payload?: JsonValue;
    };
};
/** The status a status widget shows. */
export type OpenWaggleStatusSurfaceInput = {
    readonly surface: 'status';
    readonly status: {
        readonly label: string;
        readonly payload?: JsonValue;
    };
};
/** What the host passes a renderer surface, by surface. */
export type OpenWaggleAgentLoopSurfaceInput = OpenWaggleCustomMessageSurfaceInput | OpenWaggleInteractionSurfaceInput | OpenWaggleStatusSurfaceInput | OpenWaggleToolCallSurfaceInput | OpenWaggleTranscriptSurfaceInput;
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

## Export `./constants`

Types: `dist/constants.d.ts`

### Declarations from `dist/constants.d.ts`

```ts
export declare const OPENWAGGLE_EXTENSION_BROKER: {
    readonly CAPABILITY: {
        readonly HOST_CONTEXT: 'openwaggle.host.context';
        readonly STORAGE: 'openwaggle.storage';
        readonly STATE: 'openwaggle.state';
        readonly ACTIONS: 'openwaggle.actions';
        readonly SETTINGS: 'openwaggle.settings';
        readonly DOCS: 'openwaggle.docs';
        readonly RUNTIME: 'openwaggle.runtime';
        readonly RESOURCES: 'openwaggle.resources';
    };
    readonly CAPABILITIES: readonly ("openwaggle.actions" | "openwaggle.docs" | "openwaggle.host.context" | "openwaggle.resources" | "openwaggle.runtime" | "openwaggle.settings" | "openwaggle.state" | "openwaggle.storage")[];
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
    }, {
        readonly capability: "openwaggle.resources";
        readonly methods: readonly ["list-resources", "publish-resource"];
    }];
    readonly METHOD: {
        readonly GET_SCOPE: 'get-scope';
        readonly GET: 'get';
        readonly SET: 'set';
        readonly DELETE: 'delete';
        readonly LIST: 'list';
        readonly GET_STATE: 'get-state';
        readonly READ_STATE: 'read-state';
        readonly SELECT_PROJECT: 'select-project';
        readonly GET_SETTINGS: 'get-settings';
        readonly UPDATE_SETTINGS: 'update-settings';
        readonly GET_SETTING: 'get-setting';
        readonly UPDATE_SETTING: 'update-setting';
        readonly DISCOVER_DOCS: 'discover-docs';
        readonly RESOLVE_DOCS_TOPIC: 'resolve-docs-topic';
        readonly REGISTER_CONTRIBUTION: 'register-contribution';
        readonly UNREGISTER_CONTRIBUTION: 'unregister-contribution';
        readonly LIST_RESOURCES: 'list-resources';
        readonly PUBLISH_RESOURCE: 'publish-resource';
    };
    readonly METHODS: readonly ("delete" | "discover-docs" | "get" | "get-scope" | "get-setting" | "get-settings" | "get-state" | "list" | "list-resources" | "publish-resource" | "read-state" | "register-contribution" | "resolve-docs-topic" | "select-project" | "set" | "unregister-contribution" | "update-setting" | "update-settings")[];
    readonly FAILURE_CODE: {
        readonly INVALID_INPUT: 'invalid-input';
        readonly INVALID_PAYLOAD: 'invalid-payload';
        readonly UNKNOWN_EXTENSION: 'unknown-extension';
        readonly DISABLED_EXTENSION: 'disabled-extension';
        readonly UNKNOWN_CONTRIBUTION: 'unknown-contribution';
        readonly UNDECLARED_CAPABILITY: 'undeclared-capability';
        readonly UNDECLARED_METHOD: 'undeclared-method';
        readonly UNDECLARED_SCOPE: 'undeclared-scope';
        readonly OUT_OF_SCOPE: 'out-of-scope';
        readonly UNSUPPORTED_CAPABILITY: 'unsupported-capability';
        readonly UNSUPPORTED_METHOD: 'unsupported-method';
        readonly TRANSPORT_FAILED: 'transport-failed';
    };
    readonly FAILURE_CODES: readonly ("disabled-extension" | "invalid-input" | "invalid-payload" | "out-of-scope" | "transport-failed" | "undeclared-capability" | "undeclared-method" | "undeclared-scope" | "unknown-contribution" | "unknown-extension" | "unsupported-capability" | "unsupported-method")[];
    readonly OUTCOME: {
        readonly SUCCEEDED: 'succeeded';
        readonly REJECTED: 'rejected';
    };
    readonly OUTCOMES: readonly ("rejected" | "succeeded")[];
    readonly STATE_SELECTOR: {
        readonly CURRENT_PROJECT: 'current-project';
        readonly CURRENT_SESSION: 'current-session';
        readonly CURRENT_BRANCH: 'current-branch';
        readonly RECENT_PROJECTS: 'recent-projects';
        readonly MODEL_PREFERENCES: 'model-preferences';
    };
    readonly STATE_SELECTORS: readonly ("current-branch" | "current-project" | "current-session" | "model-preferences" | "recent-projects")[];
    readonly SETTING_KEY: {
        readonly MODEL_PREFERENCES: 'model-preferences';
        readonly PROJECT_DISPLAY_NAME: 'project-display-name';
    };
    readonly SETTING_KEYS: readonly ("model-preferences" | "project-display-name")[];
};
export declare const OPENWAGGLE_EXTENSION: {
    readonly MANIFEST_FILE: 'openwaggle.extension.json';
    readonly SDK_VERSION: '0.1.0';
    readonly PROJECT_ROOT_SEGMENTS: readonly ['.openwaggle', 'extensions'];
    readonly GLOBAL_EXTENSIONS_DIR: 'extensions';
    readonly SCOPE: {
        readonly GLOBAL_KIND: 'global';
        readonly PROJECT_KIND: 'project';
        readonly GLOBAL_ID: 'global';
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
    readonly PATTERNS: {
        readonly WINDOWS_ABSOLUTE_PATH: RegExp;
        readonly ID: RegExp;
        readonly CONTRIBUTION_ID: RegExp;
        readonly SEMVER_VERSION: RegExp;
    };
    readonly PATH: {
        readonly NUL_CHARACTER: '\0';
        readonly POSIX_SEPARATOR: '/';
        readonly WINDOWS_SEPARATOR: '\\';
        readonly RELATIVE_PARENT_SEGMENT: '..';
        readonly CURRENT_DIRECTORY_SEGMENT: '.';
    };
    readonly RUNTIME_MODULE_PROTOCOL: {
        readonly MODULE_CONTEXT_SEGMENT: '__context__';
    };
    readonly CAPABILITY_SCOPES: readonly ['app', 'project', 'session', 'branch'];
    readonly CONTRIBUTION_FAMILY: {
        readonly COMMANDS: 'commands';
        readonly SLASH_COMMANDS: 'slashCommands';
        readonly ROUTES: 'routes';
        readonly SETTINGS_SECTIONS: 'settingsSections';
        readonly SIDE_PANELS: 'sidePanels';
        readonly DIALOGS: 'dialogs';
        readonly TRANSCRIPT_RENDERERS: 'transcriptRenderers';
        readonly TOOL_RENDERERS: 'toolRenderers';
        readonly CUSTOM_MESSAGE_RENDERERS: 'customMessageRenderers';
        readonly INTERACTION_RENDERERS: 'interactionRenderers';
        readonly STATUS_WIDGETS: 'statusWidgets';
        readonly SESSION_SUMMARY_SECTIONS: 'sessionSummarySections';
    };
    readonly CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands", "routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets", "sessionSummarySections"];
    readonly COMMAND_CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands"];
    readonly CONTRIBUTION_RUNTIME: {
        readonly FEDERATED_MODULE: 'federated-module';
        readonly TRUSTED_RENDERER: 'trusted-renderer';
    };
    readonly CONTRIBUTION_RUNTIMES: readonly ("federated-module" | "trusted-renderer")[];
    readonly EXECUTION_PLACEMENT: {
        readonly HOST_RENDERER: 'host-renderer';
        readonly FRAME: 'frame';
    };
    readonly EXECUTION_PLACEMENTS: readonly ("frame" | "host-renderer")[];
    readonly STORAGE: {
        readonly KIND: {
            readonly STATE: 'state';
            readonly CONFIG: 'config';
        };
        readonly KINDS: readonly ("config" | "state")[];
        readonly SCOPE: {
            readonly GLOBAL_KIND: 'global';
            readonly PROJECT_KIND: 'project';
            readonly GLOBAL_ID: 'global';
        };
        readonly SCOPE_KINDS: readonly ("global" | "project")[];
        readonly KEY_MAX_LENGTH: 160;
    };
    readonly ENTRY_CONTRIBUTION_FAMILIES: readonly ["routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly SLOT_CONTRIBUTION_FAMILIES: readonly ["settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly INSTALL_SOURCE: {
        readonly PREBUILT: 'prebuilt';
        readonly LOCAL_BUILD: 'local-build';
    };
    readonly INSTALL_SOURCES: readonly ("local-build" | "prebuilt")[];
    readonly RUNTIME_REQUIREMENT_TYPE: {
        readonly BINARY: 'binary';
        readonly COMMAND: 'command';
    };
    readonly RUNTIME_REQUIREMENT_TYPES: readonly ("binary" | "command")[];
    readonly NETWORK_ACCESS_MODE: {
        readonly BROKERED: 'brokered';
        readonly RESTRICTED: 'restricted';
        readonly DIRECT: 'direct';
    };
    readonly NETWORK_ACCESS_MODES: readonly ("brokered" | "direct" | "restricted")[];
};
```

## Export `./context`

Types: `dist/context.d.ts`

### Declarations from `dist/context.d.ts`

```ts
import type { ExtensionBrokerSdk } from './sdk-types.js';
import type { JsonValue } from './json.js';
import { type OpenWaggleExtensionSyntaxSdk } from './syntax.js';
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
    /** Present when the host resolved this surface for a specific Session. */
    readonly sessionId?: string;
    readonly theme: OpenWaggleExtensionTheme;
}
export interface OpenWaggleExtensionSurfaceSdk {
    readonly sendAction: (actionId: string, payload?: JsonValue) => Promise<void>;
    readonly respondInteraction: (value: JsonValue | null) => Promise<void>;
    readonly syntax: OpenWaggleExtensionSyntaxSdk;
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

### Declarations from `dist/sdk-types.d.ts`

```ts
import type { JsonValue } from './json.js';
import type { ExtensionActionSelectProjectResult, ExtensionDocsDiscoverPayload, ExtensionDocsDiscoverResult, ExtensionDocsResolveTopicPayload, ExtensionDocsResolveTopicResult, ExtensionInvokeFailure, ExtensionInvokeInput, ExtensionInvokeResult, ExtensionInvokeScope, ExtensionInvokeSuccess, ExtensionModelPreferencesSettingsPatch, ExtensionRuntimeRegisterContributionPayload, ExtensionRuntimeRegisterContributionResult, ExtensionRuntimeUnregisterContributionPayload, ExtensionRuntimeUnregisterContributionResult, ExtensionSessionResourcePublishPayload, ExtensionSessionResourcePublishResult, ExtensionSessionResourcesListPayload, ExtensionSessionResourcesListResult, ExtensionSettingsGetResult, ExtensionSettingsGetSettingResult, ExtensionSettingsUpdatePayload, ExtensionSettingsUpdateResult, ExtensionSettingsUpdateSettingResult, ExtensionStateCurrentBranchReadResult, ExtensionStateCurrentProjectReadResult, ExtensionStateCurrentSessionReadResult, ExtensionStateModelPreferencesReadResult, ExtensionStateReadResult, ExtensionStateRecentProjectsReadResult, ExtensionStorageDeleteResult, ExtensionStorageGetResult, ExtensionStorageListResult, ExtensionStorageSetResult } from './types.js';
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
export type ExtensionSessionResourcesListOperationResult = ExtensionOperationSuccess<ExtensionSessionResourcesListResult> | ExtensionInvokeFailure;
export type ExtensionSessionResourcePublishOperationResult = ExtensionOperationSuccess<ExtensionSessionResourcePublishResult> | ExtensionInvokeFailure;
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
    readonly resources: ExtensionOpenWaggleResourcesSdk;
}
export type ExtensionSessionInvokeScope = Extract<ExtensionInvokeScope, {
    readonly kind: 'session';
}>;
export interface ExtensionOpenWaggleResourcesSdk {
    readonly list: (scope: ExtensionSessionInvokeScope, input?: ExtensionSessionResourcesListPayload) => Promise<ExtensionInvokeResult<ExtensionSessionResourcesListResult>>;
    readonly publish: (scope: ExtensionSessionInvokeScope, resource: ExtensionSessionResourcePublishPayload) => Promise<ExtensionInvokeResult<ExtensionSessionResourcePublishResult>>;
}
/** @deprecated Use {@link ExtensionOpenWaggleResourcesSdk}. */
export type ExtensionOpenWaggleSessionResourcesSdk = ExtensionOpenWaggleResourcesSdk;
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
export type * from './validation-types.js';
```

### Declarations from `dist/contribution-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION } from './constants.js';
import type { ExtensionContributionRegistration, ExtensionContributionUnregistration } from './generated/manifest.js';
export type { ExtensionCapabilityScope, ExtensionContributionFamily, ExtensionContributionMatchView, ExtensionContributionRuntime, ExtensionContributionTargetView, ExtensionExecutionPlacement, ExtensionInstallSource, } from './generated/manifest.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionNetworkAccessMode = ConstantValue<typeof OPENWAGGLE_EXTENSION.NETWORK_ACCESS_MODE>;
export type ExtensionRuntimeRegisterContributionPayload = ExtensionContributionRegistration;
export type ExtensionRuntimeUnregisterContributionPayload = ExtensionContributionUnregistration;
```

### Declarations from `dist/constants.d.ts`

```ts
export declare const OPENWAGGLE_EXTENSION_BROKER: {
    readonly CAPABILITY: {
        readonly HOST_CONTEXT: 'openwaggle.host.context';
        readonly STORAGE: 'openwaggle.storage';
        readonly STATE: 'openwaggle.state';
        readonly ACTIONS: 'openwaggle.actions';
        readonly SETTINGS: 'openwaggle.settings';
        readonly DOCS: 'openwaggle.docs';
        readonly RUNTIME: 'openwaggle.runtime';
        readonly RESOURCES: 'openwaggle.resources';
    };
    readonly CAPABILITIES: readonly ("openwaggle.actions" | "openwaggle.docs" | "openwaggle.host.context" | "openwaggle.resources" | "openwaggle.runtime" | "openwaggle.settings" | "openwaggle.state" | "openwaggle.storage")[];
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
    }, {
        readonly capability: "openwaggle.resources";
        readonly methods: readonly ["list-resources", "publish-resource"];
    }];
    readonly METHOD: {
        readonly GET_SCOPE: 'get-scope';
        readonly GET: 'get';
        readonly SET: 'set';
        readonly DELETE: 'delete';
        readonly LIST: 'list';
        readonly GET_STATE: 'get-state';
        readonly READ_STATE: 'read-state';
        readonly SELECT_PROJECT: 'select-project';
        readonly GET_SETTINGS: 'get-settings';
        readonly UPDATE_SETTINGS: 'update-settings';
        readonly GET_SETTING: 'get-setting';
        readonly UPDATE_SETTING: 'update-setting';
        readonly DISCOVER_DOCS: 'discover-docs';
        readonly RESOLVE_DOCS_TOPIC: 'resolve-docs-topic';
        readonly REGISTER_CONTRIBUTION: 'register-contribution';
        readonly UNREGISTER_CONTRIBUTION: 'unregister-contribution';
        readonly LIST_RESOURCES: 'list-resources';
        readonly PUBLISH_RESOURCE: 'publish-resource';
    };
    readonly METHODS: readonly ("delete" | "discover-docs" | "get" | "get-scope" | "get-setting" | "get-settings" | "get-state" | "list" | "list-resources" | "publish-resource" | "read-state" | "register-contribution" | "resolve-docs-topic" | "select-project" | "set" | "unregister-contribution" | "update-setting" | "update-settings")[];
    readonly FAILURE_CODE: {
        readonly INVALID_INPUT: 'invalid-input';
        readonly INVALID_PAYLOAD: 'invalid-payload';
        readonly UNKNOWN_EXTENSION: 'unknown-extension';
        readonly DISABLED_EXTENSION: 'disabled-extension';
        readonly UNKNOWN_CONTRIBUTION: 'unknown-contribution';
        readonly UNDECLARED_CAPABILITY: 'undeclared-capability';
        readonly UNDECLARED_METHOD: 'undeclared-method';
        readonly UNDECLARED_SCOPE: 'undeclared-scope';
        readonly OUT_OF_SCOPE: 'out-of-scope';
        readonly UNSUPPORTED_CAPABILITY: 'unsupported-capability';
        readonly UNSUPPORTED_METHOD: 'unsupported-method';
        readonly TRANSPORT_FAILED: 'transport-failed';
    };
    readonly FAILURE_CODES: readonly ("disabled-extension" | "invalid-input" | "invalid-payload" | "out-of-scope" | "transport-failed" | "undeclared-capability" | "undeclared-method" | "undeclared-scope" | "unknown-contribution" | "unknown-extension" | "unsupported-capability" | "unsupported-method")[];
    readonly OUTCOME: {
        readonly SUCCEEDED: 'succeeded';
        readonly REJECTED: 'rejected';
    };
    readonly OUTCOMES: readonly ("rejected" | "succeeded")[];
    readonly STATE_SELECTOR: {
        readonly CURRENT_PROJECT: 'current-project';
        readonly CURRENT_SESSION: 'current-session';
        readonly CURRENT_BRANCH: 'current-branch';
        readonly RECENT_PROJECTS: 'recent-projects';
        readonly MODEL_PREFERENCES: 'model-preferences';
    };
    readonly STATE_SELECTORS: readonly ("current-branch" | "current-project" | "current-session" | "model-preferences" | "recent-projects")[];
    readonly SETTING_KEY: {
        readonly MODEL_PREFERENCES: 'model-preferences';
        readonly PROJECT_DISPLAY_NAME: 'project-display-name';
    };
    readonly SETTING_KEYS: readonly ("model-preferences" | "project-display-name")[];
};
export declare const OPENWAGGLE_EXTENSION: {
    readonly MANIFEST_FILE: 'openwaggle.extension.json';
    readonly SDK_VERSION: '0.1.0';
    readonly PROJECT_ROOT_SEGMENTS: readonly ['.openwaggle', 'extensions'];
    readonly GLOBAL_EXTENSIONS_DIR: 'extensions';
    readonly SCOPE: {
        readonly GLOBAL_KIND: 'global';
        readonly PROJECT_KIND: 'project';
        readonly GLOBAL_ID: 'global';
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
    readonly PATTERNS: {
        readonly WINDOWS_ABSOLUTE_PATH: RegExp;
        readonly ID: RegExp;
        readonly CONTRIBUTION_ID: RegExp;
        readonly SEMVER_VERSION: RegExp;
    };
    readonly PATH: {
        readonly NUL_CHARACTER: '\0';
        readonly POSIX_SEPARATOR: '/';
        readonly WINDOWS_SEPARATOR: '\\';
        readonly RELATIVE_PARENT_SEGMENT: '..';
        readonly CURRENT_DIRECTORY_SEGMENT: '.';
    };
    readonly RUNTIME_MODULE_PROTOCOL: {
        readonly MODULE_CONTEXT_SEGMENT: '__context__';
    };
    readonly CAPABILITY_SCOPES: readonly ['app', 'project', 'session', 'branch'];
    readonly CONTRIBUTION_FAMILY: {
        readonly COMMANDS: 'commands';
        readonly SLASH_COMMANDS: 'slashCommands';
        readonly ROUTES: 'routes';
        readonly SETTINGS_SECTIONS: 'settingsSections';
        readonly SIDE_PANELS: 'sidePanels';
        readonly DIALOGS: 'dialogs';
        readonly TRANSCRIPT_RENDERERS: 'transcriptRenderers';
        readonly TOOL_RENDERERS: 'toolRenderers';
        readonly CUSTOM_MESSAGE_RENDERERS: 'customMessageRenderers';
        readonly INTERACTION_RENDERERS: 'interactionRenderers';
        readonly STATUS_WIDGETS: 'statusWidgets';
        readonly SESSION_SUMMARY_SECTIONS: 'sessionSummarySections';
    };
    readonly CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands", "routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets", "sessionSummarySections"];
    readonly COMMAND_CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands"];
    readonly CONTRIBUTION_RUNTIME: {
        readonly FEDERATED_MODULE: 'federated-module';
        readonly TRUSTED_RENDERER: 'trusted-renderer';
    };
    readonly CONTRIBUTION_RUNTIMES: readonly ("federated-module" | "trusted-renderer")[];
    readonly EXECUTION_PLACEMENT: {
        readonly HOST_RENDERER: 'host-renderer';
        readonly FRAME: 'frame';
    };
    readonly EXECUTION_PLACEMENTS: readonly ("frame" | "host-renderer")[];
    readonly STORAGE: {
        readonly KIND: {
            readonly STATE: 'state';
            readonly CONFIG: 'config';
        };
        readonly KINDS: readonly ("config" | "state")[];
        readonly SCOPE: {
            readonly GLOBAL_KIND: 'global';
            readonly PROJECT_KIND: 'project';
            readonly GLOBAL_ID: 'global';
        };
        readonly SCOPE_KINDS: readonly ("global" | "project")[];
        readonly KEY_MAX_LENGTH: 160;
    };
    readonly ENTRY_CONTRIBUTION_FAMILIES: readonly ["routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly SLOT_CONTRIBUTION_FAMILIES: readonly ["settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly INSTALL_SOURCE: {
        readonly PREBUILT: 'prebuilt';
        readonly LOCAL_BUILD: 'local-build';
    };
    readonly INSTALL_SOURCES: readonly ("local-build" | "prebuilt")[];
    readonly RUNTIME_REQUIREMENT_TYPE: {
        readonly BINARY: 'binary';
        readonly COMMAND: 'command';
    };
    readonly RUNTIME_REQUIREMENT_TYPES: readonly ("binary" | "command")[];
    readonly NETWORK_ACCESS_MODE: {
        readonly BROKERED: 'brokered';
        readonly RESTRICTED: 'restricted';
        readonly DIRECT: 'direct';
    };
    readonly NETWORK_ACCESS_MODES: readonly ("brokered" | "direct" | "restricted")[];
};
```

### Declarations from `dist/generated/manifest.d.ts`

```ts
/** The scopes a broker capability can be called in. */
export type ExtensionCapabilityScope = 'app' | 'branch' | 'project' | 'session';
/** A contribution family: the manifest key a contribution is declared under. */
export type ExtensionContributionFamily = 'commands' | 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'routes' | 'sessionSummarySections' | 'settingsSections' | 'sidePanels' | 'slashCommands' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
/** How a contribution's entry module runs. */
export type ExtensionContributionRuntime = 'federated-module' | 'trusted-renderer';
/** Where a contribution's entry module runs. */
export type ExtensionExecutionPlacement = 'frame' | 'host-renderer';
/** Whether OpenWaggle installs the package's prebuilt artifacts or builds it locally. */
export type ExtensionInstallSource = 'local-build' | 'prebuilt';
/** The projects and sessions a contribution is limited to. */
export type ExtensionContributionTargetView = {
    readonly projectPaths?: readonly string[];
    readonly sessionIds?: readonly string[];
};
/** The tool calls, custom messages and interactions a renderer contribution handles. */
export type ExtensionContributionMatchView = {
    readonly toolNames?: readonly string[];
    readonly customMessageNames?: readonly string[];
    readonly interactionKinds?: readonly string[];
};
/** A broker capability the extension uses, with the methods and scopes it calls. */
export type ExtensionCapabilityDeclaration = {
    readonly id: string;
    readonly methods?: readonly string[];
    readonly scopes?: readonly ExtensionCapabilityScope[];
};
/** A command or slash command. */
export type ExtensionCommandContribution = {
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly id: string;
    readonly title: string;
    readonly category?: string;
    readonly target?: ExtensionContributionTargetView;
};
/**
 * A contribution that mounts an entry module: a route, or a settings section, dialog, renderer
 * or status widget.
 */
export type ExtensionSurfaceContribution = {
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly id: string;
    readonly title: string;
    readonly runtime: ExtensionContributionRuntime;
    readonly execution: ExtensionExecutionPlacement;
    readonly entry: string;
    readonly target?: ExtensionContributionTargetView;
    readonly matches?: ExtensionContributionMatchView;
};
/** A side panel's Panel rail icon: a Lucide icon name in kebab-case, or a package `.svg` file. */
export type ExtensionSidePanelIcon = string | {
    readonly svg: string;
};
/** A side panel, with its optional Panel rail icon. */
export type ExtensionSidePanelContribution = {
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly id: string;
    readonly title: string;
    readonly runtime: ExtensionContributionRuntime;
    readonly execution: ExtensionExecutionPlacement;
    readonly entry: string;
    readonly target?: ExtensionContributionTargetView;
    readonly matches?: ExtensionContributionMatchView;
    readonly icon?: ExtensionSidePanelIcon;
};
/** Any contribution that mounts an entry module. */
export type ExtensionEntryContribution = ExtensionSidePanelContribution | ExtensionSurfaceContribution;
/** A row of a Session Summary section. */
export type ExtensionSessionSummaryRow = {
    readonly id: string;
    readonly label: string;
    readonly value?: string;
    readonly badge?: string;
    readonly count?: number;
    readonly resourceId?: string;
    readonly action?: {
        readonly family: 'commands' | 'dialogs' | 'sidePanels';
        readonly contributionId: string;
    };
};
/** Whether a Session Summary section starts expanded, can collapse, and collapses by itself. */
export type ExtensionSessionSummaryDisclosure = {
    readonly defaultExpanded?: boolean;
    readonly collapsible?: boolean;
    readonly autoCollapseAfterMs?: number;
};
/** The status a Session Summary section shows. */
export type ExtensionSessionSummaryState = {
    readonly status: 'failure';
    readonly message: string;
} | {
    readonly status: 'live' | 'loading';
    readonly message?: string;
} | {
    readonly status: 'ready';
};
/** A declarative Session Summary section. */
export type ExtensionSessionSummaryContribution = {
    readonly id: string;
    readonly title: string;
    readonly placement?: 'context' | 'coordination' | 'details';
    readonly target?: ExtensionContributionTargetView;
    readonly disclosure?: ExtensionSessionSummaryDisclosure;
    readonly state?: ExtensionSessionSummaryState;
    readonly rows: readonly ExtensionSessionSummaryRow[];
};
/** Every contribution a manifest declares, by family. */
export type ExtensionContributions = {
    readonly commands?: readonly ExtensionCommandContribution[];
    readonly slashCommands?: readonly ExtensionCommandContribution[];
    readonly routes?: readonly ExtensionSurfaceContribution[];
    readonly settingsSections?: readonly ExtensionSurfaceContribution[];
    readonly sidePanels?: readonly ExtensionSidePanelContribution[];
    readonly dialogs?: readonly ExtensionSurfaceContribution[];
    readonly transcriptRenderers?: readonly ExtensionSurfaceContribution[];
    readonly toolRenderers?: readonly ExtensionSurfaceContribution[];
    readonly customMessageRenderers?: readonly ExtensionSurfaceContribution[];
    readonly interactionRenderers?: readonly ExtensionSurfaceContribution[];
    readonly statusWidgets?: readonly ExtensionSurfaceContribution[];
    readonly sessionSummarySections?: readonly ExtensionSessionSummaryContribution[];
};
/** A contribution registered at runtime, with its family. */
export type ExtensionContributionRegistration = {
    readonly family: 'commands' | 'slashCommands';
    readonly contribution: ExtensionCommandContribution;
} | {
    readonly family: 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'settingsSections' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
    readonly contribution: ExtensionSurfaceContribution;
} | {
    readonly family: 'routes';
    readonly contribution: ExtensionSurfaceContribution;
} | {
    readonly family: 'sessionSummarySections';
    readonly contribution: ExtensionSessionSummaryContribution;
} | {
    readonly family: 'sidePanels';
    readonly contribution: ExtensionSidePanelContribution;
};
/** A runtime contribution to remove, by family and id. */
export type ExtensionContributionUnregistration = {
    readonly family: ExtensionContributionFamily;
    readonly contributionId: string;
};
/** A binary or package command the extension needs before it runs. */
export type ExtensionRuntimeRequirementDeclaration = {
    readonly id: string;
    readonly label: string;
    readonly kind?: 'binary' | 'command';
    readonly command?: string;
    readonly binary?: string;
};
/** A documentation topic the extension ships. */
export type ExtensionDocsTopicDeclaration = {
    readonly id: string;
    readonly title: string;
    readonly path: string;
    readonly description?: string;
    readonly aliases?: readonly string[];
    readonly keywords?: readonly string[];
};
/** An `openwaggle.extension.json` manifest. */
export type OpenWaggleExtensionManifest = {
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
        readonly topics?: readonly ExtensionDocsTopicDeclaration[];
    };
    readonly network?: {
        readonly origins: readonly string[];
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
};
```

### Declarations from `dist/core-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { ExtensionCapabilityAuditEntry, ExtensionInvokeFailure } from './generated/broker.js';
export type { ExtensionCapabilityAuditEntry, ExtensionHostContextResult, ExtensionInvokeError, ExtensionInvokeFailure, ExtensionInvokeFailureCode, ExtensionInvokeInput, ExtensionInvokeOutcome, ExtensionInvokeScope, } from './generated/broker.js';
export type { ExtensionInvokeSuccessValue } from './generated/broker-result.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionBrokerCapability = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY>;
export type ExtensionBrokerMethod = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.METHOD>;
export type ExtensionStateSelector = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR>;
export type ExtensionSettingsKey = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY>;
/**
 * A broker success whose value one operation's decoder has narrowed. The default is a value not
 * decoded yet.
 */
export interface ExtensionInvokeSuccess<TValue = unknown> {
    readonly ok: true;
    readonly value: TValue;
    readonly audit: ExtensionCapabilityAuditEntry;
}
export type ExtensionInvokeResult<TValue = unknown> = ExtensionInvokeSuccess<TValue> | ExtensionInvokeFailure;
```

### Declarations from `dist/generated/broker.d.ts`

```ts
/** Why a broker call failed. */
export type ExtensionInvokeFailureCode = 'disabled-extension' | 'invalid-input' | 'invalid-payload' | 'out-of-scope' | 'transport-failed' | 'undeclared-capability' | 'undeclared-method' | 'undeclared-scope' | 'unknown-contribution' | 'unknown-extension' | 'unsupported-capability' | 'unsupported-method';
/** Whether the broker ran a call or refused it. */
export type ExtensionInvokeOutcome = 'rejected' | 'succeeded';
/** Where a broker call applies: the app, a project, a session or a branch. */
export type ExtensionInvokeScope = {
    readonly kind: 'app';
} | {
    readonly kind: 'branch';
    readonly projectPath: string;
    readonly sessionId: string;
    readonly branchId: string;
} | {
    readonly kind: 'project';
    readonly projectPath: string;
} | {
    readonly kind: 'session';
    readonly projectPath: string;
    readonly sessionId: string;
};
/** One broker call as the host receives it. */
export type ExtensionInvokeInput = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly payload?: unknown;
};
/** Why the broker refused or failed a call. */
export type ExtensionInvokeError = {
    readonly code: ExtensionInvokeFailureCode;
    readonly message: string;
    readonly issues?: readonly string[];
};
/** The audit record the broker keeps for every call. */
export type ExtensionCapabilityAuditEntry = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly outcome: ExtensionInvokeOutcome;
    readonly timestamp: number;
    readonly failureCode?: ExtensionInvokeFailureCode;
};
/** A broker call that failed. */
export type ExtensionInvokeFailure = {
    readonly ok: false;
    readonly error: ExtensionInvokeError;
    readonly audit?: ExtensionCapabilityAuditEntry;
};
/** The result of `hostContext.getScope`: the scope the host resolved for the contribution. */
export type ExtensionHostContextResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.host.context';
    readonly method: 'get-scope';
    readonly scope: ExtensionInvokeScope;
    readonly declaredScopes: readonly ('app' | 'branch' | 'project' | 'session')[];
};
```

### Declarations from `dist/generated/broker-result.d.ts`

```ts
import type { ExtensionHostContextResult } from './broker.js';
import type { ExtensionDocsDiscoverResult, ExtensionDocsResolveTopicResult } from './docs.js';
import type { ExtensionActionSelectProjectResult, ExtensionSessionResourcePublishResult, ExtensionSessionResourcesListResult, ExtensionSettingsGetResult, ExtensionSettingsGetSettingResult, ExtensionSettingsUpdateResult, ExtensionSettingsUpdateSettingResult, ExtensionStateCurrentBranchReadResult, ExtensionStateCurrentProjectReadResult, ExtensionStateCurrentSessionReadResult, ExtensionStateModelPreferencesReadResult, ExtensionStateReadResult, ExtensionStateRecentProjectsReadResult } from './openwaggle.js';
import type { ExtensionRuntimeRegisterContributionResult, ExtensionRuntimeUnregisterContributionResult, ExtensionStorageDeleteResult, ExtensionStorageGetResult, ExtensionStorageListResult, ExtensionStorageSetResult } from './storage.js';
/** Every result value the broker returns, one per capability method. */
export type ExtensionInvokeSuccessValue = ExtensionActionSelectProjectResult | ExtensionDocsDiscoverResult | ExtensionDocsResolveTopicResult | ExtensionHostContextResult | ExtensionRuntimeRegisterContributionResult | ExtensionRuntimeUnregisterContributionResult | ExtensionSessionResourcePublishResult | ExtensionSessionResourcesListResult | ExtensionSettingsGetResult | ExtensionSettingsGetSettingResult | ExtensionSettingsUpdateResult | ExtensionSettingsUpdateSettingResult | ExtensionStateCurrentBranchReadResult | ExtensionStateCurrentProjectReadResult | ExtensionStateCurrentSessionReadResult | ExtensionStateModelPreferencesReadResult | ExtensionStateReadResult | ExtensionStateRecentProjectsReadResult | ExtensionStorageDeleteResult | ExtensionStorageGetResult | ExtensionStorageListResult | ExtensionStorageSetResult;
```

### Declarations from `dist/generated/docs.d.ts`

```ts
export type ExtensionDocsDiscoverPayload = {
    readonly projectPaths?: readonly string[];
    readonly includeExtensions?: boolean;
};
export type ExtensionDocsResolveTopicPayload = {
    readonly topic: string;
};
export type ExtensionDocsDiscoverResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.docs';
    readonly method: 'discover-docs';
    readonly docs: ExtensionDocsDiscoveryView;
};
export type ExtensionDocsResolveTopicResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.docs';
    readonly method: 'resolve-docs-topic';
    readonly resolvedTopic: FirstPartyDocsTopicSummary | null;
};
export type ExtensionDocsDiscoveryView = {
    readonly generatedAt: string;
    readonly bundlePath: string;
    readonly firstPartyTopics: readonly FirstPartyDocsTopicSummary[];
    readonly extensionTopics: readonly {
        readonly topic: string;
        readonly localTopic: string;
        readonly title: string;
        readonly description?: string;
        readonly path: string;
        readonly aliases: readonly string[];
        readonly keywords: readonly string[];
        readonly contentHash: string | null;
        readonly provenance: {
            readonly extensionId: string;
            readonly extensionName: string | null;
            readonly extensionVersion: string | null;
            readonly scope: {
                readonly kind: 'global' | 'project';
                readonly label: string;
                readonly projectPath?: string;
            };
            readonly packagePath: string;
            readonly manifestPath: string;
            readonly path: string;
            readonly packageContentHash: string | null;
            readonly trust: 'trusted' | 'unknown' | 'untrusted';
            readonly lifecycle: 'disabled' | 'enabled' | 'unavailable';
        };
        readonly diagnostics: readonly {
            readonly severity: 'error' | 'warning';
            readonly code: string;
            readonly message: string;
            readonly path?: string;
        }[];
    }[];
    readonly diagnostics: readonly {
        readonly severity: 'error' | 'warning';
        readonly code: string;
        readonly message: string;
        readonly path?: string;
    }[];
};
export type FirstPartyDocsTopicSummary = {
    readonly topic: string;
    readonly source: 'openwaggle' | 'pi';
    readonly group: string;
    readonly title: string;
    readonly description?: string;
    readonly section?: string;
    readonly order: number;
    readonly path: string;
    readonly bundlePath: string;
    readonly sourcePath: string;
    readonly aliases: readonly string[];
    readonly keywords: readonly string[];
    readonly contentHash: string;
};
```

### Declarations from `dist/generated/openwaggle.d.ts`

```ts
import type { ExtensionInvokeScope } from './broker.js';
export type ExtensionModelPrefs = {
    readonly selectedModel: string;
    readonly favoriteModels: readonly string[];
    readonly enabledModels: readonly string[];
    readonly thinkingLevel: string;
};
export type ExtensionProjectView = {
    readonly projectPath: string;
    readonly displayName: string | null;
    readonly active: boolean;
};
export type ExtensionSessionView = {
    readonly sessionId: string;
    readonly title: string;
    readonly projectPath: string | null;
};
export type ExtensionBranchView = {
    readonly branchId: string;
    readonly sessionId: string;
    readonly name: string;
    readonly main: boolean;
    readonly archived: boolean;
};
export type ExtensionStateReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'get-state';
    readonly scope: ExtensionInvokeScope;
    readonly activeProjectPath: string | null;
    readonly currentProject: ExtensionProjectView | null;
    readonly currentSession: ExtensionSessionView | null;
    readonly currentBranch: ExtensionBranchView | null;
    readonly recentProjects: readonly string[];
    readonly modelPreferences: ExtensionModelPrefs;
};
export type ExtensionStateCurrentProjectReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'read-state';
    readonly scope: ExtensionInvokeScope;
    readonly selector: 'current-branch' | 'current-project' | 'current-session' | 'model-preferences' | 'recent-projects';
    readonly value: {
        readonly active: boolean;
        readonly displayName: string | null;
        readonly projectPath: string;
    } | null;
};
export type ExtensionStateCurrentSessionReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'read-state';
    readonly scope: ExtensionInvokeScope;
    readonly selector: 'current-branch' | 'current-project' | 'current-session' | 'model-preferences' | 'recent-projects';
    readonly value: {
        readonly projectPath: string | null;
        readonly sessionId: string;
        readonly title: string;
    } | null;
};
export type ExtensionStateCurrentBranchReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'read-state';
    readonly scope: ExtensionInvokeScope;
    readonly selector: 'current-branch' | 'current-project' | 'current-session' | 'model-preferences' | 'recent-projects';
    readonly value: {
        readonly archived: boolean;
        readonly branchId: string;
        readonly main: boolean;
        readonly name: string;
        readonly sessionId: string;
    } | null;
};
export type ExtensionStateRecentProjectsReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'read-state';
    readonly scope: ExtensionInvokeScope;
    readonly selector: 'current-branch' | 'current-project' | 'current-session' | 'model-preferences' | 'recent-projects';
    readonly value: readonly string[];
};
export type ExtensionStateModelPreferencesReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'read-state';
    readonly scope: ExtensionInvokeScope;
    readonly selector: 'current-branch' | 'current-project' | 'current-session' | 'model-preferences' | 'recent-projects';
    readonly value: {
        readonly enabledModels: readonly string[];
        readonly favoriteModels: readonly string[];
        readonly selectedModel: string;
        readonly thinkingLevel: string;
    };
};
export type ExtensionActionSelectProjectResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.actions';
    readonly method: 'select-project';
    readonly previousProjectPath: string | null;
    readonly projectPath: string;
    readonly recentProjects: readonly string[];
};
export type ExtensionSessionResourceKind = 'change-request' | 'commit' | 'file' | 'image' | 'link' | 'site' | 'tool' | 'web-search';
export type ExtensionSessionResourceRole = 'output' | 'source';
export type ExtensionSessionResourceView = {
    readonly id: string;
    readonly title: string;
    readonly kind: ExtensionSessionResourceKind;
    readonly mimeType: string | null;
    readonly available: boolean;
    readonly isSource: boolean;
    readonly isOutput: boolean;
};
export type ExtensionSessionResourcePublishPayload = {
    readonly key: string;
    readonly title: string;
    readonly kind: 'image' | 'link';
    readonly role: ExtensionSessionResourceRole;
    readonly locator: string;
};
export type ExtensionSessionResourcesListPayload = {
    readonly cursor?: string | null;
    readonly limit?: number;
};
export type ExtensionSessionResourcesListResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.resources';
    readonly sessionId: string;
    readonly method: 'list-resources';
    readonly resources: readonly ExtensionSessionResourceView[];
    readonly total: number;
    readonly nextCursor: string | null;
};
export type ExtensionSessionResourcePublishResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.resources';
    readonly sessionId: string;
    readonly method: 'publish-resource';
    readonly resource: ExtensionSessionResourceView;
};
export type ExtensionSettingsView = {
    readonly modelPreferences: ExtensionModelPrefs;
    readonly projectDisplayNames: Readonly<Record<string, string>>;
};
export type ExtensionModelPreferencesSettingsPatch = {
    readonly selectedModel?: string;
    readonly favoriteModels?: readonly string[];
    readonly enabledModels?: readonly string[];
    /** Accepted for SDK compatibility and ignored: extensions cannot change the thinking level. */
    readonly thinkingLevel?: string;
};
export type ExtensionSettingsUpdatePayload = {
    readonly selectedModel?: string;
    readonly favoriteModels?: readonly string[];
    readonly enabledModels?: readonly string[];
    /** Accepted for SDK compatibility and ignored: extensions cannot change the thinking level. */
    readonly thinkingLevel?: string;
    readonly projectDisplayNames?: Readonly<Record<string, string>>;
};
export type ExtensionSettingsGetResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.settings';
    readonly method: 'get-settings';
    readonly settings: ExtensionSettingsView;
};
export type ExtensionSettingsUpdateResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.settings';
    readonly method: 'update-settings';
    readonly settings: ExtensionSettingsView;
};
export type ExtensionSettingsSelectedValue = {
    readonly key: 'model-preferences';
    readonly value: ExtensionModelPrefs;
} | {
    readonly key: 'project-display-name';
    readonly projectPath: string;
    readonly value: string | null;
};
export type ExtensionSettingsGetSettingResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.settings';
    readonly method: 'get-setting';
    readonly setting: ExtensionSettingsSelectedValue;
};
export type ExtensionSettingsUpdateSettingResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.settings';
    readonly method: 'update-setting';
    readonly setting: ExtensionSettingsSelectedValue;
};
```

### Declarations from `dist/generated/storage.d.ts`

```ts
import type { JsonValue } from '../json.js';
/** Which package store a call uses: package state or package configuration. */
export type ExtensionStorageKind = 'config' | 'state';
/** Which storage scope a call reads or writes. */
export type ExtensionStorageScopeSelector = 'global' | 'project';
/** The storage scope a result belongs to. */
export type ExtensionStorageScope = {
    readonly kind: 'global';
} | {
    readonly kind: 'project';
    readonly projectPath: string;
};
export type ExtensionStorageGetResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.storage';
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
    readonly method: 'get';
    readonly key: string;
    readonly value: JsonValue;
};
export type ExtensionStorageSetResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.storage';
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
    readonly method: 'set';
    readonly key: string;
    readonly value: JsonValue;
    readonly createdAt: number;
    readonly updatedAt: number;
};
export type ExtensionStorageDeleteResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.storage';
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
    readonly method: 'delete';
    readonly key: string;
    readonly deleted: true;
};
export type ExtensionStorageListResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.storage';
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
    readonly method: 'list';
    readonly keys: readonly string[];
};
export type ExtensionRuntimeRegisterContributionResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.runtime';
    readonly family: 'commands' | 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'routes' | 'sessionSummarySections' | 'settingsSections' | 'sidePanels' | 'slashCommands' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
    readonly method: 'register-contribution';
    readonly registeredContributionId: string;
};
export type ExtensionRuntimeUnregisterContributionResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.runtime';
    readonly family: 'commands' | 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'routes' | 'sessionSummarySections' | 'settingsSections' | 'sidePanels' | 'slashCommands' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
    readonly method: 'unregister-contribution';
    readonly unregisteredContributionId: string;
    readonly unregistered: boolean;
};
```

### Declarations from `dist/openwaggle-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { ExtensionInvokeScope, ExtensionStateSelector } from './core-types.js';
export type { ExtensionDocsDiscoverPayload, ExtensionDocsDiscoverResult, ExtensionDocsResolveTopicPayload, ExtensionDocsResolveTopicResult, } from './generated/docs.js';
export type * from './generated/openwaggle.js';
/** The result of reading one state selector; each `ExtensionState*ReadResult` narrows it. */
export interface ExtensionSelectedStateReadResult<TValue> {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE;
    readonly scope: ExtensionInvokeScope;
    readonly selector: ExtensionStateSelector;
    readonly value: TValue;
}
```

### Declarations from `dist/registry-types.d.ts`

```ts
import type { ExtensionCapabilityScope, ExtensionContributionFamily, ExtensionContributionMatchView, ExtensionContributionRuntime, ExtensionContributionTargetView, ExtensionExecutionPlacement } from './contribution-types.js';
import type { ExtensionSessionSummaryDisclosure, ExtensionSessionSummaryRow, ExtensionSessionSummaryState } from './generated/manifest.js';
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
    readonly sessionSummary?: {
        readonly placement: 'context' | 'coordination' | 'details';
        readonly disclosure?: ExtensionSessionSummaryDisclosure;
        readonly state?: ExtensionSessionSummaryState;
        readonly rows: readonly ExtensionSessionSummaryRow[];
    };
}
```

### Declarations from `dist/runtime-types.d.ts`

```ts
export type { ExtensionRuntimeRegisterContributionResult, ExtensionRuntimeUnregisterContributionResult, } from './generated/storage.js';
```

### Declarations from `dist/storage-types.d.ts`

```ts
import type { ExtensionStorageGetResult } from './generated/storage.js';
export type { ExtensionStorageDeleteResult, ExtensionStorageGetResult, ExtensionStorageKind, ExtensionStorageListResult, ExtensionStorageScope, ExtensionStorageScopeSelector, ExtensionStorageSetResult, } from './generated/storage.js';
/** The fields every storage result carries. */
export type ExtensionStorageResultBase = Pick<ExtensionStorageGetResult, 'extensionId' | 'contributionId' | 'capability' | 'storageKind' | 'storageScope'>;
```

### Declarations from `dist/validation-types.d.ts`

```ts
/**
 * One reason a value failed validation. `path` is the dotted field path the host reports in its
 * diagnostics, such as `contributions.sidePanels.0.icon`, with array items by index, and
 * `(root)` for the value itself.
 */
export interface ExtensionValidationIssue {
    readonly path: string;
    readonly message: string;
}
/** What a `validate*` helper returns: the valid value, or every issue it found. */
export type ExtensionValidationResult<TValue> = {
    readonly success: true;
    readonly value: TValue;
} | {
    readonly success: false;
    readonly issues: readonly ExtensionValidationIssue[];
};
```

### Declarations from `dist/syntax.d.ts`

```ts
export type OpenWaggleExtensionSyntaxPriority = 'visible' | 'near-viewport' | 'background';
export interface OpenWaggleExtensionSyntaxHighlightInput {
    readonly source: string;
    readonly language?: string;
    readonly path?: string;
    readonly priority?: OpenWaggleExtensionSyntaxPriority;
}
export interface OpenWaggleExtensionSyntaxToken {
    readonly content: string;
    readonly color?: string;
    readonly backgroundColor?: string;
    readonly fontStyle?: number;
}
export interface OpenWaggleExtensionSyntaxHighlightResult {
    readonly status: 'highlighted' | 'plain-text';
    readonly language: string;
    readonly foreground?: string;
    readonly background?: string;
    readonly lines: readonly (readonly OpenWaggleExtensionSyntaxToken[])[];
    readonly diagnostic?: string;
}
export interface OpenWaggleExtensionSyntaxHighlightOptions {
    readonly signal?: AbortSignal;
}
export interface OpenWaggleExtensionSyntaxSdk {
    readonly highlight: (input: OpenWaggleExtensionSyntaxHighlightInput, options?: OpenWaggleExtensionSyntaxHighlightOptions) => Promise<OpenWaggleExtensionSyntaxHighlightResult>;
}
export declare function createPlainExtensionSyntaxResult(input: {
    readonly source: string;
    readonly language?: string;
    readonly diagnostic?: string;
}): OpenWaggleExtensionSyntaxHighlightResult;
```

### Declarations from `dist/theme.d.ts`

```ts
import type { CreateOpenWaggleExtensionThemeOptions, OpenWaggleExtensionTheme, OpenWaggleExtensionThemeCssVariableEntry } from './theme-types.js';
export { OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES } from './theme-data.js';
export type { CreateOpenWaggleExtensionThemeOptions, ExtensionThemeCssVariableResolver, OpenWaggleExtensionColorScheme, OpenWaggleExtensionTheme, OpenWaggleExtensionThemeCssVariableEntry, OpenWaggleExtensionThemeCssVariables, OpenWaggleExtensionThemeTokens, OpenWaggleExtensionTypeScaleEntry, } from './theme-types.js';
export declare function createOpenWaggleExtensionTheme(options?: CreateOpenWaggleExtensionThemeOptions): OpenWaggleExtensionTheme;
export declare function extensionThemeCssVariableEntries(theme: OpenWaggleExtensionTheme): readonly OpenWaggleExtensionThemeCssVariableEntry[];
```

### Declarations from `dist/theme-types.d.ts`

```ts
export type OpenWaggleExtensionColorScheme = 'dark' | 'light' | 'high-contrast-dark' | 'high-contrast-light';
export interface OpenWaggleExtensionTypeScaleEntry {
    readonly fontSize: string;
    readonly lineHeight: string;
}
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
        readonly dangerText: string;
        readonly warning: string;
        readonly info: string;
        readonly infoText: string;
        readonly review: string;
        readonly plan: string;
        readonly progress: string;
        readonly neutral: string;
    };
    readonly typography: {
        readonly sansFamily: string;
        readonly monoFamily: string;
        readonly typeScale: {
            readonly xs: OpenWaggleExtensionTypeScaleEntry;
            readonly sm: OpenWaggleExtensionTypeScaleEntry;
            readonly base: OpenWaggleExtensionTypeScaleEntry;
            readonly lg: OpenWaggleExtensionTypeScaleEntry;
            readonly xl: OpenWaggleExtensionTypeScaleEntry;
            readonly twoXl: OpenWaggleExtensionTypeScaleEntry;
        };
    };
    readonly spacing: {
        readonly unit: string;
    };
    readonly radius: {
        readonly xs: string;
        readonly sm: string;
        readonly md: string;
        readonly lg: string;
        readonly xl: string;
        readonly twoXl: string;
        readonly threeXl: string;
        readonly fourXl: string;
    };
    readonly shadow: {
        readonly twoXs: string;
        readonly xs: string;
        readonly sm: string;
        readonly md: string;
        readonly lg: string;
        readonly xl: string;
        readonly twoXl: string;
    };
    readonly focus: {
        readonly ring: string;
        readonly shadow: string;
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
    readonly colorScheme?: OpenWaggleExtensionColorScheme;
    readonly resolveCssVariable?: ExtensionThemeCssVariableResolver;
}
```

### Declarations from `dist/theme-data.d.ts`

```ts
export declare const OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES: {
    readonly color: {
        readonly background: '--ow-color-background';
        readonly surface: '--ow-color-surface';
        readonly surfaceRaised: '--ow-color-surface-raised';
        readonly surfaceHover: '--ow-color-surface-hover';
        readonly surfaceActive: '--ow-color-surface-active';
        readonly border: '--ow-color-border';
        readonly borderStrong: '--ow-color-border-strong';
        readonly text: '--ow-color-text';
        readonly textSubtle: '--ow-color-text-subtle';
        readonly textMuted: '--ow-color-text-muted';
        readonly textDim: '--ow-color-text-dim';
        readonly accent: '--ow-color-accent';
        readonly accentDim: '--ow-color-accent-dim';
        readonly success: '--ow-color-success';
        readonly danger: '--ow-color-danger';
        readonly dangerText: '--ow-color-danger-text';
        readonly warning: '--ow-color-warning';
        readonly info: '--ow-color-info';
        readonly infoText: '--ow-color-info-text';
        readonly review: '--ow-color-review';
        readonly plan: '--ow-color-plan';
        readonly progress: '--ow-color-progress';
        readonly neutral: '--ow-color-neutral';
    };
    readonly typography: {
        readonly sansFamily: '--ow-font-family-sans';
        readonly monoFamily: '--ow-font-family-mono';
        readonly typeScale: {
            readonly xs: {
                readonly fontSize: '--ow-text-xs';
                readonly lineHeight: '--ow-text-xs--line-height';
            };
            readonly sm: {
                readonly fontSize: '--ow-text-sm';
                readonly lineHeight: '--ow-text-sm--line-height';
            };
            readonly base: {
                readonly fontSize: '--ow-text-base';
                readonly lineHeight: '--ow-text-base--line-height';
            };
            readonly lg: {
                readonly fontSize: '--ow-text-lg';
                readonly lineHeight: '--ow-text-lg--line-height';
            };
            readonly xl: {
                readonly fontSize: '--ow-text-xl';
                readonly lineHeight: '--ow-text-xl--line-height';
            };
            readonly twoXl: {
                readonly fontSize: '--ow-text-2xl';
                readonly lineHeight: '--ow-text-2xl--line-height';
            };
        };
    };
    readonly spacing: {
        readonly unit: '--ow-spacing';
    };
    readonly radius: {
        readonly xs: '--ow-radius-xs';
        readonly sm: '--ow-radius-sm';
        readonly md: '--ow-radius-md';
        readonly lg: '--ow-radius-lg';
        readonly xl: '--ow-radius-xl';
        readonly twoXl: '--ow-radius-2xl';
        readonly threeXl: '--ow-radius-3xl';
        readonly fourXl: '--ow-radius-4xl';
    };
    readonly shadow: {
        readonly twoXs: '--ow-shadow-2xs';
        readonly xs: '--ow-shadow-xs';
        readonly sm: '--ow-shadow-sm';
        readonly md: '--ow-shadow-md';
        readonly lg: '--ow-shadow-lg';
        readonly xl: '--ow-shadow-xl';
        readonly twoXl: '--ow-shadow-2xl';
    };
    readonly focus: {
        readonly ring: '--ow-focus-ring';
        readonly shadow: '--ow-focus-shadow';
    };
};
export declare const DEFAULT_EXTENSION_THEME_TOKENS: {
    readonly color: {
        readonly background: '#141719';
        readonly surface: '#1a1d22';
        readonly surfaceRaised: '#20242b';
        readonly surfaceHover: '#262b33';
        readonly surfaceActive: '#2b313a';
        readonly border: '#1e2229';
        readonly borderStrong: '#2a3240';
        readonly text: '#e7e9ee';
        readonly textSubtle: '#c9cdd6';
        readonly textMuted: '#9098a8';
        readonly textDim: '#8f98a8';
        readonly accent: '#f5a623';
        readonly accentDim: '#d18a2c';
        readonly success: '#4caf72';
        readonly danger: '#ef4444';
        readonly dangerText: '#f87171';
        readonly warning: '#f97316';
        readonly info: '#3b82f6';
        readonly infoText: '#60a5fa';
        readonly review: '#a78bfa';
        readonly plan: '#e879f9';
        readonly progress: '#7dd3fc';
        readonly neutral: '#9098a8';
    };
    readonly typography: {
        readonly sansFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';
        readonly monoFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
        readonly typeScale: {
            readonly xs: {
                readonly fontSize: '0.75rem';
                readonly lineHeight: 'calc(1 / 0.75)';
            };
            readonly sm: {
                readonly fontSize: '0.875rem';
                readonly lineHeight: 'calc(1.25 / 0.875)';
            };
            readonly base: {
                readonly fontSize: '1rem';
                readonly lineHeight: 'calc(1.5 / 1)';
            };
            readonly lg: {
                readonly fontSize: '1.125rem';
                readonly lineHeight: 'calc(1.75 / 1.125)';
            };
            readonly xl: {
                readonly fontSize: '1.25rem';
                readonly lineHeight: 'calc(1.75 / 1.25)';
            };
            readonly twoXl: {
                readonly fontSize: '1.5rem';
                readonly lineHeight: 'calc(2 / 1.5)';
            };
        };
    };
    readonly spacing: {
        readonly unit: '0.25rem';
    };
    readonly radius: {
        readonly xs: '0.125rem';
        readonly sm: '0.25rem';
        readonly md: '0.375rem';
        readonly lg: '0.5rem';
        readonly xl: '0.75rem';
        readonly twoXl: '1rem';
        readonly threeXl: '1.5rem';
        readonly fourXl: '2rem';
    };
    readonly shadow: {
        readonly twoXs: '0 1px rgb(0 0 0 / 0.05)';
        readonly xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)';
        readonly sm: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)';
        readonly md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)';
        readonly lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)';
        readonly xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)';
        readonly twoXl: '0 25px 50px -12px rgb(0 0 0 / 0.25)';
    };
    readonly focus: {
        readonly ring: 'transparent';
        readonly shadow: 'none';
    };
};
export declare const SOURCE_EXTENSION_THEME_CSS_VARIABLES: {
    readonly color: {
        readonly background: '--color-bg';
        readonly surface: '--color-bg-secondary';
        readonly surfaceRaised: '--color-bg-tertiary';
        readonly surfaceHover: '--color-bg-hover';
        readonly surfaceActive: '--color-bg-active';
        readonly border: '--color-border';
        readonly borderStrong: '--color-border-light';
        readonly text: '--color-text-primary';
        readonly textSubtle: '--color-text-secondary';
        readonly textMuted: '--color-text-tertiary';
        readonly textDim: '--color-text-muted';
        readonly accent: '--color-accent';
        readonly accentDim: '--color-accent-dim';
        readonly success: '--color-success';
        readonly danger: '--color-error';
        readonly dangerText: '--color-error-text';
        readonly warning: '--color-warning';
        readonly info: '--color-info';
        readonly infoText: '--color-info-text';
        readonly review: '--color-review';
        readonly plan: '--color-plan';
        readonly progress: '--color-progress';
        readonly neutral: '--color-neutral';
    };
    readonly typography: {
        readonly sansFamily: '--font-sans';
        readonly monoFamily: '--font-mono';
        readonly typeScale: {
            readonly xs: {
                readonly fontSize: '--text-xs';
                readonly lineHeight: '--text-xs--line-height';
            };
            readonly sm: {
                readonly fontSize: '--text-sm';
                readonly lineHeight: '--text-sm--line-height';
            };
            readonly base: {
                readonly fontSize: '--text-base';
                readonly lineHeight: '--text-base--line-height';
            };
            readonly lg: {
                readonly fontSize: '--text-lg';
                readonly lineHeight: '--text-lg--line-height';
            };
            readonly xl: {
                readonly fontSize: '--text-xl';
                readonly lineHeight: '--text-xl--line-height';
            };
            readonly twoXl: {
                readonly fontSize: '--text-2xl';
                readonly lineHeight: '--text-2xl--line-height';
            };
        };
    };
    readonly spacing: {
        readonly unit: '--spacing';
    };
    readonly radius: {
        readonly xs: '--radius-xs';
        readonly sm: '--radius-sm';
        readonly md: '--radius-md';
        readonly lg: '--radius-lg';
        readonly xl: '--radius-xl';
        readonly twoXl: '--radius-2xl';
        readonly threeXl: '--radius-3xl';
        readonly fourXl: '--radius-4xl';
    };
    readonly shadow: {
        readonly twoXs: '--shadow-2xs';
        readonly xs: '--shadow-xs';
        readonly sm: '--shadow-sm';
        readonly md: '--shadow-md';
        readonly lg: '--shadow-lg';
        readonly xl: '--shadow-xl';
        readonly twoXl: '--shadow-2xl';
    };
    readonly focus: {
        readonly ring: '--focus-ring';
        readonly shadow: '--focus-shadow';
    };
};
export declare const EXTENSION_THEME_COLOR_KEYS: readonly ['background', 'surface', 'surfaceRaised', 'surfaceHover', 'surfaceActive', 'border', 'borderStrong', 'text', 'textSubtle', 'textMuted', 'textDim', 'accent', 'accentDim', 'success', 'danger', 'dangerText', 'warning', 'info', 'infoText', 'review', 'plan', 'progress', 'neutral'];
export declare const EXTENSION_THEME_TYPE_SCALE_KEYS: readonly ['xs', 'sm', 'base', 'lg', 'xl', 'twoXl'];
export declare const EXTENSION_THEME_TYPE_SCALE_ENTRY_KEYS: readonly ['fontSize', 'lineHeight'];
export declare const EXTENSION_THEME_SPACING_KEYS: readonly ['unit'];
export declare const EXTENSION_THEME_RADIUS_KEYS: readonly ['xs', 'sm', 'md', 'lg', 'xl', 'twoXl', 'threeXl', 'fourXl'];
export declare const EXTENSION_THEME_SHADOW_KEYS: readonly ['twoXs', 'xs', 'sm', 'md', 'lg', 'xl', 'twoXl'];
export declare const EXTENSION_THEME_FOCUS_KEYS: readonly ['ring', 'shadow'];
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
    readonly root: 'ow-extension-root';
    readonly panel: 'ow-extension-panel';
    readonly stack: 'ow-extension-stack';
    readonly row: 'ow-extension-row';
    readonly heading: 'ow-extension-heading';
    readonly text: 'ow-extension-text';
    readonly muted: 'ow-extension-muted';
    readonly divider: 'ow-extension-divider';
    readonly button: 'ow-extension-button';
    readonly input: 'ow-extension-input';
    readonly textarea: 'ow-extension-textarea';
    readonly select: 'ow-extension-select';
    readonly checkbox: 'ow-extension-checkbox';
    readonly badge: 'ow-extension-badge';
    readonly field: 'ow-extension-field';
    readonly alert: 'ow-extension-alert';
    readonly syntaxBlock: 'ow-syntax-block';
    readonly syntaxLineNumber: 'ow-syntax-line-number';
};
export declare const OPENWAGGLE_EXTENSION_UI_ATTRIBUTES: {
    readonly tone: 'data-ow-tone';
    readonly variant: 'data-ow-variant';
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

## Export `./docs`

Types: `dist/docs.d.ts`

### Declarations from `dist/docs.d.ts`

```ts
export type * from './generated/docs.js';
```

### Declarations from `dist/generated/docs.d.ts`

```ts
export type ExtensionDocsDiscoverPayload = {
    readonly projectPaths?: readonly string[];
    readonly includeExtensions?: boolean;
};
export type ExtensionDocsResolveTopicPayload = {
    readonly topic: string;
};
export type ExtensionDocsDiscoverResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.docs';
    readonly method: 'discover-docs';
    readonly docs: ExtensionDocsDiscoveryView;
};
export type ExtensionDocsResolveTopicResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.docs';
    readonly method: 'resolve-docs-topic';
    readonly resolvedTopic: FirstPartyDocsTopicSummary | null;
};
export type ExtensionDocsDiscoveryView = {
    readonly generatedAt: string;
    readonly bundlePath: string;
    readonly firstPartyTopics: readonly FirstPartyDocsTopicSummary[];
    readonly extensionTopics: readonly {
        readonly topic: string;
        readonly localTopic: string;
        readonly title: string;
        readonly description?: string;
        readonly path: string;
        readonly aliases: readonly string[];
        readonly keywords: readonly string[];
        readonly contentHash: string | null;
        readonly provenance: {
            readonly extensionId: string;
            readonly extensionName: string | null;
            readonly extensionVersion: string | null;
            readonly scope: {
                readonly kind: 'global' | 'project';
                readonly label: string;
                readonly projectPath?: string;
            };
            readonly packagePath: string;
            readonly manifestPath: string;
            readonly path: string;
            readonly packageContentHash: string | null;
            readonly trust: 'trusted' | 'unknown' | 'untrusted';
            readonly lifecycle: 'disabled' | 'enabled' | 'unavailable';
        };
        readonly diagnostics: readonly {
            readonly severity: 'error' | 'warning';
            readonly code: string;
            readonly message: string;
            readonly path?: string;
        }[];
    }[];
    readonly diagnostics: readonly {
        readonly severity: 'error' | 'warning';
        readonly code: string;
        readonly message: string;
        readonly path?: string;
    }[];
};
export type FirstPartyDocsTopicSummary = {
    readonly topic: string;
    readonly source: 'openwaggle' | 'pi';
    readonly group: string;
    readonly title: string;
    readonly description?: string;
    readonly section?: string;
    readonly order: number;
    readonly path: string;
    readonly bundlePath: string;
    readonly sourcePath: string;
    readonly aliases: readonly string[];
    readonly keywords: readonly string[];
    readonly contentHash: string;
};
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

## Export `./runtime`

Types: `dist/runtime.d.ts`

### Declarations from `dist/runtime.d.ts`

```ts
export type { ExtensionContributionRegistration, ExtensionContributionUnregistration, } from './generated/manifest.js';
export type * from './runtime-types.js';
```

### Declarations from `dist/generated/manifest.d.ts`

```ts
/** The scopes a broker capability can be called in. */
export type ExtensionCapabilityScope = 'app' | 'branch' | 'project' | 'session';
/** A contribution family: the manifest key a contribution is declared under. */
export type ExtensionContributionFamily = 'commands' | 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'routes' | 'sessionSummarySections' | 'settingsSections' | 'sidePanels' | 'slashCommands' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
/** How a contribution's entry module runs. */
export type ExtensionContributionRuntime = 'federated-module' | 'trusted-renderer';
/** Where a contribution's entry module runs. */
export type ExtensionExecutionPlacement = 'frame' | 'host-renderer';
/** Whether OpenWaggle installs the package's prebuilt artifacts or builds it locally. */
export type ExtensionInstallSource = 'local-build' | 'prebuilt';
/** The projects and sessions a contribution is limited to. */
export type ExtensionContributionTargetView = {
    readonly projectPaths?: readonly string[];
    readonly sessionIds?: readonly string[];
};
/** The tool calls, custom messages and interactions a renderer contribution handles. */
export type ExtensionContributionMatchView = {
    readonly toolNames?: readonly string[];
    readonly customMessageNames?: readonly string[];
    readonly interactionKinds?: readonly string[];
};
/** A broker capability the extension uses, with the methods and scopes it calls. */
export type ExtensionCapabilityDeclaration = {
    readonly id: string;
    readonly methods?: readonly string[];
    readonly scopes?: readonly ExtensionCapabilityScope[];
};
/** A command or slash command. */
export type ExtensionCommandContribution = {
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly id: string;
    readonly title: string;
    readonly category?: string;
    readonly target?: ExtensionContributionTargetView;
};
/**
 * A contribution that mounts an entry module: a route, or a settings section, dialog, renderer
 * or status widget.
 */
export type ExtensionSurfaceContribution = {
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly id: string;
    readonly title: string;
    readonly runtime: ExtensionContributionRuntime;
    readonly execution: ExtensionExecutionPlacement;
    readonly entry: string;
    readonly target?: ExtensionContributionTargetView;
    readonly matches?: ExtensionContributionMatchView;
};
/** A side panel's Panel rail icon: a Lucide icon name in kebab-case, or a package `.svg` file. */
export type ExtensionSidePanelIcon = string | {
    readonly svg: string;
};
/** A side panel, with its optional Panel rail icon. */
export type ExtensionSidePanelContribution = {
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly id: string;
    readonly title: string;
    readonly runtime: ExtensionContributionRuntime;
    readonly execution: ExtensionExecutionPlacement;
    readonly entry: string;
    readonly target?: ExtensionContributionTargetView;
    readonly matches?: ExtensionContributionMatchView;
    readonly icon?: ExtensionSidePanelIcon;
};
/** Any contribution that mounts an entry module. */
export type ExtensionEntryContribution = ExtensionSidePanelContribution | ExtensionSurfaceContribution;
/** A row of a Session Summary section. */
export type ExtensionSessionSummaryRow = {
    readonly id: string;
    readonly label: string;
    readonly value?: string;
    readonly badge?: string;
    readonly count?: number;
    readonly resourceId?: string;
    readonly action?: {
        readonly family: 'commands' | 'dialogs' | 'sidePanels';
        readonly contributionId: string;
    };
};
/** Whether a Session Summary section starts expanded, can collapse, and collapses by itself. */
export type ExtensionSessionSummaryDisclosure = {
    readonly defaultExpanded?: boolean;
    readonly collapsible?: boolean;
    readonly autoCollapseAfterMs?: number;
};
/** The status a Session Summary section shows. */
export type ExtensionSessionSummaryState = {
    readonly status: 'failure';
    readonly message: string;
} | {
    readonly status: 'live' | 'loading';
    readonly message?: string;
} | {
    readonly status: 'ready';
};
/** A declarative Session Summary section. */
export type ExtensionSessionSummaryContribution = {
    readonly id: string;
    readonly title: string;
    readonly placement?: 'context' | 'coordination' | 'details';
    readonly target?: ExtensionContributionTargetView;
    readonly disclosure?: ExtensionSessionSummaryDisclosure;
    readonly state?: ExtensionSessionSummaryState;
    readonly rows: readonly ExtensionSessionSummaryRow[];
};
/** Every contribution a manifest declares, by family. */
export type ExtensionContributions = {
    readonly commands?: readonly ExtensionCommandContribution[];
    readonly slashCommands?: readonly ExtensionCommandContribution[];
    readonly routes?: readonly ExtensionSurfaceContribution[];
    readonly settingsSections?: readonly ExtensionSurfaceContribution[];
    readonly sidePanels?: readonly ExtensionSidePanelContribution[];
    readonly dialogs?: readonly ExtensionSurfaceContribution[];
    readonly transcriptRenderers?: readonly ExtensionSurfaceContribution[];
    readonly toolRenderers?: readonly ExtensionSurfaceContribution[];
    readonly customMessageRenderers?: readonly ExtensionSurfaceContribution[];
    readonly interactionRenderers?: readonly ExtensionSurfaceContribution[];
    readonly statusWidgets?: readonly ExtensionSurfaceContribution[];
    readonly sessionSummarySections?: readonly ExtensionSessionSummaryContribution[];
};
/** A contribution registered at runtime, with its family. */
export type ExtensionContributionRegistration = {
    readonly family: 'commands' | 'slashCommands';
    readonly contribution: ExtensionCommandContribution;
} | {
    readonly family: 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'settingsSections' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
    readonly contribution: ExtensionSurfaceContribution;
} | {
    readonly family: 'routes';
    readonly contribution: ExtensionSurfaceContribution;
} | {
    readonly family: 'sessionSummarySections';
    readonly contribution: ExtensionSessionSummaryContribution;
} | {
    readonly family: 'sidePanels';
    readonly contribution: ExtensionSidePanelContribution;
};
/** A runtime contribution to remove, by family and id. */
export type ExtensionContributionUnregistration = {
    readonly family: ExtensionContributionFamily;
    readonly contributionId: string;
};
/** A binary or package command the extension needs before it runs. */
export type ExtensionRuntimeRequirementDeclaration = {
    readonly id: string;
    readonly label: string;
    readonly kind?: 'binary' | 'command';
    readonly command?: string;
    readonly binary?: string;
};
/** A documentation topic the extension ships. */
export type ExtensionDocsTopicDeclaration = {
    readonly id: string;
    readonly title: string;
    readonly path: string;
    readonly description?: string;
    readonly aliases?: readonly string[];
    readonly keywords?: readonly string[];
};
/** An `openwaggle.extension.json` manifest. */
export type OpenWaggleExtensionManifest = {
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
        readonly topics?: readonly ExtensionDocsTopicDeclaration[];
    };
    readonly network?: {
        readonly origins: readonly string[];
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
};
```

### Declarations from `dist/runtime-types.d.ts`

```ts
export type { ExtensionRuntimeRegisterContributionResult, ExtensionRuntimeUnregisterContributionResult, } from './generated/storage.js';
```

### Declarations from `dist/generated/storage.d.ts`

```ts
import type { JsonValue } from '../json.js';
/** Which package store a call uses: package state or package configuration. */
export type ExtensionStorageKind = 'config' | 'state';
/** Which storage scope a call reads or writes. */
export type ExtensionStorageScopeSelector = 'global' | 'project';
/** The storage scope a result belongs to. */
export type ExtensionStorageScope = {
    readonly kind: 'global';
} | {
    readonly kind: 'project';
    readonly projectPath: string;
};
export type ExtensionStorageGetResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.storage';
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
    readonly method: 'get';
    readonly key: string;
    readonly value: JsonValue;
};
export type ExtensionStorageSetResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.storage';
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
    readonly method: 'set';
    readonly key: string;
    readonly value: JsonValue;
    readonly createdAt: number;
    readonly updatedAt: number;
};
export type ExtensionStorageDeleteResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.storage';
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
    readonly method: 'delete';
    readonly key: string;
    readonly deleted: true;
};
export type ExtensionStorageListResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.storage';
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
    readonly method: 'list';
    readonly keys: readonly string[];
};
export type ExtensionRuntimeRegisterContributionResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.runtime';
    readonly family: 'commands' | 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'routes' | 'sessionSummarySections' | 'settingsSections' | 'sidePanels' | 'slashCommands' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
    readonly method: 'register-contribution';
    readonly registeredContributionId: string;
};
export type ExtensionRuntimeUnregisterContributionResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.runtime';
    readonly family: 'commands' | 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'routes' | 'sessionSummarySections' | 'settingsSections' | 'sidePanels' | 'slashCommands' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
    readonly method: 'unregister-contribution';
    readonly unregisteredContributionId: string;
    readonly unregistered: boolean;
};
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

## Export `./syntax`

Types: `dist/syntax.d.ts`

### Declarations from `dist/syntax.d.ts`

```ts
export type OpenWaggleExtensionSyntaxPriority = 'visible' | 'near-viewport' | 'background';
export interface OpenWaggleExtensionSyntaxHighlightInput {
    readonly source: string;
    readonly language?: string;
    readonly path?: string;
    readonly priority?: OpenWaggleExtensionSyntaxPriority;
}
export interface OpenWaggleExtensionSyntaxToken {
    readonly content: string;
    readonly color?: string;
    readonly backgroundColor?: string;
    readonly fontStyle?: number;
}
export interface OpenWaggleExtensionSyntaxHighlightResult {
    readonly status: 'highlighted' | 'plain-text';
    readonly language: string;
    readonly foreground?: string;
    readonly background?: string;
    readonly lines: readonly (readonly OpenWaggleExtensionSyntaxToken[])[];
    readonly diagnostic?: string;
}
export interface OpenWaggleExtensionSyntaxHighlightOptions {
    readonly signal?: AbortSignal;
}
export interface OpenWaggleExtensionSyntaxSdk {
    readonly highlight: (input: OpenWaggleExtensionSyntaxHighlightInput, options?: OpenWaggleExtensionSyntaxHighlightOptions) => Promise<OpenWaggleExtensionSyntaxHighlightResult>;
}
export declare function createPlainExtensionSyntaxResult(input: {
    readonly source: string;
    readonly language?: string;
    readonly diagnostic?: string;
}): OpenWaggleExtensionSyntaxHighlightResult;
```

## Export `./testing`

Types: `dist/testing.d.ts`

### Declarations from `dist/testing.d.ts`

```ts
/**
 * Broker SDK factories for extension tests and standalone previews. Inside OpenWaggle the host
 * passes the broker SDK as `context.sdk`; build one here over a transport you control to test code
 * that takes it. This entry bundles the SDK's result decoders.
 */
export { createExtensionBrokerSdk, createExtensionBrokerSdkFromInvoke, toInvokeInput, } from './internal/broker-sdk.js';
export { createRuntimeContributionSdk } from './internal/runtime-sdk.js';
export type { CreateOpenWaggleSdkOptions, ExtensionBrokerSdk, ExtensionBrokerTransport, ExtensionSdkIdentity, ExtensionSdkInvoke, ExtensionSdkInvokeRequest, } from './sdk-types.js';
```

### Declarations from `dist/internal/broker-sdk.d.ts`

```ts
import type { CreateOpenWaggleSdkOptions, ExtensionBrokerSdk, ExtensionBrokerTransport, ExtensionSdkIdentity, ExtensionSdkInvoke, ExtensionSdkInvokeRequest } from '../sdk-types.js';
import type { ExtensionInvokeInput } from '../types.js';
export declare const toInvokeInput: (identity: ExtensionSdkIdentity, request: ExtensionSdkInvokeRequest) => ExtensionInvokeInput;
export declare function createExtensionBrokerSdkFromInvoke(invoke: ExtensionSdkInvoke, options?: CreateOpenWaggleSdkOptions): ExtensionBrokerSdk;
export declare function createExtensionBrokerSdk(transport: ExtensionBrokerTransport, identity: ExtensionSdkIdentity, options?: CreateOpenWaggleSdkOptions): ExtensionBrokerSdk;
```

### Declarations from `dist/sdk-types.d.ts`

```ts
import type { JsonValue } from './json.js';
import type { ExtensionActionSelectProjectResult, ExtensionDocsDiscoverPayload, ExtensionDocsDiscoverResult, ExtensionDocsResolveTopicPayload, ExtensionDocsResolveTopicResult, ExtensionInvokeFailure, ExtensionInvokeInput, ExtensionInvokeResult, ExtensionInvokeScope, ExtensionInvokeSuccess, ExtensionModelPreferencesSettingsPatch, ExtensionRuntimeRegisterContributionPayload, ExtensionRuntimeRegisterContributionResult, ExtensionRuntimeUnregisterContributionPayload, ExtensionRuntimeUnregisterContributionResult, ExtensionSessionResourcePublishPayload, ExtensionSessionResourcePublishResult, ExtensionSessionResourcesListPayload, ExtensionSessionResourcesListResult, ExtensionSettingsGetResult, ExtensionSettingsGetSettingResult, ExtensionSettingsUpdatePayload, ExtensionSettingsUpdateResult, ExtensionSettingsUpdateSettingResult, ExtensionStateCurrentBranchReadResult, ExtensionStateCurrentProjectReadResult, ExtensionStateCurrentSessionReadResult, ExtensionStateModelPreferencesReadResult, ExtensionStateReadResult, ExtensionStateRecentProjectsReadResult, ExtensionStorageDeleteResult, ExtensionStorageGetResult, ExtensionStorageListResult, ExtensionStorageSetResult } from './types.js';
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
export type ExtensionSessionResourcesListOperationResult = ExtensionOperationSuccess<ExtensionSessionResourcesListResult> | ExtensionInvokeFailure;
export type ExtensionSessionResourcePublishOperationResult = ExtensionOperationSuccess<ExtensionSessionResourcePublishResult> | ExtensionInvokeFailure;
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
    readonly resources: ExtensionOpenWaggleResourcesSdk;
}
export type ExtensionSessionInvokeScope = Extract<ExtensionInvokeScope, {
    readonly kind: 'session';
}>;
export interface ExtensionOpenWaggleResourcesSdk {
    readonly list: (scope: ExtensionSessionInvokeScope, input?: ExtensionSessionResourcesListPayload) => Promise<ExtensionInvokeResult<ExtensionSessionResourcesListResult>>;
    readonly publish: (scope: ExtensionSessionInvokeScope, resource: ExtensionSessionResourcePublishPayload) => Promise<ExtensionInvokeResult<ExtensionSessionResourcePublishResult>>;
}
/** @deprecated Use {@link ExtensionOpenWaggleResourcesSdk}. */
export type ExtensionOpenWaggleSessionResourcesSdk = ExtensionOpenWaggleResourcesSdk;
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
export type * from './validation-types.js';
```

### Declarations from `dist/contribution-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION } from './constants.js';
import type { ExtensionContributionRegistration, ExtensionContributionUnregistration } from './generated/manifest.js';
export type { ExtensionCapabilityScope, ExtensionContributionFamily, ExtensionContributionMatchView, ExtensionContributionRuntime, ExtensionContributionTargetView, ExtensionExecutionPlacement, ExtensionInstallSource, } from './generated/manifest.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionNetworkAccessMode = ConstantValue<typeof OPENWAGGLE_EXTENSION.NETWORK_ACCESS_MODE>;
export type ExtensionRuntimeRegisterContributionPayload = ExtensionContributionRegistration;
export type ExtensionRuntimeUnregisterContributionPayload = ExtensionContributionUnregistration;
```

### Declarations from `dist/constants.d.ts`

```ts
export declare const OPENWAGGLE_EXTENSION_BROKER: {
    readonly CAPABILITY: {
        readonly HOST_CONTEXT: 'openwaggle.host.context';
        readonly STORAGE: 'openwaggle.storage';
        readonly STATE: 'openwaggle.state';
        readonly ACTIONS: 'openwaggle.actions';
        readonly SETTINGS: 'openwaggle.settings';
        readonly DOCS: 'openwaggle.docs';
        readonly RUNTIME: 'openwaggle.runtime';
        readonly RESOURCES: 'openwaggle.resources';
    };
    readonly CAPABILITIES: readonly ("openwaggle.actions" | "openwaggle.docs" | "openwaggle.host.context" | "openwaggle.resources" | "openwaggle.runtime" | "openwaggle.settings" | "openwaggle.state" | "openwaggle.storage")[];
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
    }, {
        readonly capability: "openwaggle.resources";
        readonly methods: readonly ["list-resources", "publish-resource"];
    }];
    readonly METHOD: {
        readonly GET_SCOPE: 'get-scope';
        readonly GET: 'get';
        readonly SET: 'set';
        readonly DELETE: 'delete';
        readonly LIST: 'list';
        readonly GET_STATE: 'get-state';
        readonly READ_STATE: 'read-state';
        readonly SELECT_PROJECT: 'select-project';
        readonly GET_SETTINGS: 'get-settings';
        readonly UPDATE_SETTINGS: 'update-settings';
        readonly GET_SETTING: 'get-setting';
        readonly UPDATE_SETTING: 'update-setting';
        readonly DISCOVER_DOCS: 'discover-docs';
        readonly RESOLVE_DOCS_TOPIC: 'resolve-docs-topic';
        readonly REGISTER_CONTRIBUTION: 'register-contribution';
        readonly UNREGISTER_CONTRIBUTION: 'unregister-contribution';
        readonly LIST_RESOURCES: 'list-resources';
        readonly PUBLISH_RESOURCE: 'publish-resource';
    };
    readonly METHODS: readonly ("delete" | "discover-docs" | "get" | "get-scope" | "get-setting" | "get-settings" | "get-state" | "list" | "list-resources" | "publish-resource" | "read-state" | "register-contribution" | "resolve-docs-topic" | "select-project" | "set" | "unregister-contribution" | "update-setting" | "update-settings")[];
    readonly FAILURE_CODE: {
        readonly INVALID_INPUT: 'invalid-input';
        readonly INVALID_PAYLOAD: 'invalid-payload';
        readonly UNKNOWN_EXTENSION: 'unknown-extension';
        readonly DISABLED_EXTENSION: 'disabled-extension';
        readonly UNKNOWN_CONTRIBUTION: 'unknown-contribution';
        readonly UNDECLARED_CAPABILITY: 'undeclared-capability';
        readonly UNDECLARED_METHOD: 'undeclared-method';
        readonly UNDECLARED_SCOPE: 'undeclared-scope';
        readonly OUT_OF_SCOPE: 'out-of-scope';
        readonly UNSUPPORTED_CAPABILITY: 'unsupported-capability';
        readonly UNSUPPORTED_METHOD: 'unsupported-method';
        readonly TRANSPORT_FAILED: 'transport-failed';
    };
    readonly FAILURE_CODES: readonly ("disabled-extension" | "invalid-input" | "invalid-payload" | "out-of-scope" | "transport-failed" | "undeclared-capability" | "undeclared-method" | "undeclared-scope" | "unknown-contribution" | "unknown-extension" | "unsupported-capability" | "unsupported-method")[];
    readonly OUTCOME: {
        readonly SUCCEEDED: 'succeeded';
        readonly REJECTED: 'rejected';
    };
    readonly OUTCOMES: readonly ("rejected" | "succeeded")[];
    readonly STATE_SELECTOR: {
        readonly CURRENT_PROJECT: 'current-project';
        readonly CURRENT_SESSION: 'current-session';
        readonly CURRENT_BRANCH: 'current-branch';
        readonly RECENT_PROJECTS: 'recent-projects';
        readonly MODEL_PREFERENCES: 'model-preferences';
    };
    readonly STATE_SELECTORS: readonly ("current-branch" | "current-project" | "current-session" | "model-preferences" | "recent-projects")[];
    readonly SETTING_KEY: {
        readonly MODEL_PREFERENCES: 'model-preferences';
        readonly PROJECT_DISPLAY_NAME: 'project-display-name';
    };
    readonly SETTING_KEYS: readonly ("model-preferences" | "project-display-name")[];
};
export declare const OPENWAGGLE_EXTENSION: {
    readonly MANIFEST_FILE: 'openwaggle.extension.json';
    readonly SDK_VERSION: '0.1.0';
    readonly PROJECT_ROOT_SEGMENTS: readonly ['.openwaggle', 'extensions'];
    readonly GLOBAL_EXTENSIONS_DIR: 'extensions';
    readonly SCOPE: {
        readonly GLOBAL_KIND: 'global';
        readonly PROJECT_KIND: 'project';
        readonly GLOBAL_ID: 'global';
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
    readonly PATTERNS: {
        readonly WINDOWS_ABSOLUTE_PATH: RegExp;
        readonly ID: RegExp;
        readonly CONTRIBUTION_ID: RegExp;
        readonly SEMVER_VERSION: RegExp;
    };
    readonly PATH: {
        readonly NUL_CHARACTER: '\0';
        readonly POSIX_SEPARATOR: '/';
        readonly WINDOWS_SEPARATOR: '\\';
        readonly RELATIVE_PARENT_SEGMENT: '..';
        readonly CURRENT_DIRECTORY_SEGMENT: '.';
    };
    readonly RUNTIME_MODULE_PROTOCOL: {
        readonly MODULE_CONTEXT_SEGMENT: '__context__';
    };
    readonly CAPABILITY_SCOPES: readonly ['app', 'project', 'session', 'branch'];
    readonly CONTRIBUTION_FAMILY: {
        readonly COMMANDS: 'commands';
        readonly SLASH_COMMANDS: 'slashCommands';
        readonly ROUTES: 'routes';
        readonly SETTINGS_SECTIONS: 'settingsSections';
        readonly SIDE_PANELS: 'sidePanels';
        readonly DIALOGS: 'dialogs';
        readonly TRANSCRIPT_RENDERERS: 'transcriptRenderers';
        readonly TOOL_RENDERERS: 'toolRenderers';
        readonly CUSTOM_MESSAGE_RENDERERS: 'customMessageRenderers';
        readonly INTERACTION_RENDERERS: 'interactionRenderers';
        readonly STATUS_WIDGETS: 'statusWidgets';
        readonly SESSION_SUMMARY_SECTIONS: 'sessionSummarySections';
    };
    readonly CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands", "routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets", "sessionSummarySections"];
    readonly COMMAND_CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands"];
    readonly CONTRIBUTION_RUNTIME: {
        readonly FEDERATED_MODULE: 'federated-module';
        readonly TRUSTED_RENDERER: 'trusted-renderer';
    };
    readonly CONTRIBUTION_RUNTIMES: readonly ("federated-module" | "trusted-renderer")[];
    readonly EXECUTION_PLACEMENT: {
        readonly HOST_RENDERER: 'host-renderer';
        readonly FRAME: 'frame';
    };
    readonly EXECUTION_PLACEMENTS: readonly ("frame" | "host-renderer")[];
    readonly STORAGE: {
        readonly KIND: {
            readonly STATE: 'state';
            readonly CONFIG: 'config';
        };
        readonly KINDS: readonly ("config" | "state")[];
        readonly SCOPE: {
            readonly GLOBAL_KIND: 'global';
            readonly PROJECT_KIND: 'project';
            readonly GLOBAL_ID: 'global';
        };
        readonly SCOPE_KINDS: readonly ("global" | "project")[];
        readonly KEY_MAX_LENGTH: 160;
    };
    readonly ENTRY_CONTRIBUTION_FAMILIES: readonly ["routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly SLOT_CONTRIBUTION_FAMILIES: readonly ["settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly INSTALL_SOURCE: {
        readonly PREBUILT: 'prebuilt';
        readonly LOCAL_BUILD: 'local-build';
    };
    readonly INSTALL_SOURCES: readonly ("local-build" | "prebuilt")[];
    readonly RUNTIME_REQUIREMENT_TYPE: {
        readonly BINARY: 'binary';
        readonly COMMAND: 'command';
    };
    readonly RUNTIME_REQUIREMENT_TYPES: readonly ("binary" | "command")[];
    readonly NETWORK_ACCESS_MODE: {
        readonly BROKERED: 'brokered';
        readonly RESTRICTED: 'restricted';
        readonly DIRECT: 'direct';
    };
    readonly NETWORK_ACCESS_MODES: readonly ("brokered" | "direct" | "restricted")[];
};
```

### Declarations from `dist/generated/manifest.d.ts`

```ts
/** The scopes a broker capability can be called in. */
export type ExtensionCapabilityScope = 'app' | 'branch' | 'project' | 'session';
/** A contribution family: the manifest key a contribution is declared under. */
export type ExtensionContributionFamily = 'commands' | 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'routes' | 'sessionSummarySections' | 'settingsSections' | 'sidePanels' | 'slashCommands' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
/** How a contribution's entry module runs. */
export type ExtensionContributionRuntime = 'federated-module' | 'trusted-renderer';
/** Where a contribution's entry module runs. */
export type ExtensionExecutionPlacement = 'frame' | 'host-renderer';
/** Whether OpenWaggle installs the package's prebuilt artifacts or builds it locally. */
export type ExtensionInstallSource = 'local-build' | 'prebuilt';
/** The projects and sessions a contribution is limited to. */
export type ExtensionContributionTargetView = {
    readonly projectPaths?: readonly string[];
    readonly sessionIds?: readonly string[];
};
/** The tool calls, custom messages and interactions a renderer contribution handles. */
export type ExtensionContributionMatchView = {
    readonly toolNames?: readonly string[];
    readonly customMessageNames?: readonly string[];
    readonly interactionKinds?: readonly string[];
};
/** A broker capability the extension uses, with the methods and scopes it calls. */
export type ExtensionCapabilityDeclaration = {
    readonly id: string;
    readonly methods?: readonly string[];
    readonly scopes?: readonly ExtensionCapabilityScope[];
};
/** A command or slash command. */
export type ExtensionCommandContribution = {
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly id: string;
    readonly title: string;
    readonly category?: string;
    readonly target?: ExtensionContributionTargetView;
};
/**
 * A contribution that mounts an entry module: a route, or a settings section, dialog, renderer
 * or status widget.
 */
export type ExtensionSurfaceContribution = {
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly id: string;
    readonly title: string;
    readonly runtime: ExtensionContributionRuntime;
    readonly execution: ExtensionExecutionPlacement;
    readonly entry: string;
    readonly target?: ExtensionContributionTargetView;
    readonly matches?: ExtensionContributionMatchView;
};
/** A side panel's Panel rail icon: a Lucide icon name in kebab-case, or a package `.svg` file. */
export type ExtensionSidePanelIcon = string | {
    readonly svg: string;
};
/** A side panel, with its optional Panel rail icon. */
export type ExtensionSidePanelContribution = {
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly id: string;
    readonly title: string;
    readonly runtime: ExtensionContributionRuntime;
    readonly execution: ExtensionExecutionPlacement;
    readonly entry: string;
    readonly target?: ExtensionContributionTargetView;
    readonly matches?: ExtensionContributionMatchView;
    readonly icon?: ExtensionSidePanelIcon;
};
/** Any contribution that mounts an entry module. */
export type ExtensionEntryContribution = ExtensionSidePanelContribution | ExtensionSurfaceContribution;
/** A row of a Session Summary section. */
export type ExtensionSessionSummaryRow = {
    readonly id: string;
    readonly label: string;
    readonly value?: string;
    readonly badge?: string;
    readonly count?: number;
    readonly resourceId?: string;
    readonly action?: {
        readonly family: 'commands' | 'dialogs' | 'sidePanels';
        readonly contributionId: string;
    };
};
/** Whether a Session Summary section starts expanded, can collapse, and collapses by itself. */
export type ExtensionSessionSummaryDisclosure = {
    readonly defaultExpanded?: boolean;
    readonly collapsible?: boolean;
    readonly autoCollapseAfterMs?: number;
};
/** The status a Session Summary section shows. */
export type ExtensionSessionSummaryState = {
    readonly status: 'failure';
    readonly message: string;
} | {
    readonly status: 'live' | 'loading';
    readonly message?: string;
} | {
    readonly status: 'ready';
};
/** A declarative Session Summary section. */
export type ExtensionSessionSummaryContribution = {
    readonly id: string;
    readonly title: string;
    readonly placement?: 'context' | 'coordination' | 'details';
    readonly target?: ExtensionContributionTargetView;
    readonly disclosure?: ExtensionSessionSummaryDisclosure;
    readonly state?: ExtensionSessionSummaryState;
    readonly rows: readonly ExtensionSessionSummaryRow[];
};
/** Every contribution a manifest declares, by family. */
export type ExtensionContributions = {
    readonly commands?: readonly ExtensionCommandContribution[];
    readonly slashCommands?: readonly ExtensionCommandContribution[];
    readonly routes?: readonly ExtensionSurfaceContribution[];
    readonly settingsSections?: readonly ExtensionSurfaceContribution[];
    readonly sidePanels?: readonly ExtensionSidePanelContribution[];
    readonly dialogs?: readonly ExtensionSurfaceContribution[];
    readonly transcriptRenderers?: readonly ExtensionSurfaceContribution[];
    readonly toolRenderers?: readonly ExtensionSurfaceContribution[];
    readonly customMessageRenderers?: readonly ExtensionSurfaceContribution[];
    readonly interactionRenderers?: readonly ExtensionSurfaceContribution[];
    readonly statusWidgets?: readonly ExtensionSurfaceContribution[];
    readonly sessionSummarySections?: readonly ExtensionSessionSummaryContribution[];
};
/** A contribution registered at runtime, with its family. */
export type ExtensionContributionRegistration = {
    readonly family: 'commands' | 'slashCommands';
    readonly contribution: ExtensionCommandContribution;
} | {
    readonly family: 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'settingsSections' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
    readonly contribution: ExtensionSurfaceContribution;
} | {
    readonly family: 'routes';
    readonly contribution: ExtensionSurfaceContribution;
} | {
    readonly family: 'sessionSummarySections';
    readonly contribution: ExtensionSessionSummaryContribution;
} | {
    readonly family: 'sidePanels';
    readonly contribution: ExtensionSidePanelContribution;
};
/** A runtime contribution to remove, by family and id. */
export type ExtensionContributionUnregistration = {
    readonly family: ExtensionContributionFamily;
    readonly contributionId: string;
};
/** A binary or package command the extension needs before it runs. */
export type ExtensionRuntimeRequirementDeclaration = {
    readonly id: string;
    readonly label: string;
    readonly kind?: 'binary' | 'command';
    readonly command?: string;
    readonly binary?: string;
};
/** A documentation topic the extension ships. */
export type ExtensionDocsTopicDeclaration = {
    readonly id: string;
    readonly title: string;
    readonly path: string;
    readonly description?: string;
    readonly aliases?: readonly string[];
    readonly keywords?: readonly string[];
};
/** An `openwaggle.extension.json` manifest. */
export type OpenWaggleExtensionManifest = {
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
        readonly topics?: readonly ExtensionDocsTopicDeclaration[];
    };
    readonly network?: {
        readonly origins: readonly string[];
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
};
```

### Declarations from `dist/core-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { ExtensionCapabilityAuditEntry, ExtensionInvokeFailure } from './generated/broker.js';
export type { ExtensionCapabilityAuditEntry, ExtensionHostContextResult, ExtensionInvokeError, ExtensionInvokeFailure, ExtensionInvokeFailureCode, ExtensionInvokeInput, ExtensionInvokeOutcome, ExtensionInvokeScope, } from './generated/broker.js';
export type { ExtensionInvokeSuccessValue } from './generated/broker-result.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionBrokerCapability = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY>;
export type ExtensionBrokerMethod = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.METHOD>;
export type ExtensionStateSelector = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR>;
export type ExtensionSettingsKey = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY>;
/**
 * A broker success whose value one operation's decoder has narrowed. The default is a value not
 * decoded yet.
 */
export interface ExtensionInvokeSuccess<TValue = unknown> {
    readonly ok: true;
    readonly value: TValue;
    readonly audit: ExtensionCapabilityAuditEntry;
}
export type ExtensionInvokeResult<TValue = unknown> = ExtensionInvokeSuccess<TValue> | ExtensionInvokeFailure;
```

### Declarations from `dist/generated/broker.d.ts`

```ts
/** Why a broker call failed. */
export type ExtensionInvokeFailureCode = 'disabled-extension' | 'invalid-input' | 'invalid-payload' | 'out-of-scope' | 'transport-failed' | 'undeclared-capability' | 'undeclared-method' | 'undeclared-scope' | 'unknown-contribution' | 'unknown-extension' | 'unsupported-capability' | 'unsupported-method';
/** Whether the broker ran a call or refused it. */
export type ExtensionInvokeOutcome = 'rejected' | 'succeeded';
/** Where a broker call applies: the app, a project, a session or a branch. */
export type ExtensionInvokeScope = {
    readonly kind: 'app';
} | {
    readonly kind: 'branch';
    readonly projectPath: string;
    readonly sessionId: string;
    readonly branchId: string;
} | {
    readonly kind: 'project';
    readonly projectPath: string;
} | {
    readonly kind: 'session';
    readonly projectPath: string;
    readonly sessionId: string;
};
/** One broker call as the host receives it. */
export type ExtensionInvokeInput = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly payload?: unknown;
};
/** Why the broker refused or failed a call. */
export type ExtensionInvokeError = {
    readonly code: ExtensionInvokeFailureCode;
    readonly message: string;
    readonly issues?: readonly string[];
};
/** The audit record the broker keeps for every call. */
export type ExtensionCapabilityAuditEntry = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly outcome: ExtensionInvokeOutcome;
    readonly timestamp: number;
    readonly failureCode?: ExtensionInvokeFailureCode;
};
/** A broker call that failed. */
export type ExtensionInvokeFailure = {
    readonly ok: false;
    readonly error: ExtensionInvokeError;
    readonly audit?: ExtensionCapabilityAuditEntry;
};
/** The result of `hostContext.getScope`: the scope the host resolved for the contribution. */
export type ExtensionHostContextResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.host.context';
    readonly method: 'get-scope';
    readonly scope: ExtensionInvokeScope;
    readonly declaredScopes: readonly ('app' | 'branch' | 'project' | 'session')[];
};
```

### Declarations from `dist/generated/broker-result.d.ts`

```ts
import type { ExtensionHostContextResult } from './broker.js';
import type { ExtensionDocsDiscoverResult, ExtensionDocsResolveTopicResult } from './docs.js';
import type { ExtensionActionSelectProjectResult, ExtensionSessionResourcePublishResult, ExtensionSessionResourcesListResult, ExtensionSettingsGetResult, ExtensionSettingsGetSettingResult, ExtensionSettingsUpdateResult, ExtensionSettingsUpdateSettingResult, ExtensionStateCurrentBranchReadResult, ExtensionStateCurrentProjectReadResult, ExtensionStateCurrentSessionReadResult, ExtensionStateModelPreferencesReadResult, ExtensionStateReadResult, ExtensionStateRecentProjectsReadResult } from './openwaggle.js';
import type { ExtensionRuntimeRegisterContributionResult, ExtensionRuntimeUnregisterContributionResult, ExtensionStorageDeleteResult, ExtensionStorageGetResult, ExtensionStorageListResult, ExtensionStorageSetResult } from './storage.js';
/** Every result value the broker returns, one per capability method. */
export type ExtensionInvokeSuccessValue = ExtensionActionSelectProjectResult | ExtensionDocsDiscoverResult | ExtensionDocsResolveTopicResult | ExtensionHostContextResult | ExtensionRuntimeRegisterContributionResult | ExtensionRuntimeUnregisterContributionResult | ExtensionSessionResourcePublishResult | ExtensionSessionResourcesListResult | ExtensionSettingsGetResult | ExtensionSettingsGetSettingResult | ExtensionSettingsUpdateResult | ExtensionSettingsUpdateSettingResult | ExtensionStateCurrentBranchReadResult | ExtensionStateCurrentProjectReadResult | ExtensionStateCurrentSessionReadResult | ExtensionStateModelPreferencesReadResult | ExtensionStateReadResult | ExtensionStateRecentProjectsReadResult | ExtensionStorageDeleteResult | ExtensionStorageGetResult | ExtensionStorageListResult | ExtensionStorageSetResult;
```

### Declarations from `dist/generated/docs.d.ts`

```ts
export type ExtensionDocsDiscoverPayload = {
    readonly projectPaths?: readonly string[];
    readonly includeExtensions?: boolean;
};
export type ExtensionDocsResolveTopicPayload = {
    readonly topic: string;
};
export type ExtensionDocsDiscoverResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.docs';
    readonly method: 'discover-docs';
    readonly docs: ExtensionDocsDiscoveryView;
};
export type ExtensionDocsResolveTopicResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.docs';
    readonly method: 'resolve-docs-topic';
    readonly resolvedTopic: FirstPartyDocsTopicSummary | null;
};
export type ExtensionDocsDiscoveryView = {
    readonly generatedAt: string;
    readonly bundlePath: string;
    readonly firstPartyTopics: readonly FirstPartyDocsTopicSummary[];
    readonly extensionTopics: readonly {
        readonly topic: string;
        readonly localTopic: string;
        readonly title: string;
        readonly description?: string;
        readonly path: string;
        readonly aliases: readonly string[];
        readonly keywords: readonly string[];
        readonly contentHash: string | null;
        readonly provenance: {
            readonly extensionId: string;
            readonly extensionName: string | null;
            readonly extensionVersion: string | null;
            readonly scope: {
                readonly kind: 'global' | 'project';
                readonly label: string;
                readonly projectPath?: string;
            };
            readonly packagePath: string;
            readonly manifestPath: string;
            readonly path: string;
            readonly packageContentHash: string | null;
            readonly trust: 'trusted' | 'unknown' | 'untrusted';
            readonly lifecycle: 'disabled' | 'enabled' | 'unavailable';
        };
        readonly diagnostics: readonly {
            readonly severity: 'error' | 'warning';
            readonly code: string;
            readonly message: string;
            readonly path?: string;
        }[];
    }[];
    readonly diagnostics: readonly {
        readonly severity: 'error' | 'warning';
        readonly code: string;
        readonly message: string;
        readonly path?: string;
    }[];
};
export type FirstPartyDocsTopicSummary = {
    readonly topic: string;
    readonly source: 'openwaggle' | 'pi';
    readonly group: string;
    readonly title: string;
    readonly description?: string;
    readonly section?: string;
    readonly order: number;
    readonly path: string;
    readonly bundlePath: string;
    readonly sourcePath: string;
    readonly aliases: readonly string[];
    readonly keywords: readonly string[];
    readonly contentHash: string;
};
```

### Declarations from `dist/generated/openwaggle.d.ts`

```ts
import type { ExtensionInvokeScope } from './broker.js';
export type ExtensionModelPrefs = {
    readonly selectedModel: string;
    readonly favoriteModels: readonly string[];
    readonly enabledModels: readonly string[];
    readonly thinkingLevel: string;
};
export type ExtensionProjectView = {
    readonly projectPath: string;
    readonly displayName: string | null;
    readonly active: boolean;
};
export type ExtensionSessionView = {
    readonly sessionId: string;
    readonly title: string;
    readonly projectPath: string | null;
};
export type ExtensionBranchView = {
    readonly branchId: string;
    readonly sessionId: string;
    readonly name: string;
    readonly main: boolean;
    readonly archived: boolean;
};
export type ExtensionStateReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'get-state';
    readonly scope: ExtensionInvokeScope;
    readonly activeProjectPath: string | null;
    readonly currentProject: ExtensionProjectView | null;
    readonly currentSession: ExtensionSessionView | null;
    readonly currentBranch: ExtensionBranchView | null;
    readonly recentProjects: readonly string[];
    readonly modelPreferences: ExtensionModelPrefs;
};
export type ExtensionStateCurrentProjectReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'read-state';
    readonly scope: ExtensionInvokeScope;
    readonly selector: 'current-branch' | 'current-project' | 'current-session' | 'model-preferences' | 'recent-projects';
    readonly value: {
        readonly active: boolean;
        readonly displayName: string | null;
        readonly projectPath: string;
    } | null;
};
export type ExtensionStateCurrentSessionReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'read-state';
    readonly scope: ExtensionInvokeScope;
    readonly selector: 'current-branch' | 'current-project' | 'current-session' | 'model-preferences' | 'recent-projects';
    readonly value: {
        readonly projectPath: string | null;
        readonly sessionId: string;
        readonly title: string;
    } | null;
};
export type ExtensionStateCurrentBranchReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'read-state';
    readonly scope: ExtensionInvokeScope;
    readonly selector: 'current-branch' | 'current-project' | 'current-session' | 'model-preferences' | 'recent-projects';
    readonly value: {
        readonly archived: boolean;
        readonly branchId: string;
        readonly main: boolean;
        readonly name: string;
        readonly sessionId: string;
    } | null;
};
export type ExtensionStateRecentProjectsReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'read-state';
    readonly scope: ExtensionInvokeScope;
    readonly selector: 'current-branch' | 'current-project' | 'current-session' | 'model-preferences' | 'recent-projects';
    readonly value: readonly string[];
};
export type ExtensionStateModelPreferencesReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'read-state';
    readonly scope: ExtensionInvokeScope;
    readonly selector: 'current-branch' | 'current-project' | 'current-session' | 'model-preferences' | 'recent-projects';
    readonly value: {
        readonly enabledModels: readonly string[];
        readonly favoriteModels: readonly string[];
        readonly selectedModel: string;
        readonly thinkingLevel: string;
    };
};
export type ExtensionActionSelectProjectResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.actions';
    readonly method: 'select-project';
    readonly previousProjectPath: string | null;
    readonly projectPath: string;
    readonly recentProjects: readonly string[];
};
export type ExtensionSessionResourceKind = 'change-request' | 'commit' | 'file' | 'image' | 'link' | 'site' | 'tool' | 'web-search';
export type ExtensionSessionResourceRole = 'output' | 'source';
export type ExtensionSessionResourceView = {
    readonly id: string;
    readonly title: string;
    readonly kind: ExtensionSessionResourceKind;
    readonly mimeType: string | null;
    readonly available: boolean;
    readonly isSource: boolean;
    readonly isOutput: boolean;
};
export type ExtensionSessionResourcePublishPayload = {
    readonly key: string;
    readonly title: string;
    readonly kind: 'image' | 'link';
    readonly role: ExtensionSessionResourceRole;
    readonly locator: string;
};
export type ExtensionSessionResourcesListPayload = {
    readonly cursor?: string | null;
    readonly limit?: number;
};
export type ExtensionSessionResourcesListResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.resources';
    readonly sessionId: string;
    readonly method: 'list-resources';
    readonly resources: readonly ExtensionSessionResourceView[];
    readonly total: number;
    readonly nextCursor: string | null;
};
export type ExtensionSessionResourcePublishResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.resources';
    readonly sessionId: string;
    readonly method: 'publish-resource';
    readonly resource: ExtensionSessionResourceView;
};
export type ExtensionSettingsView = {
    readonly modelPreferences: ExtensionModelPrefs;
    readonly projectDisplayNames: Readonly<Record<string, string>>;
};
export type ExtensionModelPreferencesSettingsPatch = {
    readonly selectedModel?: string;
    readonly favoriteModels?: readonly string[];
    readonly enabledModels?: readonly string[];
    /** Accepted for SDK compatibility and ignored: extensions cannot change the thinking level. */
    readonly thinkingLevel?: string;
};
export type ExtensionSettingsUpdatePayload = {
    readonly selectedModel?: string;
    readonly favoriteModels?: readonly string[];
    readonly enabledModels?: readonly string[];
    /** Accepted for SDK compatibility and ignored: extensions cannot change the thinking level. */
    readonly thinkingLevel?: string;
    readonly projectDisplayNames?: Readonly<Record<string, string>>;
};
export type ExtensionSettingsGetResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.settings';
    readonly method: 'get-settings';
    readonly settings: ExtensionSettingsView;
};
export type ExtensionSettingsUpdateResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.settings';
    readonly method: 'update-settings';
    readonly settings: ExtensionSettingsView;
};
export type ExtensionSettingsSelectedValue = {
    readonly key: 'model-preferences';
    readonly value: ExtensionModelPrefs;
} | {
    readonly key: 'project-display-name';
    readonly projectPath: string;
    readonly value: string | null;
};
export type ExtensionSettingsGetSettingResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.settings';
    readonly method: 'get-setting';
    readonly setting: ExtensionSettingsSelectedValue;
};
export type ExtensionSettingsUpdateSettingResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.settings';
    readonly method: 'update-setting';
    readonly setting: ExtensionSettingsSelectedValue;
};
```

### Declarations from `dist/generated/storage.d.ts`

```ts
import type { JsonValue } from '../json.js';
/** Which package store a call uses: package state or package configuration. */
export type ExtensionStorageKind = 'config' | 'state';
/** Which storage scope a call reads or writes. */
export type ExtensionStorageScopeSelector = 'global' | 'project';
/** The storage scope a result belongs to. */
export type ExtensionStorageScope = {
    readonly kind: 'global';
} | {
    readonly kind: 'project';
    readonly projectPath: string;
};
export type ExtensionStorageGetResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.storage';
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
    readonly method: 'get';
    readonly key: string;
    readonly value: JsonValue;
};
export type ExtensionStorageSetResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.storage';
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
    readonly method: 'set';
    readonly key: string;
    readonly value: JsonValue;
    readonly createdAt: number;
    readonly updatedAt: number;
};
export type ExtensionStorageDeleteResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.storage';
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
    readonly method: 'delete';
    readonly key: string;
    readonly deleted: true;
};
export type ExtensionStorageListResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.storage';
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
    readonly method: 'list';
    readonly keys: readonly string[];
};
export type ExtensionRuntimeRegisterContributionResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.runtime';
    readonly family: 'commands' | 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'routes' | 'sessionSummarySections' | 'settingsSections' | 'sidePanels' | 'slashCommands' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
    readonly method: 'register-contribution';
    readonly registeredContributionId: string;
};
export type ExtensionRuntimeUnregisterContributionResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.runtime';
    readonly family: 'commands' | 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'routes' | 'sessionSummarySections' | 'settingsSections' | 'sidePanels' | 'slashCommands' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
    readonly method: 'unregister-contribution';
    readonly unregisteredContributionId: string;
    readonly unregistered: boolean;
};
```

### Declarations from `dist/openwaggle-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { ExtensionInvokeScope, ExtensionStateSelector } from './core-types.js';
export type { ExtensionDocsDiscoverPayload, ExtensionDocsDiscoverResult, ExtensionDocsResolveTopicPayload, ExtensionDocsResolveTopicResult, } from './generated/docs.js';
export type * from './generated/openwaggle.js';
/** The result of reading one state selector; each `ExtensionState*ReadResult` narrows it. */
export interface ExtensionSelectedStateReadResult<TValue> {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE;
    readonly scope: ExtensionInvokeScope;
    readonly selector: ExtensionStateSelector;
    readonly value: TValue;
}
```

### Declarations from `dist/registry-types.d.ts`

```ts
import type { ExtensionCapabilityScope, ExtensionContributionFamily, ExtensionContributionMatchView, ExtensionContributionRuntime, ExtensionContributionTargetView, ExtensionExecutionPlacement } from './contribution-types.js';
import type { ExtensionSessionSummaryDisclosure, ExtensionSessionSummaryRow, ExtensionSessionSummaryState } from './generated/manifest.js';
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
    readonly sessionSummary?: {
        readonly placement: 'context' | 'coordination' | 'details';
        readonly disclosure?: ExtensionSessionSummaryDisclosure;
        readonly state?: ExtensionSessionSummaryState;
        readonly rows: readonly ExtensionSessionSummaryRow[];
    };
}
```

### Declarations from `dist/runtime-types.d.ts`

```ts
export type { ExtensionRuntimeRegisterContributionResult, ExtensionRuntimeUnregisterContributionResult, } from './generated/storage.js';
```

### Declarations from `dist/storage-types.d.ts`

```ts
import type { ExtensionStorageGetResult } from './generated/storage.js';
export type { ExtensionStorageDeleteResult, ExtensionStorageGetResult, ExtensionStorageKind, ExtensionStorageListResult, ExtensionStorageScope, ExtensionStorageScopeSelector, ExtensionStorageSetResult, } from './generated/storage.js';
/** The fields every storage result carries. */
export type ExtensionStorageResultBase = Pick<ExtensionStorageGetResult, 'extensionId' | 'contributionId' | 'capability' | 'storageKind' | 'storageScope'>;
```

### Declarations from `dist/validation-types.d.ts`

```ts
/**
 * One reason a value failed validation. `path` is the dotted field path the host reports in its
 * diagnostics, such as `contributions.sidePanels.0.icon`, with array items by index, and
 * `(root)` for the value itself.
 */
export interface ExtensionValidationIssue {
    readonly path: string;
    readonly message: string;
}
/** What a `validate*` helper returns: the valid value, or every issue it found. */
export type ExtensionValidationResult<TValue> = {
    readonly success: true;
    readonly value: TValue;
} | {
    readonly success: false;
    readonly issues: readonly ExtensionValidationIssue[];
};
```

### Declarations from `dist/internal/runtime-sdk.d.ts`

```ts
import type { ExtensionRuntimeContributionSdk, ExtensionSdkInvoke } from '../sdk-types.js';
export declare function createRuntimeContributionSdk(invoke: ExtensionSdkInvoke): ExtensionRuntimeContributionSdk;
```

## Export `./theme`

Types: `dist/theme.d.ts`

### Declarations from `dist/theme.d.ts`

```ts
import type { CreateOpenWaggleExtensionThemeOptions, OpenWaggleExtensionTheme, OpenWaggleExtensionThemeCssVariableEntry } from './theme-types.js';
export { OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES } from './theme-data.js';
export type { CreateOpenWaggleExtensionThemeOptions, ExtensionThemeCssVariableResolver, OpenWaggleExtensionColorScheme, OpenWaggleExtensionTheme, OpenWaggleExtensionThemeCssVariableEntry, OpenWaggleExtensionThemeCssVariables, OpenWaggleExtensionThemeTokens, OpenWaggleExtensionTypeScaleEntry, } from './theme-types.js';
export declare function createOpenWaggleExtensionTheme(options?: CreateOpenWaggleExtensionThemeOptions): OpenWaggleExtensionTheme;
export declare function extensionThemeCssVariableEntries(theme: OpenWaggleExtensionTheme): readonly OpenWaggleExtensionThemeCssVariableEntry[];
```

### Declarations from `dist/theme-types.d.ts`

```ts
export type OpenWaggleExtensionColorScheme = 'dark' | 'light' | 'high-contrast-dark' | 'high-contrast-light';
export interface OpenWaggleExtensionTypeScaleEntry {
    readonly fontSize: string;
    readonly lineHeight: string;
}
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
        readonly dangerText: string;
        readonly warning: string;
        readonly info: string;
        readonly infoText: string;
        readonly review: string;
        readonly plan: string;
        readonly progress: string;
        readonly neutral: string;
    };
    readonly typography: {
        readonly sansFamily: string;
        readonly monoFamily: string;
        readonly typeScale: {
            readonly xs: OpenWaggleExtensionTypeScaleEntry;
            readonly sm: OpenWaggleExtensionTypeScaleEntry;
            readonly base: OpenWaggleExtensionTypeScaleEntry;
            readonly lg: OpenWaggleExtensionTypeScaleEntry;
            readonly xl: OpenWaggleExtensionTypeScaleEntry;
            readonly twoXl: OpenWaggleExtensionTypeScaleEntry;
        };
    };
    readonly spacing: {
        readonly unit: string;
    };
    readonly radius: {
        readonly xs: string;
        readonly sm: string;
        readonly md: string;
        readonly lg: string;
        readonly xl: string;
        readonly twoXl: string;
        readonly threeXl: string;
        readonly fourXl: string;
    };
    readonly shadow: {
        readonly twoXs: string;
        readonly xs: string;
        readonly sm: string;
        readonly md: string;
        readonly lg: string;
        readonly xl: string;
        readonly twoXl: string;
    };
    readonly focus: {
        readonly ring: string;
        readonly shadow: string;
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
    readonly colorScheme?: OpenWaggleExtensionColorScheme;
    readonly resolveCssVariable?: ExtensionThemeCssVariableResolver;
}
```

### Declarations from `dist/theme-data.d.ts`

```ts
export declare const OPENWAGGLE_EXTENSION_THEME_CSS_VARIABLES: {
    readonly color: {
        readonly background: '--ow-color-background';
        readonly surface: '--ow-color-surface';
        readonly surfaceRaised: '--ow-color-surface-raised';
        readonly surfaceHover: '--ow-color-surface-hover';
        readonly surfaceActive: '--ow-color-surface-active';
        readonly border: '--ow-color-border';
        readonly borderStrong: '--ow-color-border-strong';
        readonly text: '--ow-color-text';
        readonly textSubtle: '--ow-color-text-subtle';
        readonly textMuted: '--ow-color-text-muted';
        readonly textDim: '--ow-color-text-dim';
        readonly accent: '--ow-color-accent';
        readonly accentDim: '--ow-color-accent-dim';
        readonly success: '--ow-color-success';
        readonly danger: '--ow-color-danger';
        readonly dangerText: '--ow-color-danger-text';
        readonly warning: '--ow-color-warning';
        readonly info: '--ow-color-info';
        readonly infoText: '--ow-color-info-text';
        readonly review: '--ow-color-review';
        readonly plan: '--ow-color-plan';
        readonly progress: '--ow-color-progress';
        readonly neutral: '--ow-color-neutral';
    };
    readonly typography: {
        readonly sansFamily: '--ow-font-family-sans';
        readonly monoFamily: '--ow-font-family-mono';
        readonly typeScale: {
            readonly xs: {
                readonly fontSize: '--ow-text-xs';
                readonly lineHeight: '--ow-text-xs--line-height';
            };
            readonly sm: {
                readonly fontSize: '--ow-text-sm';
                readonly lineHeight: '--ow-text-sm--line-height';
            };
            readonly base: {
                readonly fontSize: '--ow-text-base';
                readonly lineHeight: '--ow-text-base--line-height';
            };
            readonly lg: {
                readonly fontSize: '--ow-text-lg';
                readonly lineHeight: '--ow-text-lg--line-height';
            };
            readonly xl: {
                readonly fontSize: '--ow-text-xl';
                readonly lineHeight: '--ow-text-xl--line-height';
            };
            readonly twoXl: {
                readonly fontSize: '--ow-text-2xl';
                readonly lineHeight: '--ow-text-2xl--line-height';
            };
        };
    };
    readonly spacing: {
        readonly unit: '--ow-spacing';
    };
    readonly radius: {
        readonly xs: '--ow-radius-xs';
        readonly sm: '--ow-radius-sm';
        readonly md: '--ow-radius-md';
        readonly lg: '--ow-radius-lg';
        readonly xl: '--ow-radius-xl';
        readonly twoXl: '--ow-radius-2xl';
        readonly threeXl: '--ow-radius-3xl';
        readonly fourXl: '--ow-radius-4xl';
    };
    readonly shadow: {
        readonly twoXs: '--ow-shadow-2xs';
        readonly xs: '--ow-shadow-xs';
        readonly sm: '--ow-shadow-sm';
        readonly md: '--ow-shadow-md';
        readonly lg: '--ow-shadow-lg';
        readonly xl: '--ow-shadow-xl';
        readonly twoXl: '--ow-shadow-2xl';
    };
    readonly focus: {
        readonly ring: '--ow-focus-ring';
        readonly shadow: '--ow-focus-shadow';
    };
};
export declare const DEFAULT_EXTENSION_THEME_TOKENS: {
    readonly color: {
        readonly background: '#141719';
        readonly surface: '#1a1d22';
        readonly surfaceRaised: '#20242b';
        readonly surfaceHover: '#262b33';
        readonly surfaceActive: '#2b313a';
        readonly border: '#1e2229';
        readonly borderStrong: '#2a3240';
        readonly text: '#e7e9ee';
        readonly textSubtle: '#c9cdd6';
        readonly textMuted: '#9098a8';
        readonly textDim: '#8f98a8';
        readonly accent: '#f5a623';
        readonly accentDim: '#d18a2c';
        readonly success: '#4caf72';
        readonly danger: '#ef4444';
        readonly dangerText: '#f87171';
        readonly warning: '#f97316';
        readonly info: '#3b82f6';
        readonly infoText: '#60a5fa';
        readonly review: '#a78bfa';
        readonly plan: '#e879f9';
        readonly progress: '#7dd3fc';
        readonly neutral: '#9098a8';
    };
    readonly typography: {
        readonly sansFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';
        readonly monoFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
        readonly typeScale: {
            readonly xs: {
                readonly fontSize: '0.75rem';
                readonly lineHeight: 'calc(1 / 0.75)';
            };
            readonly sm: {
                readonly fontSize: '0.875rem';
                readonly lineHeight: 'calc(1.25 / 0.875)';
            };
            readonly base: {
                readonly fontSize: '1rem';
                readonly lineHeight: 'calc(1.5 / 1)';
            };
            readonly lg: {
                readonly fontSize: '1.125rem';
                readonly lineHeight: 'calc(1.75 / 1.125)';
            };
            readonly xl: {
                readonly fontSize: '1.25rem';
                readonly lineHeight: 'calc(1.75 / 1.25)';
            };
            readonly twoXl: {
                readonly fontSize: '1.5rem';
                readonly lineHeight: 'calc(2 / 1.5)';
            };
        };
    };
    readonly spacing: {
        readonly unit: '0.25rem';
    };
    readonly radius: {
        readonly xs: '0.125rem';
        readonly sm: '0.25rem';
        readonly md: '0.375rem';
        readonly lg: '0.5rem';
        readonly xl: '0.75rem';
        readonly twoXl: '1rem';
        readonly threeXl: '1.5rem';
        readonly fourXl: '2rem';
    };
    readonly shadow: {
        readonly twoXs: '0 1px rgb(0 0 0 / 0.05)';
        readonly xs: '0 1px 2px 0 rgb(0 0 0 / 0.05)';
        readonly sm: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)';
        readonly md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)';
        readonly lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)';
        readonly xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)';
        readonly twoXl: '0 25px 50px -12px rgb(0 0 0 / 0.25)';
    };
    readonly focus: {
        readonly ring: 'transparent';
        readonly shadow: 'none';
    };
};
export declare const SOURCE_EXTENSION_THEME_CSS_VARIABLES: {
    readonly color: {
        readonly background: '--color-bg';
        readonly surface: '--color-bg-secondary';
        readonly surfaceRaised: '--color-bg-tertiary';
        readonly surfaceHover: '--color-bg-hover';
        readonly surfaceActive: '--color-bg-active';
        readonly border: '--color-border';
        readonly borderStrong: '--color-border-light';
        readonly text: '--color-text-primary';
        readonly textSubtle: '--color-text-secondary';
        readonly textMuted: '--color-text-tertiary';
        readonly textDim: '--color-text-muted';
        readonly accent: '--color-accent';
        readonly accentDim: '--color-accent-dim';
        readonly success: '--color-success';
        readonly danger: '--color-error';
        readonly dangerText: '--color-error-text';
        readonly warning: '--color-warning';
        readonly info: '--color-info';
        readonly infoText: '--color-info-text';
        readonly review: '--color-review';
        readonly plan: '--color-plan';
        readonly progress: '--color-progress';
        readonly neutral: '--color-neutral';
    };
    readonly typography: {
        readonly sansFamily: '--font-sans';
        readonly monoFamily: '--font-mono';
        readonly typeScale: {
            readonly xs: {
                readonly fontSize: '--text-xs';
                readonly lineHeight: '--text-xs--line-height';
            };
            readonly sm: {
                readonly fontSize: '--text-sm';
                readonly lineHeight: '--text-sm--line-height';
            };
            readonly base: {
                readonly fontSize: '--text-base';
                readonly lineHeight: '--text-base--line-height';
            };
            readonly lg: {
                readonly fontSize: '--text-lg';
                readonly lineHeight: '--text-lg--line-height';
            };
            readonly xl: {
                readonly fontSize: '--text-xl';
                readonly lineHeight: '--text-xl--line-height';
            };
            readonly twoXl: {
                readonly fontSize: '--text-2xl';
                readonly lineHeight: '--text-2xl--line-height';
            };
        };
    };
    readonly spacing: {
        readonly unit: '--spacing';
    };
    readonly radius: {
        readonly xs: '--radius-xs';
        readonly sm: '--radius-sm';
        readonly md: '--radius-md';
        readonly lg: '--radius-lg';
        readonly xl: '--radius-xl';
        readonly twoXl: '--radius-2xl';
        readonly threeXl: '--radius-3xl';
        readonly fourXl: '--radius-4xl';
    };
    readonly shadow: {
        readonly twoXs: '--shadow-2xs';
        readonly xs: '--shadow-xs';
        readonly sm: '--shadow-sm';
        readonly md: '--shadow-md';
        readonly lg: '--shadow-lg';
        readonly xl: '--shadow-xl';
        readonly twoXl: '--shadow-2xl';
    };
    readonly focus: {
        readonly ring: '--focus-ring';
        readonly shadow: '--focus-shadow';
    };
};
export declare const EXTENSION_THEME_COLOR_KEYS: readonly ['background', 'surface', 'surfaceRaised', 'surfaceHover', 'surfaceActive', 'border', 'borderStrong', 'text', 'textSubtle', 'textMuted', 'textDim', 'accent', 'accentDim', 'success', 'danger', 'dangerText', 'warning', 'info', 'infoText', 'review', 'plan', 'progress', 'neutral'];
export declare const EXTENSION_THEME_TYPE_SCALE_KEYS: readonly ['xs', 'sm', 'base', 'lg', 'xl', 'twoXl'];
export declare const EXTENSION_THEME_TYPE_SCALE_ENTRY_KEYS: readonly ['fontSize', 'lineHeight'];
export declare const EXTENSION_THEME_SPACING_KEYS: readonly ['unit'];
export declare const EXTENSION_THEME_RADIUS_KEYS: readonly ['xs', 'sm', 'md', 'lg', 'xl', 'twoXl', 'threeXl', 'fourXl'];
export declare const EXTENSION_THEME_SHADOW_KEYS: readonly ['twoXs', 'xs', 'sm', 'md', 'lg', 'xl', 'twoXl'];
export declare const EXTENSION_THEME_FOCUS_KEYS: readonly ['ring', 'shadow'];
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
export type * from './validation-types.js';
```

### Declarations from `dist/contribution-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION } from './constants.js';
import type { ExtensionContributionRegistration, ExtensionContributionUnregistration } from './generated/manifest.js';
export type { ExtensionCapabilityScope, ExtensionContributionFamily, ExtensionContributionMatchView, ExtensionContributionRuntime, ExtensionContributionTargetView, ExtensionExecutionPlacement, ExtensionInstallSource, } from './generated/manifest.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionNetworkAccessMode = ConstantValue<typeof OPENWAGGLE_EXTENSION.NETWORK_ACCESS_MODE>;
export type ExtensionRuntimeRegisterContributionPayload = ExtensionContributionRegistration;
export type ExtensionRuntimeUnregisterContributionPayload = ExtensionContributionUnregistration;
```

### Declarations from `dist/constants.d.ts`

```ts
export declare const OPENWAGGLE_EXTENSION_BROKER: {
    readonly CAPABILITY: {
        readonly HOST_CONTEXT: 'openwaggle.host.context';
        readonly STORAGE: 'openwaggle.storage';
        readonly STATE: 'openwaggle.state';
        readonly ACTIONS: 'openwaggle.actions';
        readonly SETTINGS: 'openwaggle.settings';
        readonly DOCS: 'openwaggle.docs';
        readonly RUNTIME: 'openwaggle.runtime';
        readonly RESOURCES: 'openwaggle.resources';
    };
    readonly CAPABILITIES: readonly ("openwaggle.actions" | "openwaggle.docs" | "openwaggle.host.context" | "openwaggle.resources" | "openwaggle.runtime" | "openwaggle.settings" | "openwaggle.state" | "openwaggle.storage")[];
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
    }, {
        readonly capability: "openwaggle.resources";
        readonly methods: readonly ["list-resources", "publish-resource"];
    }];
    readonly METHOD: {
        readonly GET_SCOPE: 'get-scope';
        readonly GET: 'get';
        readonly SET: 'set';
        readonly DELETE: 'delete';
        readonly LIST: 'list';
        readonly GET_STATE: 'get-state';
        readonly READ_STATE: 'read-state';
        readonly SELECT_PROJECT: 'select-project';
        readonly GET_SETTINGS: 'get-settings';
        readonly UPDATE_SETTINGS: 'update-settings';
        readonly GET_SETTING: 'get-setting';
        readonly UPDATE_SETTING: 'update-setting';
        readonly DISCOVER_DOCS: 'discover-docs';
        readonly RESOLVE_DOCS_TOPIC: 'resolve-docs-topic';
        readonly REGISTER_CONTRIBUTION: 'register-contribution';
        readonly UNREGISTER_CONTRIBUTION: 'unregister-contribution';
        readonly LIST_RESOURCES: 'list-resources';
        readonly PUBLISH_RESOURCE: 'publish-resource';
    };
    readonly METHODS: readonly ("delete" | "discover-docs" | "get" | "get-scope" | "get-setting" | "get-settings" | "get-state" | "list" | "list-resources" | "publish-resource" | "read-state" | "register-contribution" | "resolve-docs-topic" | "select-project" | "set" | "unregister-contribution" | "update-setting" | "update-settings")[];
    readonly FAILURE_CODE: {
        readonly INVALID_INPUT: 'invalid-input';
        readonly INVALID_PAYLOAD: 'invalid-payload';
        readonly UNKNOWN_EXTENSION: 'unknown-extension';
        readonly DISABLED_EXTENSION: 'disabled-extension';
        readonly UNKNOWN_CONTRIBUTION: 'unknown-contribution';
        readonly UNDECLARED_CAPABILITY: 'undeclared-capability';
        readonly UNDECLARED_METHOD: 'undeclared-method';
        readonly UNDECLARED_SCOPE: 'undeclared-scope';
        readonly OUT_OF_SCOPE: 'out-of-scope';
        readonly UNSUPPORTED_CAPABILITY: 'unsupported-capability';
        readonly UNSUPPORTED_METHOD: 'unsupported-method';
        readonly TRANSPORT_FAILED: 'transport-failed';
    };
    readonly FAILURE_CODES: readonly ("disabled-extension" | "invalid-input" | "invalid-payload" | "out-of-scope" | "transport-failed" | "undeclared-capability" | "undeclared-method" | "undeclared-scope" | "unknown-contribution" | "unknown-extension" | "unsupported-capability" | "unsupported-method")[];
    readonly OUTCOME: {
        readonly SUCCEEDED: 'succeeded';
        readonly REJECTED: 'rejected';
    };
    readonly OUTCOMES: readonly ("rejected" | "succeeded")[];
    readonly STATE_SELECTOR: {
        readonly CURRENT_PROJECT: 'current-project';
        readonly CURRENT_SESSION: 'current-session';
        readonly CURRENT_BRANCH: 'current-branch';
        readonly RECENT_PROJECTS: 'recent-projects';
        readonly MODEL_PREFERENCES: 'model-preferences';
    };
    readonly STATE_SELECTORS: readonly ("current-branch" | "current-project" | "current-session" | "model-preferences" | "recent-projects")[];
    readonly SETTING_KEY: {
        readonly MODEL_PREFERENCES: 'model-preferences';
        readonly PROJECT_DISPLAY_NAME: 'project-display-name';
    };
    readonly SETTING_KEYS: readonly ("model-preferences" | "project-display-name")[];
};
export declare const OPENWAGGLE_EXTENSION: {
    readonly MANIFEST_FILE: 'openwaggle.extension.json';
    readonly SDK_VERSION: '0.1.0';
    readonly PROJECT_ROOT_SEGMENTS: readonly ['.openwaggle', 'extensions'];
    readonly GLOBAL_EXTENSIONS_DIR: 'extensions';
    readonly SCOPE: {
        readonly GLOBAL_KIND: 'global';
        readonly PROJECT_KIND: 'project';
        readonly GLOBAL_ID: 'global';
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
    readonly PATTERNS: {
        readonly WINDOWS_ABSOLUTE_PATH: RegExp;
        readonly ID: RegExp;
        readonly CONTRIBUTION_ID: RegExp;
        readonly SEMVER_VERSION: RegExp;
    };
    readonly PATH: {
        readonly NUL_CHARACTER: '\0';
        readonly POSIX_SEPARATOR: '/';
        readonly WINDOWS_SEPARATOR: '\\';
        readonly RELATIVE_PARENT_SEGMENT: '..';
        readonly CURRENT_DIRECTORY_SEGMENT: '.';
    };
    readonly RUNTIME_MODULE_PROTOCOL: {
        readonly MODULE_CONTEXT_SEGMENT: '__context__';
    };
    readonly CAPABILITY_SCOPES: readonly ['app', 'project', 'session', 'branch'];
    readonly CONTRIBUTION_FAMILY: {
        readonly COMMANDS: 'commands';
        readonly SLASH_COMMANDS: 'slashCommands';
        readonly ROUTES: 'routes';
        readonly SETTINGS_SECTIONS: 'settingsSections';
        readonly SIDE_PANELS: 'sidePanels';
        readonly DIALOGS: 'dialogs';
        readonly TRANSCRIPT_RENDERERS: 'transcriptRenderers';
        readonly TOOL_RENDERERS: 'toolRenderers';
        readonly CUSTOM_MESSAGE_RENDERERS: 'customMessageRenderers';
        readonly INTERACTION_RENDERERS: 'interactionRenderers';
        readonly STATUS_WIDGETS: 'statusWidgets';
        readonly SESSION_SUMMARY_SECTIONS: 'sessionSummarySections';
    };
    readonly CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands", "routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets", "sessionSummarySections"];
    readonly COMMAND_CONTRIBUTION_FAMILIES: readonly ["commands", "slashCommands"];
    readonly CONTRIBUTION_RUNTIME: {
        readonly FEDERATED_MODULE: 'federated-module';
        readonly TRUSTED_RENDERER: 'trusted-renderer';
    };
    readonly CONTRIBUTION_RUNTIMES: readonly ("federated-module" | "trusted-renderer")[];
    readonly EXECUTION_PLACEMENT: {
        readonly HOST_RENDERER: 'host-renderer';
        readonly FRAME: 'frame';
    };
    readonly EXECUTION_PLACEMENTS: readonly ("frame" | "host-renderer")[];
    readonly STORAGE: {
        readonly KIND: {
            readonly STATE: 'state';
            readonly CONFIG: 'config';
        };
        readonly KINDS: readonly ("config" | "state")[];
        readonly SCOPE: {
            readonly GLOBAL_KIND: 'global';
            readonly PROJECT_KIND: 'project';
            readonly GLOBAL_ID: 'global';
        };
        readonly SCOPE_KINDS: readonly ("global" | "project")[];
        readonly KEY_MAX_LENGTH: 160;
    };
    readonly ENTRY_CONTRIBUTION_FAMILIES: readonly ["routes", "settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly SLOT_CONTRIBUTION_FAMILIES: readonly ["settingsSections", "sidePanels", "dialogs", "transcriptRenderers", "toolRenderers", "customMessageRenderers", "interactionRenderers", "statusWidgets"];
    readonly INSTALL_SOURCE: {
        readonly PREBUILT: 'prebuilt';
        readonly LOCAL_BUILD: 'local-build';
    };
    readonly INSTALL_SOURCES: readonly ("local-build" | "prebuilt")[];
    readonly RUNTIME_REQUIREMENT_TYPE: {
        readonly BINARY: 'binary';
        readonly COMMAND: 'command';
    };
    readonly RUNTIME_REQUIREMENT_TYPES: readonly ("binary" | "command")[];
    readonly NETWORK_ACCESS_MODE: {
        readonly BROKERED: 'brokered';
        readonly RESTRICTED: 'restricted';
        readonly DIRECT: 'direct';
    };
    readonly NETWORK_ACCESS_MODES: readonly ("brokered" | "direct" | "restricted")[];
};
```

### Declarations from `dist/generated/manifest.d.ts`

```ts
/** The scopes a broker capability can be called in. */
export type ExtensionCapabilityScope = 'app' | 'branch' | 'project' | 'session';
/** A contribution family: the manifest key a contribution is declared under. */
export type ExtensionContributionFamily = 'commands' | 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'routes' | 'sessionSummarySections' | 'settingsSections' | 'sidePanels' | 'slashCommands' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
/** How a contribution's entry module runs. */
export type ExtensionContributionRuntime = 'federated-module' | 'trusted-renderer';
/** Where a contribution's entry module runs. */
export type ExtensionExecutionPlacement = 'frame' | 'host-renderer';
/** Whether OpenWaggle installs the package's prebuilt artifacts or builds it locally. */
export type ExtensionInstallSource = 'local-build' | 'prebuilt';
/** The projects and sessions a contribution is limited to. */
export type ExtensionContributionTargetView = {
    readonly projectPaths?: readonly string[];
    readonly sessionIds?: readonly string[];
};
/** The tool calls, custom messages and interactions a renderer contribution handles. */
export type ExtensionContributionMatchView = {
    readonly toolNames?: readonly string[];
    readonly customMessageNames?: readonly string[];
    readonly interactionKinds?: readonly string[];
};
/** A broker capability the extension uses, with the methods and scopes it calls. */
export type ExtensionCapabilityDeclaration = {
    readonly id: string;
    readonly methods?: readonly string[];
    readonly scopes?: readonly ExtensionCapabilityScope[];
};
/** A command or slash command. */
export type ExtensionCommandContribution = {
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly id: string;
    readonly title: string;
    readonly category?: string;
    readonly target?: ExtensionContributionTargetView;
};
/**
 * A contribution that mounts an entry module: a route, or a settings section, dialog, renderer
 * or status widget.
 */
export type ExtensionSurfaceContribution = {
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly id: string;
    readonly title: string;
    readonly runtime: ExtensionContributionRuntime;
    readonly execution: ExtensionExecutionPlacement;
    readonly entry: string;
    readonly target?: ExtensionContributionTargetView;
    readonly matches?: ExtensionContributionMatchView;
};
/** A side panel's Panel rail icon: a Lucide icon name in kebab-case, or a package `.svg` file. */
export type ExtensionSidePanelIcon = string | {
    readonly svg: string;
};
/** A side panel, with its optional Panel rail icon. */
export type ExtensionSidePanelContribution = {
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly id: string;
    readonly title: string;
    readonly runtime: ExtensionContributionRuntime;
    readonly execution: ExtensionExecutionPlacement;
    readonly entry: string;
    readonly target?: ExtensionContributionTargetView;
    readonly matches?: ExtensionContributionMatchView;
    readonly icon?: ExtensionSidePanelIcon;
};
/** Any contribution that mounts an entry module. */
export type ExtensionEntryContribution = ExtensionSidePanelContribution | ExtensionSurfaceContribution;
/** A row of a Session Summary section. */
export type ExtensionSessionSummaryRow = {
    readonly id: string;
    readonly label: string;
    readonly value?: string;
    readonly badge?: string;
    readonly count?: number;
    readonly resourceId?: string;
    readonly action?: {
        readonly family: 'commands' | 'dialogs' | 'sidePanels';
        readonly contributionId: string;
    };
};
/** Whether a Session Summary section starts expanded, can collapse, and collapses by itself. */
export type ExtensionSessionSummaryDisclosure = {
    readonly defaultExpanded?: boolean;
    readonly collapsible?: boolean;
    readonly autoCollapseAfterMs?: number;
};
/** The status a Session Summary section shows. */
export type ExtensionSessionSummaryState = {
    readonly status: 'failure';
    readonly message: string;
} | {
    readonly status: 'live' | 'loading';
    readonly message?: string;
} | {
    readonly status: 'ready';
};
/** A declarative Session Summary section. */
export type ExtensionSessionSummaryContribution = {
    readonly id: string;
    readonly title: string;
    readonly placement?: 'context' | 'coordination' | 'details';
    readonly target?: ExtensionContributionTargetView;
    readonly disclosure?: ExtensionSessionSummaryDisclosure;
    readonly state?: ExtensionSessionSummaryState;
    readonly rows: readonly ExtensionSessionSummaryRow[];
};
/** Every contribution a manifest declares, by family. */
export type ExtensionContributions = {
    readonly commands?: readonly ExtensionCommandContribution[];
    readonly slashCommands?: readonly ExtensionCommandContribution[];
    readonly routes?: readonly ExtensionSurfaceContribution[];
    readonly settingsSections?: readonly ExtensionSurfaceContribution[];
    readonly sidePanels?: readonly ExtensionSidePanelContribution[];
    readonly dialogs?: readonly ExtensionSurfaceContribution[];
    readonly transcriptRenderers?: readonly ExtensionSurfaceContribution[];
    readonly toolRenderers?: readonly ExtensionSurfaceContribution[];
    readonly customMessageRenderers?: readonly ExtensionSurfaceContribution[];
    readonly interactionRenderers?: readonly ExtensionSurfaceContribution[];
    readonly statusWidgets?: readonly ExtensionSurfaceContribution[];
    readonly sessionSummarySections?: readonly ExtensionSessionSummaryContribution[];
};
/** A contribution registered at runtime, with its family. */
export type ExtensionContributionRegistration = {
    readonly family: 'commands' | 'slashCommands';
    readonly contribution: ExtensionCommandContribution;
} | {
    readonly family: 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'settingsSections' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
    readonly contribution: ExtensionSurfaceContribution;
} | {
    readonly family: 'routes';
    readonly contribution: ExtensionSurfaceContribution;
} | {
    readonly family: 'sessionSummarySections';
    readonly contribution: ExtensionSessionSummaryContribution;
} | {
    readonly family: 'sidePanels';
    readonly contribution: ExtensionSidePanelContribution;
};
/** A runtime contribution to remove, by family and id. */
export type ExtensionContributionUnregistration = {
    readonly family: ExtensionContributionFamily;
    readonly contributionId: string;
};
/** A binary or package command the extension needs before it runs. */
export type ExtensionRuntimeRequirementDeclaration = {
    readonly id: string;
    readonly label: string;
    readonly kind?: 'binary' | 'command';
    readonly command?: string;
    readonly binary?: string;
};
/** A documentation topic the extension ships. */
export type ExtensionDocsTopicDeclaration = {
    readonly id: string;
    readonly title: string;
    readonly path: string;
    readonly description?: string;
    readonly aliases?: readonly string[];
    readonly keywords?: readonly string[];
};
/** An `openwaggle.extension.json` manifest. */
export type OpenWaggleExtensionManifest = {
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
        readonly topics?: readonly ExtensionDocsTopicDeclaration[];
    };
    readonly network?: {
        readonly origins: readonly string[];
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
};
```

### Declarations from `dist/core-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { ExtensionCapabilityAuditEntry, ExtensionInvokeFailure } from './generated/broker.js';
export type { ExtensionCapabilityAuditEntry, ExtensionHostContextResult, ExtensionInvokeError, ExtensionInvokeFailure, ExtensionInvokeFailureCode, ExtensionInvokeInput, ExtensionInvokeOutcome, ExtensionInvokeScope, } from './generated/broker.js';
export type { ExtensionInvokeSuccessValue } from './generated/broker-result.js';
type ConstantValue<TObject> = TObject[keyof TObject];
export type ExtensionBrokerCapability = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY>;
export type ExtensionBrokerMethod = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.METHOD>;
export type ExtensionStateSelector = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR>;
export type ExtensionSettingsKey = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY>;
/**
 * A broker success whose value one operation's decoder has narrowed. The default is a value not
 * decoded yet.
 */
export interface ExtensionInvokeSuccess<TValue = unknown> {
    readonly ok: true;
    readonly value: TValue;
    readonly audit: ExtensionCapabilityAuditEntry;
}
export type ExtensionInvokeResult<TValue = unknown> = ExtensionInvokeSuccess<TValue> | ExtensionInvokeFailure;
```

### Declarations from `dist/generated/broker.d.ts`

```ts
/** Why a broker call failed. */
export type ExtensionInvokeFailureCode = 'disabled-extension' | 'invalid-input' | 'invalid-payload' | 'out-of-scope' | 'transport-failed' | 'undeclared-capability' | 'undeclared-method' | 'undeclared-scope' | 'unknown-contribution' | 'unknown-extension' | 'unsupported-capability' | 'unsupported-method';
/** Whether the broker ran a call or refused it. */
export type ExtensionInvokeOutcome = 'rejected' | 'succeeded';
/** Where a broker call applies: the app, a project, a session or a branch. */
export type ExtensionInvokeScope = {
    readonly kind: 'app';
} | {
    readonly kind: 'branch';
    readonly projectPath: string;
    readonly sessionId: string;
    readonly branchId: string;
} | {
    readonly kind: 'project';
    readonly projectPath: string;
} | {
    readonly kind: 'session';
    readonly projectPath: string;
    readonly sessionId: string;
};
/** One broker call as the host receives it. */
export type ExtensionInvokeInput = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly payload?: unknown;
};
/** Why the broker refused or failed a call. */
export type ExtensionInvokeError = {
    readonly code: ExtensionInvokeFailureCode;
    readonly message: string;
    readonly issues?: readonly string[];
};
/** The audit record the broker keeps for every call. */
export type ExtensionCapabilityAuditEntry = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: string;
    readonly method: string;
    readonly scope: ExtensionInvokeScope;
    readonly outcome: ExtensionInvokeOutcome;
    readonly timestamp: number;
    readonly failureCode?: ExtensionInvokeFailureCode;
};
/** A broker call that failed. */
export type ExtensionInvokeFailure = {
    readonly ok: false;
    readonly error: ExtensionInvokeError;
    readonly audit?: ExtensionCapabilityAuditEntry;
};
/** The result of `hostContext.getScope`: the scope the host resolved for the contribution. */
export type ExtensionHostContextResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.host.context';
    readonly method: 'get-scope';
    readonly scope: ExtensionInvokeScope;
    readonly declaredScopes: readonly ('app' | 'branch' | 'project' | 'session')[];
};
```

### Declarations from `dist/generated/broker-result.d.ts`

```ts
import type { ExtensionHostContextResult } from './broker.js';
import type { ExtensionDocsDiscoverResult, ExtensionDocsResolveTopicResult } from './docs.js';
import type { ExtensionActionSelectProjectResult, ExtensionSessionResourcePublishResult, ExtensionSessionResourcesListResult, ExtensionSettingsGetResult, ExtensionSettingsGetSettingResult, ExtensionSettingsUpdateResult, ExtensionSettingsUpdateSettingResult, ExtensionStateCurrentBranchReadResult, ExtensionStateCurrentProjectReadResult, ExtensionStateCurrentSessionReadResult, ExtensionStateModelPreferencesReadResult, ExtensionStateReadResult, ExtensionStateRecentProjectsReadResult } from './openwaggle.js';
import type { ExtensionRuntimeRegisterContributionResult, ExtensionRuntimeUnregisterContributionResult, ExtensionStorageDeleteResult, ExtensionStorageGetResult, ExtensionStorageListResult, ExtensionStorageSetResult } from './storage.js';
/** Every result value the broker returns, one per capability method. */
export type ExtensionInvokeSuccessValue = ExtensionActionSelectProjectResult | ExtensionDocsDiscoverResult | ExtensionDocsResolveTopicResult | ExtensionHostContextResult | ExtensionRuntimeRegisterContributionResult | ExtensionRuntimeUnregisterContributionResult | ExtensionSessionResourcePublishResult | ExtensionSessionResourcesListResult | ExtensionSettingsGetResult | ExtensionSettingsGetSettingResult | ExtensionSettingsUpdateResult | ExtensionSettingsUpdateSettingResult | ExtensionStateCurrentBranchReadResult | ExtensionStateCurrentProjectReadResult | ExtensionStateCurrentSessionReadResult | ExtensionStateModelPreferencesReadResult | ExtensionStateReadResult | ExtensionStateRecentProjectsReadResult | ExtensionStorageDeleteResult | ExtensionStorageGetResult | ExtensionStorageListResult | ExtensionStorageSetResult;
```

### Declarations from `dist/generated/docs.d.ts`

```ts
export type ExtensionDocsDiscoverPayload = {
    readonly projectPaths?: readonly string[];
    readonly includeExtensions?: boolean;
};
export type ExtensionDocsResolveTopicPayload = {
    readonly topic: string;
};
export type ExtensionDocsDiscoverResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.docs';
    readonly method: 'discover-docs';
    readonly docs: ExtensionDocsDiscoveryView;
};
export type ExtensionDocsResolveTopicResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.docs';
    readonly method: 'resolve-docs-topic';
    readonly resolvedTopic: FirstPartyDocsTopicSummary | null;
};
export type ExtensionDocsDiscoveryView = {
    readonly generatedAt: string;
    readonly bundlePath: string;
    readonly firstPartyTopics: readonly FirstPartyDocsTopicSummary[];
    readonly extensionTopics: readonly {
        readonly topic: string;
        readonly localTopic: string;
        readonly title: string;
        readonly description?: string;
        readonly path: string;
        readonly aliases: readonly string[];
        readonly keywords: readonly string[];
        readonly contentHash: string | null;
        readonly provenance: {
            readonly extensionId: string;
            readonly extensionName: string | null;
            readonly extensionVersion: string | null;
            readonly scope: {
                readonly kind: 'global' | 'project';
                readonly label: string;
                readonly projectPath?: string;
            };
            readonly packagePath: string;
            readonly manifestPath: string;
            readonly path: string;
            readonly packageContentHash: string | null;
            readonly trust: 'trusted' | 'unknown' | 'untrusted';
            readonly lifecycle: 'disabled' | 'enabled' | 'unavailable';
        };
        readonly diagnostics: readonly {
            readonly severity: 'error' | 'warning';
            readonly code: string;
            readonly message: string;
            readonly path?: string;
        }[];
    }[];
    readonly diagnostics: readonly {
        readonly severity: 'error' | 'warning';
        readonly code: string;
        readonly message: string;
        readonly path?: string;
    }[];
};
export type FirstPartyDocsTopicSummary = {
    readonly topic: string;
    readonly source: 'openwaggle' | 'pi';
    readonly group: string;
    readonly title: string;
    readonly description?: string;
    readonly section?: string;
    readonly order: number;
    readonly path: string;
    readonly bundlePath: string;
    readonly sourcePath: string;
    readonly aliases: readonly string[];
    readonly keywords: readonly string[];
    readonly contentHash: string;
};
```

### Declarations from `dist/generated/openwaggle.d.ts`

```ts
import type { ExtensionInvokeScope } from './broker.js';
export type ExtensionModelPrefs = {
    readonly selectedModel: string;
    readonly favoriteModels: readonly string[];
    readonly enabledModels: readonly string[];
    readonly thinkingLevel: string;
};
export type ExtensionProjectView = {
    readonly projectPath: string;
    readonly displayName: string | null;
    readonly active: boolean;
};
export type ExtensionSessionView = {
    readonly sessionId: string;
    readonly title: string;
    readonly projectPath: string | null;
};
export type ExtensionBranchView = {
    readonly branchId: string;
    readonly sessionId: string;
    readonly name: string;
    readonly main: boolean;
    readonly archived: boolean;
};
export type ExtensionStateReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'get-state';
    readonly scope: ExtensionInvokeScope;
    readonly activeProjectPath: string | null;
    readonly currentProject: ExtensionProjectView | null;
    readonly currentSession: ExtensionSessionView | null;
    readonly currentBranch: ExtensionBranchView | null;
    readonly recentProjects: readonly string[];
    readonly modelPreferences: ExtensionModelPrefs;
};
export type ExtensionStateCurrentProjectReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'read-state';
    readonly scope: ExtensionInvokeScope;
    readonly selector: 'current-branch' | 'current-project' | 'current-session' | 'model-preferences' | 'recent-projects';
    readonly value: {
        readonly active: boolean;
        readonly displayName: string | null;
        readonly projectPath: string;
    } | null;
};
export type ExtensionStateCurrentSessionReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'read-state';
    readonly scope: ExtensionInvokeScope;
    readonly selector: 'current-branch' | 'current-project' | 'current-session' | 'model-preferences' | 'recent-projects';
    readonly value: {
        readonly projectPath: string | null;
        readonly sessionId: string;
        readonly title: string;
    } | null;
};
export type ExtensionStateCurrentBranchReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'read-state';
    readonly scope: ExtensionInvokeScope;
    readonly selector: 'current-branch' | 'current-project' | 'current-session' | 'model-preferences' | 'recent-projects';
    readonly value: {
        readonly archived: boolean;
        readonly branchId: string;
        readonly main: boolean;
        readonly name: string;
        readonly sessionId: string;
    } | null;
};
export type ExtensionStateRecentProjectsReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'read-state';
    readonly scope: ExtensionInvokeScope;
    readonly selector: 'current-branch' | 'current-project' | 'current-session' | 'model-preferences' | 'recent-projects';
    readonly value: readonly string[];
};
export type ExtensionStateModelPreferencesReadResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.state';
    readonly method: 'read-state';
    readonly scope: ExtensionInvokeScope;
    readonly selector: 'current-branch' | 'current-project' | 'current-session' | 'model-preferences' | 'recent-projects';
    readonly value: {
        readonly enabledModels: readonly string[];
        readonly favoriteModels: readonly string[];
        readonly selectedModel: string;
        readonly thinkingLevel: string;
    };
};
export type ExtensionActionSelectProjectResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.actions';
    readonly method: 'select-project';
    readonly previousProjectPath: string | null;
    readonly projectPath: string;
    readonly recentProjects: readonly string[];
};
export type ExtensionSessionResourceKind = 'change-request' | 'commit' | 'file' | 'image' | 'link' | 'site' | 'tool' | 'web-search';
export type ExtensionSessionResourceRole = 'output' | 'source';
export type ExtensionSessionResourceView = {
    readonly id: string;
    readonly title: string;
    readonly kind: ExtensionSessionResourceKind;
    readonly mimeType: string | null;
    readonly available: boolean;
    readonly isSource: boolean;
    readonly isOutput: boolean;
};
export type ExtensionSessionResourcePublishPayload = {
    readonly key: string;
    readonly title: string;
    readonly kind: 'image' | 'link';
    readonly role: ExtensionSessionResourceRole;
    readonly locator: string;
};
export type ExtensionSessionResourcesListPayload = {
    readonly cursor?: string | null;
    readonly limit?: number;
};
export type ExtensionSessionResourcesListResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.resources';
    readonly sessionId: string;
    readonly method: 'list-resources';
    readonly resources: readonly ExtensionSessionResourceView[];
    readonly total: number;
    readonly nextCursor: string | null;
};
export type ExtensionSessionResourcePublishResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.resources';
    readonly sessionId: string;
    readonly method: 'publish-resource';
    readonly resource: ExtensionSessionResourceView;
};
export type ExtensionSettingsView = {
    readonly modelPreferences: ExtensionModelPrefs;
    readonly projectDisplayNames: Readonly<Record<string, string>>;
};
export type ExtensionModelPreferencesSettingsPatch = {
    readonly selectedModel?: string;
    readonly favoriteModels?: readonly string[];
    readonly enabledModels?: readonly string[];
    /** Accepted for SDK compatibility and ignored: extensions cannot change the thinking level. */
    readonly thinkingLevel?: string;
};
export type ExtensionSettingsUpdatePayload = {
    readonly selectedModel?: string;
    readonly favoriteModels?: readonly string[];
    readonly enabledModels?: readonly string[];
    /** Accepted for SDK compatibility and ignored: extensions cannot change the thinking level. */
    readonly thinkingLevel?: string;
    readonly projectDisplayNames?: Readonly<Record<string, string>>;
};
export type ExtensionSettingsGetResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.settings';
    readonly method: 'get-settings';
    readonly settings: ExtensionSettingsView;
};
export type ExtensionSettingsUpdateResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.settings';
    readonly method: 'update-settings';
    readonly settings: ExtensionSettingsView;
};
export type ExtensionSettingsSelectedValue = {
    readonly key: 'model-preferences';
    readonly value: ExtensionModelPrefs;
} | {
    readonly key: 'project-display-name';
    readonly projectPath: string;
    readonly value: string | null;
};
export type ExtensionSettingsGetSettingResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.settings';
    readonly method: 'get-setting';
    readonly setting: ExtensionSettingsSelectedValue;
};
export type ExtensionSettingsUpdateSettingResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.settings';
    readonly method: 'update-setting';
    readonly setting: ExtensionSettingsSelectedValue;
};
```

### Declarations from `dist/generated/storage.d.ts`

```ts
import type { JsonValue } from '../json.js';
/** Which package store a call uses: package state or package configuration. */
export type ExtensionStorageKind = 'config' | 'state';
/** Which storage scope a call reads or writes. */
export type ExtensionStorageScopeSelector = 'global' | 'project';
/** The storage scope a result belongs to. */
export type ExtensionStorageScope = {
    readonly kind: 'global';
} | {
    readonly kind: 'project';
    readonly projectPath: string;
};
export type ExtensionStorageGetResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.storage';
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
    readonly method: 'get';
    readonly key: string;
    readonly value: JsonValue;
};
export type ExtensionStorageSetResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.storage';
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
    readonly method: 'set';
    readonly key: string;
    readonly value: JsonValue;
    readonly createdAt: number;
    readonly updatedAt: number;
};
export type ExtensionStorageDeleteResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.storage';
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
    readonly method: 'delete';
    readonly key: string;
    readonly deleted: true;
};
export type ExtensionStorageListResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.storage';
    readonly storageKind: ExtensionStorageKind;
    readonly storageScope: ExtensionStorageScope;
    readonly method: 'list';
    readonly keys: readonly string[];
};
export type ExtensionRuntimeRegisterContributionResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.runtime';
    readonly family: 'commands' | 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'routes' | 'sessionSummarySections' | 'settingsSections' | 'sidePanels' | 'slashCommands' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
    readonly method: 'register-contribution';
    readonly registeredContributionId: string;
};
export type ExtensionRuntimeUnregisterContributionResult = {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: 'openwaggle.runtime';
    readonly family: 'commands' | 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'routes' | 'sessionSummarySections' | 'settingsSections' | 'sidePanels' | 'slashCommands' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
    readonly method: 'unregister-contribution';
    readonly unregisteredContributionId: string;
    readonly unregistered: boolean;
};
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

### Declarations from `dist/openwaggle-types.d.ts`

```ts
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js';
import type { ExtensionInvokeScope, ExtensionStateSelector } from './core-types.js';
export type { ExtensionDocsDiscoverPayload, ExtensionDocsDiscoverResult, ExtensionDocsResolveTopicPayload, ExtensionDocsResolveTopicResult, } from './generated/docs.js';
export type * from './generated/openwaggle.js';
/** The result of reading one state selector; each `ExtensionState*ReadResult` narrows it. */
export interface ExtensionSelectedStateReadResult<TValue> {
    readonly extensionId: string;
    readonly contributionId: string;
    readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE;
    readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE;
    readonly scope: ExtensionInvokeScope;
    readonly selector: ExtensionStateSelector;
    readonly value: TValue;
}
```

### Declarations from `dist/registry-types.d.ts`

```ts
import type { ExtensionCapabilityScope, ExtensionContributionFamily, ExtensionContributionMatchView, ExtensionContributionRuntime, ExtensionContributionTargetView, ExtensionExecutionPlacement } from './contribution-types.js';
import type { ExtensionSessionSummaryDisclosure, ExtensionSessionSummaryRow, ExtensionSessionSummaryState } from './generated/manifest.js';
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
    readonly sessionSummary?: {
        readonly placement: 'context' | 'coordination' | 'details';
        readonly disclosure?: ExtensionSessionSummaryDisclosure;
        readonly state?: ExtensionSessionSummaryState;
        readonly rows: readonly ExtensionSessionSummaryRow[];
    };
}
```

### Declarations from `dist/runtime-types.d.ts`

```ts
export type { ExtensionRuntimeRegisterContributionResult, ExtensionRuntimeUnregisterContributionResult, } from './generated/storage.js';
```

### Declarations from `dist/storage-types.d.ts`

```ts
import type { ExtensionStorageGetResult } from './generated/storage.js';
export type { ExtensionStorageDeleteResult, ExtensionStorageGetResult, ExtensionStorageKind, ExtensionStorageListResult, ExtensionStorageScope, ExtensionStorageScopeSelector, ExtensionStorageSetResult, } from './generated/storage.js';
/** The fields every storage result carries. */
export type ExtensionStorageResultBase = Pick<ExtensionStorageGetResult, 'extensionId' | 'contributionId' | 'capability' | 'storageKind' | 'storageScope'>;
```

### Declarations from `dist/validation-types.d.ts`

```ts
/**
 * One reason a value failed validation. `path` is the dotted field path the host reports in its
 * diagnostics, such as `contributions.sidePanels.0.icon`, with array items by index, and
 * `(root)` for the value itself.
 */
export interface ExtensionValidationIssue {
    readonly path: string;
    readonly message: string;
}
/** What a `validate*` helper returns: the valid value, or every issue it found. */
export type ExtensionValidationResult<TValue> = {
    readonly success: true;
    readonly value: TValue;
} | {
    readonly success: false;
    readonly issues: readonly ExtensionValidationIssue[];
};
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
    readonly root: 'ow-extension-root';
    readonly panel: 'ow-extension-panel';
    readonly stack: 'ow-extension-stack';
    readonly row: 'ow-extension-row';
    readonly heading: 'ow-extension-heading';
    readonly text: 'ow-extension-text';
    readonly muted: 'ow-extension-muted';
    readonly divider: 'ow-extension-divider';
    readonly button: 'ow-extension-button';
    readonly input: 'ow-extension-input';
    readonly textarea: 'ow-extension-textarea';
    readonly select: 'ow-extension-select';
    readonly checkbox: 'ow-extension-checkbox';
    readonly badge: 'ow-extension-badge';
    readonly field: 'ow-extension-field';
    readonly alert: 'ow-extension-alert';
    readonly syntaxBlock: 'ow-syntax-block';
    readonly syntaxLineNumber: 'ow-syntax-line-number';
};
export declare const OPENWAGGLE_EXTENSION_UI_ATTRIBUTES: {
    readonly tone: 'data-ow-tone';
    readonly variant: 'data-ow-variant';
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
export type OpenWaggleExtensionColorScheme = 'dark' | 'light' | 'high-contrast-dark' | 'high-contrast-light';
export interface OpenWaggleExtensionTypeScaleEntry {
    readonly fontSize: string;
    readonly lineHeight: string;
}
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
        readonly dangerText: string;
        readonly warning: string;
        readonly info: string;
        readonly infoText: string;
        readonly review: string;
        readonly plan: string;
        readonly progress: string;
        readonly neutral: string;
    };
    readonly typography: {
        readonly sansFamily: string;
        readonly monoFamily: string;
        readonly typeScale: {
            readonly xs: OpenWaggleExtensionTypeScaleEntry;
            readonly sm: OpenWaggleExtensionTypeScaleEntry;
            readonly base: OpenWaggleExtensionTypeScaleEntry;
            readonly lg: OpenWaggleExtensionTypeScaleEntry;
            readonly xl: OpenWaggleExtensionTypeScaleEntry;
            readonly twoXl: OpenWaggleExtensionTypeScaleEntry;
        };
    };
    readonly spacing: {
        readonly unit: string;
    };
    readonly radius: {
        readonly xs: string;
        readonly sm: string;
        readonly md: string;
        readonly lg: string;
        readonly xl: string;
        readonly twoXl: string;
        readonly threeXl: string;
        readonly fourXl: string;
    };
    readonly shadow: {
        readonly twoXs: string;
        readonly xs: string;
        readonly sm: string;
        readonly md: string;
        readonly lg: string;
        readonly xl: string;
        readonly twoXl: string;
    };
    readonly focus: {
        readonly ring: string;
        readonly shadow: string;
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
    readonly colorScheme?: OpenWaggleExtensionColorScheme;
    readonly resolveCssVariable?: ExtensionThemeCssVariableResolver;
}
```

## Export `./validation`

Types: `dist/validation.d.ts`

### Declarations from `dist/validation.d.ts`

```ts
import type { ExtensionCapabilityDeclaration, OpenWaggleExtensionManifest } from './generated/manifest.js';
import type { OpenWaggleExtensionTheme } from './theme-types.js';
import type { ExtensionValidationResult } from './validation-types.js';
export type { ExtensionValidationIssue, ExtensionValidationResult } from './validation-types.js';
/** Checks an `openwaggle.extension.json` manifest the way OpenWaggle does when it loads one. */
export declare const validateExtensionManifest: (value: unknown) => ExtensionValidationResult<OpenWaggleExtensionManifest>;
/**
 * Checks one entry of a manifest's `capabilities`: its shape, and for a built-in broker capability
 * that it declares at least one method and only methods the broker supports.
 */
export declare const validateBrokerCapabilityDeclaration: (value: unknown) => ExtensionValidationResult<ExtensionCapabilityDeclaration>;
/**
 * Checks a theme object: its colour scheme, and that `tokens` and `cssVariables` hold exactly the
 * token groups and keys of the current theme contract. The theme itself may carry more fields.
 */
export declare const validateOpenWaggleExtensionTheme: (value: unknown) => ExtensionValidationResult<OpenWaggleExtensionTheme>;
```

### Declarations from `dist/generated/manifest.d.ts`

```ts
/** The scopes a broker capability can be called in. */
export type ExtensionCapabilityScope = 'app' | 'branch' | 'project' | 'session';
/** A contribution family: the manifest key a contribution is declared under. */
export type ExtensionContributionFamily = 'commands' | 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'routes' | 'sessionSummarySections' | 'settingsSections' | 'sidePanels' | 'slashCommands' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
/** How a contribution's entry module runs. */
export type ExtensionContributionRuntime = 'federated-module' | 'trusted-renderer';
/** Where a contribution's entry module runs. */
export type ExtensionExecutionPlacement = 'frame' | 'host-renderer';
/** Whether OpenWaggle installs the package's prebuilt artifacts or builds it locally. */
export type ExtensionInstallSource = 'local-build' | 'prebuilt';
/** The projects and sessions a contribution is limited to. */
export type ExtensionContributionTargetView = {
    readonly projectPaths?: readonly string[];
    readonly sessionIds?: readonly string[];
};
/** The tool calls, custom messages and interactions a renderer contribution handles. */
export type ExtensionContributionMatchView = {
    readonly toolNames?: readonly string[];
    readonly customMessageNames?: readonly string[];
    readonly interactionKinds?: readonly string[];
};
/** A broker capability the extension uses, with the methods and scopes it calls. */
export type ExtensionCapabilityDeclaration = {
    readonly id: string;
    readonly methods?: readonly string[];
    readonly scopes?: readonly ExtensionCapabilityScope[];
};
/** A command or slash command. */
export type ExtensionCommandContribution = {
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly id: string;
    readonly title: string;
    readonly category?: string;
    readonly target?: ExtensionContributionTargetView;
};
/**
 * A contribution that mounts an entry module: a route, or a settings section, dialog, renderer
 * or status widget.
 */
export type ExtensionSurfaceContribution = {
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly id: string;
    readonly title: string;
    readonly runtime: ExtensionContributionRuntime;
    readonly execution: ExtensionExecutionPlacement;
    readonly entry: string;
    readonly target?: ExtensionContributionTargetView;
    readonly matches?: ExtensionContributionMatchView;
};
/** A side panel's Panel rail icon: a Lucide icon name in kebab-case, or a package `.svg` file. */
export type ExtensionSidePanelIcon = string | {
    readonly svg: string;
};
/** A side panel, with its optional Panel rail icon. */
export type ExtensionSidePanelContribution = {
    readonly capability?: string;
    readonly method?: string;
    readonly methods?: readonly string[];
    readonly id: string;
    readonly title: string;
    readonly runtime: ExtensionContributionRuntime;
    readonly execution: ExtensionExecutionPlacement;
    readonly entry: string;
    readonly target?: ExtensionContributionTargetView;
    readonly matches?: ExtensionContributionMatchView;
    readonly icon?: ExtensionSidePanelIcon;
};
/** Any contribution that mounts an entry module. */
export type ExtensionEntryContribution = ExtensionSidePanelContribution | ExtensionSurfaceContribution;
/** A row of a Session Summary section. */
export type ExtensionSessionSummaryRow = {
    readonly id: string;
    readonly label: string;
    readonly value?: string;
    readonly badge?: string;
    readonly count?: number;
    readonly resourceId?: string;
    readonly action?: {
        readonly family: 'commands' | 'dialogs' | 'sidePanels';
        readonly contributionId: string;
    };
};
/** Whether a Session Summary section starts expanded, can collapse, and collapses by itself. */
export type ExtensionSessionSummaryDisclosure = {
    readonly defaultExpanded?: boolean;
    readonly collapsible?: boolean;
    readonly autoCollapseAfterMs?: number;
};
/** The status a Session Summary section shows. */
export type ExtensionSessionSummaryState = {
    readonly status: 'failure';
    readonly message: string;
} | {
    readonly status: 'live' | 'loading';
    readonly message?: string;
} | {
    readonly status: 'ready';
};
/** A declarative Session Summary section. */
export type ExtensionSessionSummaryContribution = {
    readonly id: string;
    readonly title: string;
    readonly placement?: 'context' | 'coordination' | 'details';
    readonly target?: ExtensionContributionTargetView;
    readonly disclosure?: ExtensionSessionSummaryDisclosure;
    readonly state?: ExtensionSessionSummaryState;
    readonly rows: readonly ExtensionSessionSummaryRow[];
};
/** Every contribution a manifest declares, by family. */
export type ExtensionContributions = {
    readonly commands?: readonly ExtensionCommandContribution[];
    readonly slashCommands?: readonly ExtensionCommandContribution[];
    readonly routes?: readonly ExtensionSurfaceContribution[];
    readonly settingsSections?: readonly ExtensionSurfaceContribution[];
    readonly sidePanels?: readonly ExtensionSidePanelContribution[];
    readonly dialogs?: readonly ExtensionSurfaceContribution[];
    readonly transcriptRenderers?: readonly ExtensionSurfaceContribution[];
    readonly toolRenderers?: readonly ExtensionSurfaceContribution[];
    readonly customMessageRenderers?: readonly ExtensionSurfaceContribution[];
    readonly interactionRenderers?: readonly ExtensionSurfaceContribution[];
    readonly statusWidgets?: readonly ExtensionSurfaceContribution[];
    readonly sessionSummarySections?: readonly ExtensionSessionSummaryContribution[];
};
/** A contribution registered at runtime, with its family. */
export type ExtensionContributionRegistration = {
    readonly family: 'commands' | 'slashCommands';
    readonly contribution: ExtensionCommandContribution;
} | {
    readonly family: 'customMessageRenderers' | 'dialogs' | 'interactionRenderers' | 'settingsSections' | 'statusWidgets' | 'toolRenderers' | 'transcriptRenderers';
    readonly contribution: ExtensionSurfaceContribution;
} | {
    readonly family: 'routes';
    readonly contribution: ExtensionSurfaceContribution;
} | {
    readonly family: 'sessionSummarySections';
    readonly contribution: ExtensionSessionSummaryContribution;
} | {
    readonly family: 'sidePanels';
    readonly contribution: ExtensionSidePanelContribution;
};
/** A runtime contribution to remove, by family and id. */
export type ExtensionContributionUnregistration = {
    readonly family: ExtensionContributionFamily;
    readonly contributionId: string;
};
/** A binary or package command the extension needs before it runs. */
export type ExtensionRuntimeRequirementDeclaration = {
    readonly id: string;
    readonly label: string;
    readonly kind?: 'binary' | 'command';
    readonly command?: string;
    readonly binary?: string;
};
/** A documentation topic the extension ships. */
export type ExtensionDocsTopicDeclaration = {
    readonly id: string;
    readonly title: string;
    readonly path: string;
    readonly description?: string;
    readonly aliases?: readonly string[];
    readonly keywords?: readonly string[];
};
/** An `openwaggle.extension.json` manifest. */
export type OpenWaggleExtensionManifest = {
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
        readonly topics?: readonly ExtensionDocsTopicDeclaration[];
    };
    readonly network?: {
        readonly origins: readonly string[];
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
};
```

### Declarations from `dist/theme-types.d.ts`

```ts
export type OpenWaggleExtensionColorScheme = 'dark' | 'light' | 'high-contrast-dark' | 'high-contrast-light';
export interface OpenWaggleExtensionTypeScaleEntry {
    readonly fontSize: string;
    readonly lineHeight: string;
}
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
        readonly dangerText: string;
        readonly warning: string;
        readonly info: string;
        readonly infoText: string;
        readonly review: string;
        readonly plan: string;
        readonly progress: string;
        readonly neutral: string;
    };
    readonly typography: {
        readonly sansFamily: string;
        readonly monoFamily: string;
        readonly typeScale: {
            readonly xs: OpenWaggleExtensionTypeScaleEntry;
            readonly sm: OpenWaggleExtensionTypeScaleEntry;
            readonly base: OpenWaggleExtensionTypeScaleEntry;
            readonly lg: OpenWaggleExtensionTypeScaleEntry;
            readonly xl: OpenWaggleExtensionTypeScaleEntry;
            readonly twoXl: OpenWaggleExtensionTypeScaleEntry;
        };
    };
    readonly spacing: {
        readonly unit: string;
    };
    readonly radius: {
        readonly xs: string;
        readonly sm: string;
        readonly md: string;
        readonly lg: string;
        readonly xl: string;
        readonly twoXl: string;
        readonly threeXl: string;
        readonly fourXl: string;
    };
    readonly shadow: {
        readonly twoXs: string;
        readonly xs: string;
        readonly sm: string;
        readonly md: string;
        readonly lg: string;
        readonly xl: string;
        readonly twoXl: string;
    };
    readonly focus: {
        readonly ring: string;
        readonly shadow: string;
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
    readonly colorScheme?: OpenWaggleExtensionColorScheme;
    readonly resolveCssVariable?: ExtensionThemeCssVariableResolver;
}
```

### Declarations from `dist/validation-types.d.ts`

```ts
/**
 * One reason a value failed validation. `path` is the dotted field path the host reports in its
 * diagnostics, such as `contributions.sidePanels.0.icon`, with array items by index, and
 * `(root)` for the value itself.
 */
export interface ExtensionValidationIssue {
    readonly path: string;
    readonly message: string;
}
/** What a `validate*` helper returns: the valid value, or every issue it found. */
export type ExtensionValidationResult<TValue> = {
    readonly success: true;
    readonly value: TValue;
} | {
    readonly success: false;
    readonly issues: readonly ExtensionValidationIssue[];
};
```
