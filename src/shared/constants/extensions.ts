import { TIME_UNIT } from './time'

const EXTENSION_CONTRIBUTION_FAMILY = {
  COMMANDS: 'commands',
  SLASH_COMMANDS: 'slashCommands',
  ROUTES: 'routes',
  SETTINGS_SECTIONS: 'settingsSections',
  SIDE_PANELS: 'sidePanels',
  DIALOGS: 'dialogs',
  TRANSCRIPT_RENDERERS: 'transcriptRenderers',
  TOOL_RENDERERS: 'toolRenderers',
  CUSTOM_MESSAGE_RENDERERS: 'customMessageRenderers',
  INTERACTION_RENDERERS: 'interactionRenderers',
  STATUS_WIDGETS: 'statusWidgets',
} as const

const EXTENSION_COMMAND_CONTRIBUTION_FAMILIES = Object.freeze([
  EXTENSION_CONTRIBUTION_FAMILY.COMMANDS,
  EXTENSION_CONTRIBUTION_FAMILY.SLASH_COMMANDS,
] as const)

const EXTENSION_SLOT_CONTRIBUTION_FAMILIES = Object.freeze([
  EXTENSION_CONTRIBUTION_FAMILY.SETTINGS_SECTIONS,
  EXTENSION_CONTRIBUTION_FAMILY.SIDE_PANELS,
  EXTENSION_CONTRIBUTION_FAMILY.DIALOGS,
  EXTENSION_CONTRIBUTION_FAMILY.TRANSCRIPT_RENDERERS,
  EXTENSION_CONTRIBUTION_FAMILY.TOOL_RENDERERS,
  EXTENSION_CONTRIBUTION_FAMILY.CUSTOM_MESSAGE_RENDERERS,
  EXTENSION_CONTRIBUTION_FAMILY.INTERACTION_RENDERERS,
  EXTENSION_CONTRIBUTION_FAMILY.STATUS_WIDGETS,
] as const)

const EXTENSION_ENTRY_CONTRIBUTION_FAMILIES = Object.freeze([
  EXTENSION_CONTRIBUTION_FAMILY.ROUTES,
  ...EXTENSION_SLOT_CONTRIBUTION_FAMILIES,
] as const)

const EXTENSION_CONTRIBUTION_FAMILIES = Object.freeze([
  ...EXTENSION_COMMAND_CONTRIBUTION_FAMILIES,
  ...EXTENSION_ENTRY_CONTRIBUTION_FAMILIES,
] as const)

const EXTENSION_CONTRIBUTION_RUNTIME = {
  FEDERATED_MODULE: 'federated-module',
  TRUSTED_RENDERER: 'trusted-renderer',
} as const

const EXTENSION_EXECUTION_PLACEMENT = {
  HOST_RENDERER: 'host-renderer',
  FRAME: 'frame',
} as const

const EXTENSION_STORAGE_KIND = {
  STATE: 'state',
  CONFIG: 'config',
} as const

const EXTENSION_STORAGE_SCOPE = {
  GLOBAL_KIND: 'global',
  PROJECT_KIND: 'project',
  GLOBAL_ID: 'global',
} as const

const EXTENSION_DIAGNOSTIC_SEVERITY = {
  ERROR: 'error',
  WARNING: 'warning',
} as const

const EXTENSION_DIAGNOSTIC_CODE = {
  MANIFEST_MISSING: 'manifest-missing',
  MANIFEST_JSON_INVALID: 'manifest-json-invalid',
  MANIFEST_SCHEMA_INVALID: 'manifest-schema-invalid',
  MANIFEST_ID_MISMATCH: 'manifest-id-mismatch',
  SOURCE_FILE_MISSING: 'source-file-missing',
  BUILT_ARTIFACT_MISSING: 'built-artifact-missing',
  RUNTIME_FILE_MISSING: 'runtime-file-missing',
  BUILD_COMMAND_MISSING: 'build-command-missing',
  BUILD_OUTPUT_NOT_ARTIFACT: 'build-output-not-artifact',
  BUILD_FAILED: 'build-failed',
  BUILD_ARTIFACTS_INVALID: 'build-artifacts-invalid',
  PACKAGE_PATH_INVALID: 'package-path-invalid',
  SDK_RANGE_INVALID: 'sdk-range-invalid',
  SDK_INCOMPATIBLE: 'sdk-incompatible',
  RUNTIME_REQUIREMENT_MISSING: 'runtime-requirement-missing',
  RUNTIME_LOAD_FAILED: 'runtime-load-failed',
  CONTRIBUTION_REGISTRATION_FAILED: 'contribution-registration-failed',
  LIFECYCLE_STATE_UNAVAILABLE: 'lifecycle-state-unavailable',
  PROJECT_OVERRIDE_UNAVAILABLE: 'project-override-unavailable',
  FILESYSTEM_ERROR: 'filesystem-error',
} as const

