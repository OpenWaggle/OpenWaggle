import type * as Schema from 'effect/Schema'
import { OPENWAGGLE_EXTENSION_BROKER } from '../constants.js'
import { formatValidationIssue, validateWithSchema } from './schema.js'
import type {
  ExtensionCapabilityAuditEntry,
  ExtensionInvokeFailure,
  ExtensionInvokeResult,
} from '../types.js'

export function invalidOperationResult(input: {
  readonly audit: ExtensionCapabilityAuditEntry
  readonly issues: readonly string[]
  readonly message: string
}) {
  const failure: ExtensionInvokeFailure = {
    ok: false,
    error: {
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
      message: input.message,
      issues: [...input.issues],
    },
    audit: input.audit,
  }
  return failure
}

/**
 * The broker's result for one operation, decoded with the operation's result schema. A result that
 * does not decode becomes an invalid-payload failure whose issues name the fields that failed.
 */
export function toDecodedOperationResult<TValue, TEncoded>(
  result: ExtensionInvokeResult,
  schema: Schema.Schema<TValue, TEncoded>,
  message: string,
) {
  if (!result.ok) {
    const returned: ExtensionInvokeResult<TValue> = result
    return returned
  }

  const decoded = validateWithSchema(schema, result.value)
  const returned: ExtensionInvokeResult<TValue> = decoded.success
    ? { ok: true, value: decoded.value, audit: result.audit }
    : invalidOperationResult({
        audit: result.audit,
        issues: decoded.issues.map(formatValidationIssue),
        message,
      })
  return returned
}

export {
  extensionRuntimeRegisterContributionResultSchema as runtimeRegisterContributionResultSchema,
  extensionRuntimeUnregisterContributionResultSchema as runtimeUnregisterContributionResultSchema,
  extensionStorageDeleteResultSchema as storageDeleteResultSchema,
  extensionStorageGetResultSchema as storageGetResultSchema,
  extensionStorageListResultSchema as storageListResultSchema,
  extensionStorageSetResultSchema as storageSetResultSchema,
} from './broker-schemas-storage.js'
