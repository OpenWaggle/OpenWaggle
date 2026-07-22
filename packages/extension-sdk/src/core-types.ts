import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'

type ConstantValue<TObject> = TObject[keyof TObject]

export type ExtensionBrokerCapability = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY>
export type ExtensionBrokerMethod = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.METHOD>
export type ExtensionInvokeFailureCode = ConstantValue<
  typeof OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE
>
export type ExtensionInvokeOutcome = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.OUTCOME>
export type ExtensionStateSelector = ConstantValue<
  typeof OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR
>
export type ExtensionSettingsKey = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY>

export type ExtensionInvokeScope =
  | { readonly kind: 'app' }
  | { readonly kind: 'project'; readonly projectPath: string }
  | { readonly kind: 'session'; readonly projectPath: string; readonly sessionId: string }
  | {
      readonly kind: 'branch'
      readonly projectPath: string
      readonly sessionId: string
      readonly branchId: string
    }

export interface ExtensionCapabilityAuditEntry {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: string
  readonly method: string
  readonly scope: ExtensionInvokeScope
  readonly outcome: ExtensionInvokeOutcome
  readonly timestamp: number
  readonly failureCode?: ExtensionInvokeFailureCode
}

export interface ExtensionInvokeInput {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: string
  readonly method: string
  readonly scope: ExtensionInvokeScope
  readonly payload?: unknown
}

export interface ExtensionInvokeError {
  readonly code: ExtensionInvokeFailureCode
  readonly message: string
  readonly issues?: readonly string[]
}

export interface ExtensionInvokeSuccess<TValue = unknown> {
  readonly ok: true
  readonly value: TValue
  readonly audit: ExtensionCapabilityAuditEntry
}

export interface ExtensionInvokeFailure {
  readonly ok: false
  readonly error: ExtensionInvokeError
  readonly audit?: ExtensionCapabilityAuditEntry
}

export type ExtensionInvokeResult<TValue = unknown> =
  | ExtensionInvokeSuccess<TValue>
  | ExtensionInvokeFailure
