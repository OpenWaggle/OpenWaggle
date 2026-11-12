import { OPENWAGGLE_EXTENSION, OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import { isJsonValue, isNonEmptyString, isRecord, isStringArray } from './internal-validation.js'
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

type OperationResultGuard<TValue> = (value: unknown) => value is TValue

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

export function toDecodedOperationResult<TValue>(
  result: ExtensionInvokeResult,
  guard: OperationResultGuard<TValue>,
  message: string,
): ExtensionInvokeResult<TValue> {
  if (!result.ok) {
    return result
  }

  return guard(result.value)
    ? { ok: true, value: result.value, audit: result.audit }
    : invalidOperationResult({
        audit: result.audit,
        issues: ['Broker response payload did not match the expected operation result.'],
        message,
      })
}

function isKnownString<TValue extends string>(
  values: readonly TValue[],
  value: unknown,
): value is TValue {
  return typeof value === 'string' && values.some((candidate) => candidate === value)
}

function isStorageScope(value: unknown) {
  if (!isRecord(value)) {
    return false
  }

  if (value.kind === OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND) {
    return true
  }

  return (
    value.kind === OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND &&
    isNonEmptyString(value.projectPath)
  )
}

function isStorageKey(value: unknown) {
  return (
    isNonEmptyString(value) &&
    value === value.trim() &&
    value.length <= OPENWAGGLE_EXTENSION.STORAGE.KEY_MAX_LENGTH
  )
}

function hasStorageResultBase(value: Readonly<Record<string, unknown>>) {
  return (
    isNonEmptyString(value.extensionId) &&
    isNonEmptyString(value.contributionId) &&
    value.capability === OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE &&
    isKnownString(OPENWAGGLE_EXTENSION.STORAGE.KINDS, value.storageKind) &&
    isStorageScope(value.storageScope)
  )
}

export function isStorageGetResult(value: unknown): value is ExtensionStorageGetResult {
  return (
    isRecord(value) &&
    hasStorageResultBase(value) &&
    value.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.GET &&
    isStorageKey(value.key) &&
    (value.value === null || isJsonValue(value.value))
  )
}

export function isStorageSetResult(value: unknown): value is ExtensionStorageSetResult {
  return (
    isRecord(value) &&
    hasStorageResultBase(value) &&
    value.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.SET &&
    isStorageKey(value.key) &&
    isJsonValue(value.value) &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number'
  )
}

export function isStorageDeleteResult(value: unknown): value is ExtensionStorageDeleteResult {
  return (
    isRecord(value) &&
    hasStorageResultBase(value) &&
    value.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE &&
    isStorageKey(value.key) &&
    value.deleted === true
  )
}

export function isStorageListResult(value: unknown): value is ExtensionStorageListResult {
  return (
    isRecord(value) &&
    hasStorageResultBase(value) &&
    value.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST &&
    isStringArray(value.keys) &&
    value.keys.every(isStorageKey)
  )
}

function hasRuntimeContributionResultBase(value: Readonly<Record<string, unknown>>) {
  return (
    isNonEmptyString(value.extensionId) &&
    isNonEmptyString(value.contributionId) &&
    value.capability === OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME &&
    isKnownString(OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILIES, value.family)
  )
}

export function isRuntimeRegisterContributionResult(
  value: unknown,
): value is ExtensionRuntimeRegisterContributionResult {
  return (
    isRecord(value) &&
    hasRuntimeContributionResultBase(value) &&
    value.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION &&
    isNonEmptyString(value.registeredContributionId)
  )
}

export function isRuntimeUnregisterContributionResult(
  value: unknown,
): value is ExtensionRuntimeUnregisterContributionResult {
  return (
    isRecord(value) &&
    hasRuntimeContributionResultBase(value) &&
    value.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION &&
    isNonEmptyString(value.unregisteredContributionId) &&
    typeof value.unregistered === 'boolean'
  )
}
