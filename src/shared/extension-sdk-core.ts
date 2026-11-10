import type {
  ExtensionInvokeInput,
  ExtensionInvokeResult,
  ExtensionInvokeScope,
} from '@shared/types/extension-broker'

export interface ExtensionSdkInvokeRequest {
  readonly capability: string
  readonly method: string
  readonly scope: ExtensionInvokeScope
  readonly payload?: unknown
}

export type ExtensionBrokerTransport = (
  input: ExtensionInvokeInput,
) => Promise<ExtensionInvokeResult>
