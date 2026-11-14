// The broker's resources schemas are the extension SDK's internal ones: the host builds results
// from the schemas the SDK's broker client decodes them with.
export {
  extensionSessionResourcePublishPayloadSchema,
  extensionSessionResourceViewSchema,
  extensionSessionResourcesListPayloadSchema,
} from '@openwaggle/extension-sdk/internal/broker-schemas-resources'
