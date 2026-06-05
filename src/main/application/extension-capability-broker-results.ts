import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionInvokeInput } from '@shared/types/extension-broker'
import type { ExtensionPackageScope } from '../extensions/types'
import { auditedFailure, auditedSuccess } from './extension-capability-broker-audit'
import { hostContextPayloadIsValid } from './extension-capability-broker-model'
import {
  routeActionCapability,
  routeSettingsCapability,
  routeStateCapability,
} from './extension-capability-broker-openwaggle'
import { routeStorageCapability } from './extension-capability-broker-storage-dispatch'

export function routeAuthorizedInvocation(input: {
  readonly invocation: ExtensionInvokeInput
  readonly packageScope: ExtensionPackageScope
  readonly declaredScopes: readonly (typeof OPENWAGGLE_EXTENSION.CAPABILITY_SCOPES)[number][]
  readonly timestamp: number
}) {
  if (input.invocation.capability === OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE) {
    return routeStorageCapability(input)
  }

  if (input.invocation.capability === OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE) {
    return routeStateCapability(input)
  }

  if (input.invocation.capability === OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS) {
    return routeActionCapability(input)
  }

  if (input.invocation.capability === OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS) {
    return routeSettingsCapability(input)
  }

  if (input.invocation.capability !== OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT) {
    return auditedFailure({
      invocation: input.invocation,
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNSUPPORTED_CAPABILITY,
      message: `Capability "${input.invocation.capability}" is not implemented by the broker foundation.`,
      timestamp: input.timestamp,
    })
  }

  if (input.invocation.method !== OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE) {
    return auditedFailure({
      invocation: input.invocation,
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNSUPPORTED_METHOD,
      message: `Method "${input.invocation.method}" is not implemented for capability "${input.invocation.capability}".`,
      timestamp: input.timestamp,
    })
  }

  if (!hostContextPayloadIsValid(input.invocation.payload)) {
    return auditedFailure({
      invocation: input.invocation,
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
      message: 'The host context capability expects an empty object payload.',
      timestamp: input.timestamp,
    })
  }

  return auditedSuccess({
    invocation: input.invocation,
    timestamp: input.timestamp,
    value: {
      extensionId: input.invocation.extensionId,
      contributionId: input.invocation.contributionId,
      capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
      method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
      scope: input.invocation.scope,
      declaredScopes: input.declaredScopes,
    },
  })
}