const EXTENSION_INSTALL_SOURCE = {
  PREBUILT: 'prebuilt',
  LOCAL_BUILD: 'local-build',
} as const

const EXTENSION_BUILD_RUN_STATUS = {
  NOT_RUN: 'not-run',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
} as const

const EXTENSION_RELOAD_STATUS = {
  NOT_RELOADED: 'not-reloaded',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
} as const

const EXTENSION_PRIVILEGE_GRANT = {
  TRUSTED_MAIN: 'openwaggle.privilege.trusted-main',
  TRUSTED_RENDERER: 'openwaggle.privilege.trusted-renderer',
  NETWORK: 'openwaggle.privilege.network',
  LOCAL_BUILD: 'openwaggle.privilege.local-build',
} as const

const EXTENSION_RUNTIME_REQUIREMENT_TYPE = {
  BINARY: 'binary',
  COMMAND: 'command',
} as const

const EXTENSION_REQUIREMENT_KIND = {
  RUNTIME_BINARY: 'runtime-binary',
  RUNTIME_COMMAND: 'runtime-command',
  PRIVILEGED_CAPABILITY: 'privileged-capability',
  PRIVILEGED_NETWORK: 'privileged-network',
  PRIVILEGED_LOCAL_BUILD: 'privileged-local-build',
  PRIVILEGED_TRUSTED_MAIN: 'privileged-trusted-main',
  PRIVILEGED_TRUSTED_RENDERER: 'privileged-trusted-renderer',
} as const

const EXTENSION_RUNTIME_REQUIREMENT_RESOLUTION = {
  DIAGNOSTIC_ONLY: 'diagnostic-only',
} as const

const EXTENSION_NETWORK_ACCESS_MODE = {
  BROKERED: 'brokered',
  RESTRICTED: 'restricted',
  DIRECT: 'direct',
} as const

