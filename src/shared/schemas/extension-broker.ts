// The broker contract is the extension SDK's: the host builds its results from the schemas the
// SDK's broker client decodes them with, and decodes their payloads with the same schemas. The
// schemas are internal to the SDK (ADR 0066), so the host imports them from its source modules.
export * from './extension-broker-core'
export * from './extension-broker-openwaggle'
export * from './extension-broker-resources'
export {
  extensionBrokerMethodSchema,
  extensionCapabilityAuditEntrySchema,
  extensionInvocationBindingSchema,
  extensionInvokeFailureCodeSchema,
  extensionInvokeInputSchema,
  extensionInvokeOutcomeSchema,
} from '@openwaggle/extension-sdk/internal/broker-schemas-core'
export {
  extensionInvokeFailureSchema,
  extensionInvokeDeclaredResultSchema,
  extensionInvokeSuccessValueSchema,
} from '@openwaggle/extension-sdk/internal/broker-schemas-result'
export {
  extensionRuntimeRegisterContributionPayloadSchema,
  extensionRuntimeUnregisterContributionPayloadSchema,
  extensionStorageDeletePayloadSchema,
  extensionStorageGetPayloadSchema,
  extensionStorageKindSchema,
  extensionStorageListPayloadSchema,
  extensionStorageScopeSchema,
  extensionStorageScopeSelectorSchema,
  extensionStorageSetPayloadSchema,
} from '@openwaggle/extension-sdk/internal/broker-schemas-storage'
