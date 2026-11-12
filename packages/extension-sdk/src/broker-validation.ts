import * as Schema from 'effect/Schema'
import { OPENWAGGLE_EXTENSION, OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import { jsonValueSchema } from './json.js'
import { safeDecodeExtensionSchema } from './schema.js'
import type {
  ExtensionRuntimeRegisterContributionResult,
  ExtensionRuntimeUnregisterContributionResult,
} from './runtime-types.js'
import type {
  ExtensionStorageDeleteResult,
  ExtensionStorageGetResult,
  ExtensionStorageListResult,
  ExtensionStorageSetResult,
} from './storage-types.js'
import type {
  ExtensionCapabilityAuditEntry,
  ExtensionInvokeFailure,
  ExtensionInvokeResult,
} from './types.js'

export function invalidOperationResult(input: {
  readonly audit: ExtensionCapabilityAuditEntry
  readonly issues: readonly string[]
  readonly message: string
}): ExtensionInvokeFailure {
  return {
    ok: false,
    error: {
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
      message: input.message,
      issues: [...input.issues],
    },
    audit: input.audit,
  }
}

/**
 * The broker's result for one operation, decoded with the operation's result schema. A result that
 * does not decode becomes an invalid-payload failure whose issues name the fields that failed.
 */
export function toDecodedOperationResult<TValue, TEncoded>(
  result: ExtensionInvokeResult,
  schema: Schema.Schema<TValue, TEncoded>,
  message: string,
): ExtensionInvokeResult<TValue> {
  if (!result.ok) {
    return result
  }

  const decoded = safeDecodeExtensionSchema(schema, result.value)
  return decoded.success
    ? { ok: true, value: decoded.data, audit: result.audit }
    : invalidOperationResult({ audit: result.audit, issues: decoded.issues, message })
}

const nonEmptyString = Schema.String.pipe(
  Schema.filter((value) => value.trim().length > 0 || 'Must not be empty.'),
)

const storageScopeSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal(OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND) }),
  Schema.Struct({
    kind: Schema.Literal(OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND),
    projectPath: nonEmptyString,
  }),
)

const storageKeySchema = nonEmptyString.pipe(
  Schema.filter((value) => value === value.trim() || 'Must not start or end with whitespace.'),
  Schema.maxLength(OPENWAGGLE_EXTENSION.STORAGE.KEY_MAX_LENGTH),
)

const storageResultBase = {
  extensionId: nonEmptyString,
  contributionId: nonEmptyString,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE),
  storageKind: Schema.Literal(
    OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE,
    OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG,
  ),
  storageScope: storageScopeSchema,
}

export const storageGetResultSchema: Schema.Schema<ExtensionStorageGetResult> = Schema.Struct({
  ...storageResultBase,
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.GET),
  key: storageKeySchema,
  value: Schema.NullOr(jsonValueSchema),
})

export const storageSetResultSchema: Schema.Schema<ExtensionStorageSetResult> = Schema.Struct({
  ...storageResultBase,
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.SET),
  key: storageKeySchema,
  value: jsonValueSchema,
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
})

export const storageDeleteResultSchema: Schema.Schema<ExtensionStorageDeleteResult> = Schema.Struct(
  {
    ...storageResultBase,
    method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE),
    key: storageKeySchema,
    deleted: Schema.Literal(true),
  },
)

export const storageListResultSchema: Schema.Schema<ExtensionStorageListResult> = Schema.Struct({
  ...storageResultBase,
  method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST),
  keys: Schema.Array(storageKeySchema),
})

const runtimeContributionResultBase = {
  extensionId: nonEmptyString,
  contributionId: nonEmptyString,
  capability: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME),
  family: Schema.Literal(...OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILIES),
}

export const runtimeRegisterContributionResultSchema: Schema.Schema<ExtensionRuntimeRegisterContributionResult> =
  Schema.Struct({
    ...runtimeContributionResultBase,
    method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION),
    registeredContributionId: nonEmptyString,
  })

export const runtimeUnregisterContributionResultSchema: Schema.Schema<ExtensionRuntimeUnregisterContributionResult> =
  Schema.Struct({
    ...runtimeContributionResultBase,
    method: Schema.Literal(OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION),
    unregisteredContributionId: nonEmptyString,
    unregistered: Schema.Boolean,
  })