export const OPENWAGGLE_EXTENSION = {
  MANIFEST_FILE: 'openwaggle.extension.json',
  SDK_VERSION: '0.1.0',
  PROJECT_ROOT_SEGMENTS: ['.openwaggle', 'extensions'] as const,
  GLOBAL_EXTENSIONS_DIR: 'extensions',
  SCOPE: {
    GLOBAL_KIND: 'global',
    PROJECT_KIND: 'project',
    GLOBAL_ID: 'global',
  },
  PROJECT_OVERRIDE: {
    DISABLED_LABEL: 'Project disabled',
    ACTIVE_LABEL: 'Project active',
    DISABLE_ACTION_LABEL: 'Disable for project',
    ENABLE_ACTION_LABEL: 'Enable for project',
    REQUIRED_PROJECT_PATH_ERROR: 'Project path is required to set a project extension override.',
  },
  PACKAGE_WORKFLOW: {
    GLOBAL_CONFIRMATION_RISK: 'global-extension-package-write',
  },
  LIFECYCLE: {
    UPDATE_AVAILABLE_LABEL: 'Update available',
    BUILD_APPROVAL_REQUIRED_LABEL: 'Build approval required',
    BUILD_APPROVED_LABEL: 'Build approved',
    BUILD_SUCCEEDED_LABEL: 'Build succeeded',
    BUILD_FAILED_LABEL: 'Build failed',
    RELOAD_ACTION_LABEL: 'Reload',
    RELOAD_REQUIRED_LABEL: 'Reload required',
    RELOAD_SUCCEEDED_LABEL: 'Reloaded',
    RELOAD_FAILED_LABEL: 'Reload failed',
    APPROVE_UPDATE_ACTION_LABEL: 'Approve update',
    APPROVE_BUILD_ACTION_LABEL: 'Approve and build',
    NO_UPDATE_AVAILABLE_ERROR: 'No extension update is available.',
    UNTRUSTED_UPDATE_ERROR: 'Trust this extension before approving updates.',
    APPROVE_UPDATE_REQUIRED_ERROR:
      'Approve the extension update before trusting the changed package.',
    NO_BUILD_APPROVAL_REQUIRED_ERROR: 'No local build approval is required for this extension.',
    BUILD_APPROVAL_UNAVAILABLE_ERROR:
      'Build approval is unavailable until the extension source files are valid.',
    BUILD_APPROVAL_REQUIRED_ERROR: 'the local build plan has not been approved.',
    BUILD_COMMAND_UNAVAILABLE_ERROR: 'The approved local build command is unavailable.',
    BUILD_ARTIFACT_VALIDATION_ERROR:
      'The approved build completed, but declared build artifacts are still invalid.',
    RELOAD_DISABLED_ERROR: 'Enable this extension before reloading it.',
  },
  LIMITS: {
    ID_MAX_LENGTH: 96,
    CONTRIBUTION_ID_MAX_LENGTH: 128,
    NAME_MAX_LENGTH: 120,
    DESCRIPTION_MAX_LENGTH: 2_000,
    RELATIVE_PATH_MAX_LENGTH: 260,
    NETWORK_ORIGIN_MAX_LENGTH: 300,
    RUNTIME_REQUIREMENT_BINARY_MAX_LENGTH: 120,
    BUILD_COMMAND_MAX_LENGTH: 500,
    BUILD_LOG_MAX_LENGTH: 4_000,
    BUILD_COMMAND_TIMEOUT_MS: TIME_UNIT.TEN_MINUTES_MS,
  },
  PATTERNS: {
    WINDOWS_ABSOLUTE_PATH: /^[A-Za-z]:[\\/]/,
    ID: /^[a-z0-9][a-z0-9._-]*$/,
    CONTRIBUTION_ID: /^[a-z0-9][a-z0-9._/-]*$/,
    SEMVER_VERSION:
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    SEMVER_CORE: /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    SEMVER_COMPARATOR: /^(>=|>|<=|<|=)?(.+)$/,
  },
  SEMVER_MATCH: {
    MAJOR: 1,
    MINOR: 2,
    PATCH: 3,
    COMPARATOR_OPERATOR: 1,
    COMPARATOR_VERSION: 2,
  },
  PATH: {
    NUL_CHARACTER: '\0',
    POSIX_SEPARATOR: '/',
    WINDOWS_SEPARATOR: '\\',
    RELATIVE_PARENT_SEGMENT: '..',
    CURRENT_DIRECTORY_SEGMENT: '.',
  },
  RUNTIME_MODULE_PROTOCOL: {
    SCHEME: 'openwaggle-extension',
    HOST: 'runtime',
    MODULE_PATH_PREFIX: '/module',
    MODULE_CONTEXT_SEGMENT: '__context__',
  },
  CAPABILITY_SCOPES: ['app', 'project', 'session', 'branch'] as const,
  CONTRIBUTION_FAMILY: EXTENSION_CONTRIBUTION_FAMILY,
  CONTRIBUTION_FAMILIES: EXTENSION_CONTRIBUTION_FAMILIES,
  COMMAND_CONTRIBUTION_FAMILIES: EXTENSION_COMMAND_CONTRIBUTION_FAMILIES,
  CONTRIBUTION_RUNTIME: EXTENSION_CONTRIBUTION_RUNTIME,
  CONTRIBUTION_RUNTIMES: Object.freeze(Object.values(EXTENSION_CONTRIBUTION_RUNTIME)),
  EXECUTION_PLACEMENT: EXTENSION_EXECUTION_PLACEMENT,
  EXECUTION_PLACEMENTS: Object.freeze(Object.values(EXTENSION_EXECUTION_PLACEMENT)),
  STORAGE: {
    KIND: EXTENSION_STORAGE_KIND,
    KINDS: Object.freeze(Object.values(EXTENSION_STORAGE_KIND)),
    SCOPE: EXTENSION_STORAGE_SCOPE,
    SCOPE_KINDS: Object.freeze([
      EXTENSION_STORAGE_SCOPE.GLOBAL_KIND,
      EXTENSION_STORAGE_SCOPE.PROJECT_KIND,
    ]),
    KEY_MAX_LENGTH: 160,
  },
  ENTRY_CONTRIBUTION_FAMILIES: EXTENSION_ENTRY_CONTRIBUTION_FAMILIES,
  SLOT_CONTRIBUTION_FAMILIES: EXTENSION_SLOT_CONTRIBUTION_FAMILIES,
  DIAGNOSTIC: {
    SEVERITY: EXTENSION_DIAGNOSTIC_SEVERITY,
    SEVERITIES: Object.freeze(Object.values(EXTENSION_DIAGNOSTIC_SEVERITY)),
    CODE: EXTENSION_DIAGNOSTIC_CODE,
    BUILD_BLOCKING_CODES: [
      EXTENSION_DIAGNOSTIC_CODE.SOURCE_FILE_MISSING,
      EXTENSION_DIAGNOSTIC_CODE.BUILT_ARTIFACT_MISSING,
      EXTENSION_DIAGNOSTIC_CODE.RUNTIME_FILE_MISSING,
      EXTENSION_DIAGNOSTIC_CODE.BUILD_COMMAND_MISSING,
      EXTENSION_DIAGNOSTIC_CODE.BUILD_OUTPUT_NOT_ARTIFACT,
      EXTENSION_DIAGNOSTIC_CODE.PACKAGE_PATH_INVALID,
      EXTENSION_DIAGNOSTIC_CODE.FILESYSTEM_ERROR,
    ] as const,
    CODES: Object.freeze(Object.values(EXTENSION_DIAGNOSTIC_CODE)),
  },
  HASH: {
    ALGORITHM: 'sha256',
    ENCODING: 'hex',
    HEX_LENGTH: 64,
    FIELD_SEPARATOR: '\0',
    MANIFEST_LABEL: 'manifest',
    ARTIFACT_LABEL: 'artifact',
    BUILD_PLAN_LABEL: 'build-plan',
    SOURCE_LABEL: 'source',
    BUILD_COMMAND_LABEL: 'build-command',
  },
  LABELS: {
    SOURCE_FILE: 'source file',
    BUILT_ARTIFACT: 'built artifact',
    RUNTIME_FILE: 'runtime file',
    BUILD_OUTPUT: 'build output',
  },
  INSTALL_SOURCE: EXTENSION_INSTALL_SOURCE,
  INSTALL_SOURCES: Object.freeze(Object.values(EXTENSION_INSTALL_SOURCE)),
  BUILD_RUN_STATUS: EXTENSION_BUILD_RUN_STATUS,
  BUILD_RUN_STATUSES: Object.freeze(Object.values(EXTENSION_BUILD_RUN_STATUS)),
  RELOAD_STATUS: EXTENSION_RELOAD_STATUS,
  RELOAD_STATUSES: Object.freeze(Object.values(EXTENSION_RELOAD_STATUS)),
  PRIVILEGE_GRANT: EXTENSION_PRIVILEGE_GRANT,
  PRIVILEGE_GRANTS: Object.freeze(Object.values(EXTENSION_PRIVILEGE_GRANT)),
  RUNTIME_REQUIREMENT_TYPE: EXTENSION_RUNTIME_REQUIREMENT_TYPE,
  RUNTIME_REQUIREMENT_TYPES: Object.freeze(Object.values(EXTENSION_RUNTIME_REQUIREMENT_TYPE)),
  REQUIREMENT_KIND: EXTENSION_REQUIREMENT_KIND,
  REQUIREMENT_KINDS: Object.freeze(Object.values(EXTENSION_REQUIREMENT_KIND)),
  RUNTIME_REQUIREMENT_RESOLUTION: EXTENSION_RUNTIME_REQUIREMENT_RESOLUTION,
  RUNTIME_REQUIREMENT_RESOLUTIONS: Object.freeze(
    Object.values(EXTENSION_RUNTIME_REQUIREMENT_RESOLUTION),
  ),
  NETWORK_ACCESS_MODE: EXTENSION_NETWORK_ACCESS_MODE,
  NETWORK_ACCESS_MODES: Object.freeze(Object.values(EXTENSION_NETWORK_ACCESS_MODE)),
} as const
