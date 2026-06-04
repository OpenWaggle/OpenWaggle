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

export const OPENWAGGLE_EXTENSION_BROKER = {
  CAPABILITY: {
    HOST_CONTEXT: 'openwaggle.host.context',
    STORAGE: 'openwaggle.storage',
  },
  METHOD: {
    GET_SCOPE: 'get-scope',
    GET: 'get',
    SET: 'set',
    DELETE: 'delete',
    LIST: 'list',
  },
  FAILURE_CODE: EXTENSION_BROKER_FAILURE_CODE,
  FAILURE_CODES: Object.freeze(Object.values(EXTENSION_BROKER_FAILURE_CODE)),
  OUTCOME: EXTENSION_BROKER_OUTCOME,
  OUTCOMES: Object.freeze(Object.values(EXTENSION_BROKER_OUTCOME)),
} as const
