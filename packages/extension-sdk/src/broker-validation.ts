import type * as Schema from 'effect/Schema'
import { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import { safeDecodeExtensionSchema } from './schema.js'
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

export {
  extensionRuntimeRegisterContributionResultSchema as runtimeRegisterContributionResultSchema,
  extensionRuntimeUnregisterContributionResultSchema as runtimeUnregisterContributionResultSchema,
  extensionStorageDeleteResultSchema as storageDeleteResultSchema,
  extensionStorageGetResultSchema as storageGetResultSchema,
  extensionStorageListResultSchema as storageListResultSchema,
  extensionStorageSetResultSchema as storageSetResultSchema,
} from './broker-schemas-storage.js'
