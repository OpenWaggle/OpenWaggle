/**
 * Broker SDK factories for extension tests and standalone previews. Inside OpenWaggle the host
 * passes the broker SDK as `context.sdk`; build one here over a transport you control to test code
 * that takes it. This entry bundles the SDK's result decoders.
 */
export {
  createExtensionBrokerSdk,
  createExtensionBrokerSdkFromInvoke,
  toInvokeInput,
} from './internal/broker-sdk.js'
export { createRuntimeContributionSdk } from './internal/runtime-sdk.js'
export type {
  CreateOpenWaggleSdkOptions,
  ExtensionBrokerSdk,
  ExtensionBrokerTransport,
  ExtensionSdkIdentity,
  ExtensionSdkInvoke,
  ExtensionSdkInvokeRequest,
} from './sdk-types.js'
