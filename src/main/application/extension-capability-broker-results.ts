import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionInvokeInput } from '@shared/types/extension-broker'
import type { DiscoveredExtensionPackage, ExtensionPackageScope } from '../extensions/types'
import { auditedFailure, auditedSuccess } from './extension-capability-broker-audit'
import { routeDocsCapability } from './extension-capability-broker-docs'
import { hostContextPayloadIsValid } from './extension-capability-broker-model'
import {
  routeActionCapability,
  routeSettingsCapability,
  routeStateCapability,
} from './extension-capability-broker-openwaggle'
import { routeRuntimeContributionCapability } from './extension-capability-broker-runtime'
import { routeStorageCapability } from './extension-capability-broker-storage-dispatch'
import {
  EXTENSION_PACKAGE_MUTATION_CAPABILITY_REJECTION,
  isExtensionPackageMutationCapability,
} from './extension-package-mutation-guard'

export function routeAuthorizedInvocation(input: {
  readonly invocation: ExtensionInvokeInput
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly packageScope: ExtensionPackageScope
  readonly declaredScopes: readonly (typeof OPENWAGGLE_EXTENSION.CAPABILITY_SCOPES)[number][]
  readonly timestamp: number
}) {
  if (isExtensionPackageMutationCapability(input.invocation.capability)) {
    return auditedFailure({
      invocation: input.invocation,
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.UNSUPPORTED_CAPABILITY,
      message: EXTENSION_PACKAGE_MUTATION_CAPABILITY_REJECTION,
      timestamp: input.timestamp,
    })
  }

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

  if (input.invocation.capability === OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS) {
    return routeDocsCapability(input)
  }

  if (input.invocation.capability === OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME) {
    return routeRuntimeContributionCapability(input)
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
