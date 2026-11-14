import type {
  extensionCapabilityAuditEntrySchema,
  extensionInvokeErrorSchema,
  extensionInvokeInputSchema,
  extensionInvokeScopeSchema,
} from './broker-schemas-core.js'
import type {
  extensionInvokeFailureSchema,
  extensionInvokeSuccessSchema,
  extensionInvokeSuccessValueSchema,
} from './broker-schemas-result.js'
import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import type { SchemaType } from './schema.js'

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

export type ExtensionInvokeScope = SchemaType<typeof extensionInvokeScopeSchema>
export type ExtensionCapabilityAuditEntry = SchemaType<typeof extensionCapabilityAuditEntrySchema>
export type ExtensionInvokeInput = SchemaType<typeof extensionInvokeInputSchema>
export type ExtensionInvokeError = SchemaType<typeof extensionInvokeErrorSchema>
export type ExtensionInvokeFailure = SchemaType<typeof extensionInvokeFailureSchema>
/** Every result value the broker returns, one per capability method. */
export type ExtensionInvokeSuccessValue = SchemaType<typeof extensionInvokeSuccessValueSchema>

/**
 * A broker success whose value one operation's decoder has narrowed. It is the decoded success
 * (`extensionInvokeSuccessSchema`) with `value` replaced; the default is a value not decoded yet.
 */
export type ExtensionInvokeSuccess<TValue = unknown> = Omit<
  SchemaType<typeof extensionInvokeSuccessSchema>,
  'value'
> & { readonly value: TValue }

export type ExtensionInvokeResult<TValue = unknown> =
  | ExtensionInvokeSuccess<TValue>
  | ExtensionInvokeFailure
