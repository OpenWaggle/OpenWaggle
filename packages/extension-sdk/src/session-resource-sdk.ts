import { toDecodedOperationResult } from './broker-validation.js'
import { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import type { ExtensionOpenWaggleSessionResourcesSdk, ExtensionSdkInvoke } from './sdk-types.js'
import type {
  ExtensionSessionResourceListResult,
  ExtensionSessionResourcePublishResult,
} from './session-resource-types.js'
import {
  isSessionResourceListResult,
  isSessionResourcePublishResult,
} from './session-resource-validation.js'

const SESSION_RESOURCE_RESULT_ERROR =
  'Extension broker returned an invalid Session Resource result.'

export function createOpenWaggleSessionResourcesSdk(
  invoke: ExtensionSdkInvoke,
): ExtensionOpenWaggleSessionResourcesSdk {
  return {
    publish: async (scope, resource) =>
      toDecodedOperationResult<ExtensionSessionResourcePublishResult>(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SESSION_RESOURCES,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.PUBLISH_SESSION_RESOURCE,
          scope,
          payload: resource,
        }),
        (value): value is ExtensionSessionResourcePublishResult =>
          isSessionResourcePublishResult(value) && value.sessionId === scope.sessionId,
        SESSION_RESOURCE_RESULT_ERROR,
      ),
    list: async (scope, input = {}) =>
      toDecodedOperationResult<ExtensionSessionResourceListResult>(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SESSION_RESOURCES,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST_SESSION_RESOURCES,
          scope,
          payload: input,
        }),
        (value): value is ExtensionSessionResourceListResult =>
          isSessionResourceListResult(value) && value.sessionId === scope.sessionId,
        SESSION_RESOURCE_RESULT_ERROR,
      ),
  }
}
