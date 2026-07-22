import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type {
  ExtensionCapabilityAuditEntry,
  ExtensionInvokeFailure,
  ExtensionInvokeInput,
  ExtensionInvokeResult,
  ExtensionInvokeScope,
} from '@shared/types/extension-broker'

export interface ExtensionSdkIdentity {
  readonly extensionId: string
  readonly contributionId: string
}

export interface ExtensionSdkInvokeRequest {
  readonly capability: string
  readonly method: string
  readonly scope: ExtensionInvokeScope
  readonly payload?: unknown
}

export type ExtensionBrokerTransport = (
  input: ExtensionInvokeInput,
) => Promise<ExtensionInvokeResult>

export type ExtensionSdkInvoke = (
  request: ExtensionSdkInvokeRequest,
) => Promise<ExtensionInvokeResult>

export interface ExtensionOperationSuccess<TValue> {
  readonly ok: true
  readonly value: TValue
  readonly audit: ExtensionCapabilityAuditEntry
}

export function toInvokeInput(
  identity: ExtensionSdkIdentity,
  request: ExtensionSdkInvokeRequest,
): ExtensionInvokeInput {
  return {
    extensionId: identity.extensionId,
    contributionId: identity.contributionId,
    capability: request.capability,
    method: request.method,
    scope: request.scope,
    ...(request.payload !== undefined ? { payload: request.payload } : {}),
  }
}

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
