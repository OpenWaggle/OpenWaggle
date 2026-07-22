import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { safeDecodeUnknown } from '@shared/schema'
import {
  extensionStorageDeletePayloadSchema,
  extensionStorageGetPayloadSchema,
  extensionStorageListPayloadSchema,
  extensionStorageSetPayloadSchema,
} from '@shared/schemas/extension-broker'
import type { ExtensionInvokeInput } from '@shared/types/extension-broker'
import type { ExtensionPackageScope } from '../extensions/types'
import { auditedFailure } from './extension-capability-broker-audit'
import {
  routeStorageDelete,
  routeStorageGet,
  routeStorageList,
  routeStorageSet,
} from './extension-capability-broker-storage-results'

interface StorageRouteInput {
  readonly invocation: ExtensionInvokeInput
  readonly packageScope: ExtensionPackageScope
  readonly timestamp: number
}

function invalidStoragePayload(input: StorageRouteInput & { readonly issues: readonly string[] }) {
  return auditedFailure({
    invocation: input.invocation,
    code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
    message: 'Invalid extension storage payload.',
    issues: input.issues,
    timestamp: input.timestamp,
  })
}

export function routeStorageCapability(input: StorageRouteInput) {
  if (input.invocation.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.GET) {
    const decoded = safeDecodeUnknown(extensionStorageGetPayloadSchema, input.invocation.payload)
    return decoded.success
      ? routeStorageGet({ ...input, payload: decoded.data })
      : invalidStoragePayload({ ...input, issues: decoded.issues })
  }
  if (input.invocation.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.SET) {
    const decoded = safeDecodeUnknown(extensionStorageSetPayloadSchema, input.invocation.payload)
    return decoded.success
      ? routeStorageSet({ ...input, payload: decoded.data })
      : invalidStoragePayload({ ...input, issues: decoded.issues })
  }
  if (input.invocation.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE) {
    const decoded = safeDecodeUnknown(extensionStorageDeletePayloadSchema, input.invocation.payload)
    return decoded.success
      ? routeStorageDelete({ ...input, payload: decoded.data })
      : invalidStoragePayload({ ...input, issues: decoded.issues })
  }
  if (input.invocation.method === OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST) {
    const decoded = safeDecodeUnknown(extensionStorageListPayloadSchema, input.invocation.payload)
    return decoded.success
      ? routeStorageList({ ...input, payload: decoded.data })
      : invalidStoragePayload({ ...input, issues: decoded.issues })
  }

  return auditedFailure({
    invocation: input.invocation,
    code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNSUPPORTED_METHOD,
    message: `Method "${input.invocation.method}" is not implemented for capability "${input.invocation.capability}".`,
    timestamp: input.timestamp,
  })
}
