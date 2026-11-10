import type {
  ExtensionCapabilityAuditEntry,
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
