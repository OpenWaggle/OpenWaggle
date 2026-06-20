const EXTENSION_BROKER_FAILURE_CODE = {
  INVALID_INPUT: 'invalid-input',
  INVALID_PAYLOAD: 'invalid-payload',
  UNKNOWN_EXTENSION: 'unknown-extension',
  DISABLED_EXTENSION: 'disabled-extension',
  UNKNOWN_CONTRIBUTION: 'unknown-contribution',
  UNDECLARED_CAPABILITY: 'undeclared-capability',
  UNDECLARED_METHOD: 'undeclared-method',
  UNDECLARED_SCOPE: 'undeclared-scope',
  OUT_OF_SCOPE: 'out-of-scope',
  UNSUPPORTED_CAPABILITY: 'unsupported-capability',
  UNSUPPORTED_METHOD: 'unsupported-method',
  TRANSPORT_FAILED: 'transport-failed',
} as const

const EXTENSION_BROKER_OUTCOME = {
  SUCCEEDED: 'succeeded',
  REJECTED: 'rejected',
} as const

const EXTENSION_BROKER_CAPABILITY = {
  HOST_CONTEXT: 'openwaggle.host.context',
  STORAGE: 'openwaggle.storage',
  STATE: 'openwaggle.state',
  ACTIONS: 'openwaggle.actions',
  SETTINGS: 'openwaggle.settings',
  DOCS: 'openwaggle.docs',
  RUNTIME: 'openwaggle.runtime',
} as const

const EXTENSION_BROKER_METHOD = {
  GET_SCOPE: 'get-scope',
  GET: 'get',
  SET: 'set',
  DELETE: 'delete',
  LIST: 'list',
  GET_STATE: 'get-state',
  READ_STATE: 'read-state',
  SELECT_PROJECT: 'select-project',
  GET_SETTINGS: 'get-settings',
  UPDATE_SETTINGS: 'update-settings',
  GET_SETTING: 'get-setting',
  UPDATE_SETTING: 'update-setting',
  DISCOVER_DOCS: 'discover-docs',
  RESOLVE_DOCS_TOPIC: 'resolve-docs-topic',
  REGISTER_CONTRIBUTION: 'register-contribution',
  UNREGISTER_CONTRIBUTION: 'unregister-contribution',
} as const

const EXTENSION_BROKER_STATE_SELECTOR = {
  CURRENT_PROJECT: 'current-project',
  CURRENT_SESSION: 'current-session',
  CURRENT_BRANCH: 'current-branch',
  RECENT_PROJECTS: 'recent-projects',
  MODEL_PREFERENCES: 'model-preferences',
} as const

const EXTENSION_BROKER_SETTING_KEY = {
  MODEL_PREFERENCES: 'model-preferences',
  PROJECT_DISPLAY_NAME: 'project-display-name',
} as const

const EXTENSION_BROKER_CAPABILITY_METHODS = [
  {
    capability: EXTENSION_BROKER_CAPABILITY.HOST_CONTEXT,
    methods: [EXTENSION_BROKER_METHOD.GET_SCOPE],
  },
  {
    capability: EXTENSION_BROKER_CAPABILITY.STORAGE,
    methods: [
      EXTENSION_BROKER_METHOD.GET,
      EXTENSION_BROKER_METHOD.SET,
      EXTENSION_BROKER_METHOD.DELETE,
      EXTENSION_BROKER_METHOD.LIST,
    ],
  },
  {
    capability: EXTENSION_BROKER_CAPABILITY.STATE,
    methods: [EXTENSION_BROKER_METHOD.GET_STATE, EXTENSION_BROKER_METHOD.READ_STATE],
  },
  {
    capability: EXTENSION_BROKER_CAPABILITY.ACTIONS,
    methods: [EXTENSION_BROKER_METHOD.SELECT_PROJECT],
  },
  {
    capability: EXTENSION_BROKER_CAPABILITY.SETTINGS,
    methods: [
      EXTENSION_BROKER_METHOD.GET_SETTINGS,
      EXTENSION_BROKER_METHOD.UPDATE_SETTINGS,
      EXTENSION_BROKER_METHOD.GET_SETTING,
      EXTENSION_BROKER_METHOD.UPDATE_SETTING,
    ],
  },
  {
    capability: EXTENSION_BROKER_CAPABILITY.DOCS,
    methods: [EXTENSION_BROKER_METHOD.DISCOVER_DOCS, EXTENSION_BROKER_METHOD.RESOLVE_DOCS_TOPIC],
  },
  {
    capability: EXTENSION_BROKER_CAPABILITY.RUNTIME,
    methods: [
      EXTENSION_BROKER_METHOD.REGISTER_CONTRIBUTION,
      EXTENSION_BROKER_METHOD.UNREGISTER_CONTRIBUTION,
    ],
  },
] as const

export const OPENWAGGLE_EXTENSION_BROKER = {
  CAPABILITY: EXTENSION_BROKER_CAPABILITY,
  CAPABILITIES: Object.freeze(Object.values(EXTENSION_BROKER_CAPABILITY)),
  CAPABILITY_METHODS: EXTENSION_BROKER_CAPABILITY_METHODS,
  METHOD: EXTENSION_BROKER_METHOD,
  METHODS: Object.freeze(Object.values(EXTENSION_BROKER_METHOD)),
  FAILURE_CODE: EXTENSION_BROKER_FAILURE_CODE,
  FAILURE_CODES: Object.freeze(Object.values(EXTENSION_BROKER_FAILURE_CODE)),
  OUTCOME: EXTENSION_BROKER_OUTCOME,
  OUTCOMES: Object.freeze(Object.values(EXTENSION_BROKER_OUTCOME)),
  STATE_SELECTOR: EXTENSION_BROKER_STATE_SELECTOR,
  STATE_SELECTORS: Object.freeze(Object.values(EXTENSION_BROKER_STATE_SELECTOR)),
  SETTING_KEY: EXTENSION_BROKER_SETTING_KEY,
  SETTING_KEYS: Object.freeze(Object.values(EXTENSION_BROKER_SETTING_KEY)),
} as const
