import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import type { ExtensionCapabilityAuditEntry, ExtensionInvokeFailure } from './generated/broker.js'

export type {
  ExtensionCapabilityAuditEntry,
  ExtensionHostContextResult,
  ExtensionInvokeError,
  ExtensionInvokeFailure,
  ExtensionInvokeFailureCode,
  ExtensionInvokeInput,
  ExtensionInvokeOutcome,
  ExtensionInvokeScope,
} from './generated/broker.js'
export type { ExtensionInvokeSuccessValue } from './generated/broker-result.js'

type ConstantValue<TObject> = TObject[keyof TObject]

export type ExtensionBrokerCapability = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY>
export type ExtensionBrokerMethod = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.METHOD>
export type ExtensionStateSelector = ConstantValue<
  typeof OPENWAGGLE_EXTENSION_BROKER.STATE_SELECTOR
>
export type ExtensionSettingsKey = ConstantValue<typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY>

/**
 * A broker success whose value one operation's decoder has narrowed. The default is a value not
 * decoded yet.
 */
export interface ExtensionInvokeSuccess<TValue = unknown> {
  readonly ok: true
  readonly value: TValue
  readonly audit: ExtensionCapabilityAuditEntry
}

export type ExtensionInvokeResult<TValue = unknown> =
  | ExtensionInvokeSuccess<TValue>
  | ExtensionInvokeFailure
