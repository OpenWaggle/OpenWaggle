import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type { ExtensionOperationSuccess } from '@shared/extension-sdk-core'
import { invalidOperationResult } from '@shared/extension-sdk-core'
import type {
  ExtensionActionSelectProjectResult,
  ExtensionInvokeFailure,
  ExtensionInvokeResult,
  ExtensionSettingsGetResult,
  ExtensionSettingsUpdateResult,
  ExtensionStateReadResult,
  ExtensionStorageDeleteResult,
  ExtensionStorageGetResult,
  ExtensionStorageListResult,
  ExtensionStorageSetResult,
} from '@shared/types/extension-broker'
import { isRecord } from '@shared/utils/validation'
import { isJsonValue, stringArray } from './extension-frame-bootstrap-json'

function hasBrokerValueBase(value: unknown, capability: string, method: string) {
  return (
    isRecord(value) &&
    typeof value.extensionId === 'string' &&
    typeof value.contributionId === 'string' &&
    value.capability === capability &&
    value.method === method
  )
}

function isAudit(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.extensionId === 'string' &&
    typeof value.contributionId === 'string' &&
    typeof value.capability === 'string' &&
    typeof value.method === 'string' &&
    isRecord(value.scope) &&
    typeof value.outcome === 'string' &&
    typeof value.timestamp === 'number' &&
    (value.failureCode === undefined || typeof value.failureCode === 'string')
  )
}

function isInvokeFailure(value: unknown): value is ExtensionInvokeFailure {
  if (!isRecord(value) || value.ok !== false || !isRecord(value.error)) {
    return false
  }

  return (
    typeof value.error.code === 'string' &&
    typeof value.error.message === 'string' &&
    (value.error.issues === undefined || stringArray(value.error.issues)) &&
    (value.audit === undefined || isAudit(value.audit))
  )
}

export function isInvokeResult(value: unknown): value is ExtensionInvokeResult {
  if (isInvokeFailure(value)) {
    return true
  }

  return isRecord(value) && value.ok === true && isAudit(value.audit) && isRecord(value.value)
}

export function isStorageGetResult(value: unknown): value is ExtensionStorageGetResult {
  return (
    hasBrokerValueBase(
      value,
      OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
      OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
    ) &&
    isRecord(value) &&
    typeof value.storageKind === 'string' &&
    isRecord(value.storageScope) &&
    typeof value.key === 'string' &&
    isJsonValue(value.value)
  )
}

export function isStorageSetResult(value: unknown): value is ExtensionStorageSetResult {
  return (
    hasBrokerValueBase(
      value,
      OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
      OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
    ) &&
    isRecord(value) &&
    typeof value.storageKind === 'string' &&
    isRecord(value.storageScope) &&
    typeof value.key === 'string' &&
    isJsonValue(value.value) &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number'
  )
}

export function isStorageDeleteResult(value: unknown): value is ExtensionStorageDeleteResult {
  return (
    hasBrokerValueBase(
      value,
      OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
      OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE,
    ) &&
    isRecord(value) &&
    typeof value.storageKind === 'string' &&
    isRecord(value.storageScope) &&
    typeof value.key === 'string' &&
    value.deleted === true
  )
}

export function isStorageListResult(value: unknown): value is ExtensionStorageListResult {
  return (
    hasBrokerValueBase(
      value,
      OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
      OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST,
    ) &&
    isRecord(value) &&
    typeof value.storageKind === 'string' &&
    isRecord(value.storageScope) &&
    stringArray(value.keys)
  )
}

export function isStateReadResult(value: unknown): value is ExtensionStateReadResult {
  return hasBrokerValueBase(
    value,
    OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE,
    OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE,
  )
}

export function isSelectProjectResult(value: unknown): value is ExtensionActionSelectProjectResult {
  return (
    hasBrokerValueBase(
      value,
      OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS,
      OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT,
    ) &&
    isRecord(value) &&
    typeof value.projectPath === 'string' &&
    stringArray(value.recentProjects)
  )
}

export function isSettingsGetResult(value: unknown): value is ExtensionSettingsGetResult {
  return (
    hasBrokerValueBase(
      value,
      OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
      OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS,
    ) &&
    isRecord(value) &&
    isRecord(value.settings)
  )
}

export function isSettingsUpdateResult(value: unknown): value is ExtensionSettingsUpdateResult {
  return (
    hasBrokerValueBase(
      value,
      OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS,
      OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS,
    ) &&
    isRecord(value) &&
    isRecord(value.settings)
  )
}

export function operationResult<TValue>(
  result: ExtensionInvokeResult,
  isValue: (value: unknown) => value is TValue,
  message: string,
): ExtensionOperationSuccess<TValue> | ExtensionInvokeFailure {
  if (!result.ok) {
    return result
  }

  return isValue(result.value)
    ? { ok: true, value: result.value, audit: result.audit }
    : invalidOperationResult({
        audit: result.audit,
        issues: ['Host returned a payload that does not match the expected extension SDK result.'],
        message,
      })
}
