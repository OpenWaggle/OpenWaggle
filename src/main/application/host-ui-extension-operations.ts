import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { Schema, safeDecodeUnknown } from '@shared/schema'
import { extensionInvokeInputSchema } from '@shared/schemas/extension-broker'
import type { ExtensionInvokeFailure } from '@shared/types/extension-broker'
import type { ExtensionListContributionsInput } from '@shared/types/extensions'
import * as Effect from 'effect/Effect'
import { invokeExtensionCapability } from './extension-capability-broker-service'
import { listExtensionContributionRegistryView } from './extension-contribution-registry-service'
import {
  acceptExtensionUpdate,
  approveExtensionBuild,
  reloadExtension,
  setExtensionEnabled,
  setExtensionProjectDisabled,
  setExtensionTrusted,
} from './extension-lifecycle-service'
import { listExtensionPackagesView } from './extension-manager-view-service'
import {
  createOrUpdateExtensionPackage,
  proposeExtensionPackageRemove,
  proposeExtensionPackageWrite,
  removeExtensionPackage,
} from './extension-package-workflow-service'
import { isExtensionRuntimeModuleAccessAllowed } from './extension-runtime-module-access-service'
import {
  decodeHostUiExtensionListContributionsInput,
  decodeHostUiExtensionListPackagesInput,
  normalizeHostUiExtensionAcceptUpdateInput,
  normalizeHostUiExtensionApplyPackageRemoveInput,
  normalizeHostUiExtensionApplyPackageWriteInput,
  normalizeHostUiExtensionApproveBuildInput,
  normalizeHostUiExtensionEnabledInput,
  normalizeHostUiExtensionProjectDisabledInput,
  normalizeHostUiExtensionProposePackageRemoveInput,
  normalizeHostUiExtensionProposePackageWriteInput,
  normalizeHostUiExtensionReloadInput,
  normalizeHostUiExtensionTrustedInput,
} from './host-ui-extension-input'

export function listHostUiExtensionPackages(input?: unknown) {
  return Effect.gen(function* () {
    const decoded = yield* decodeHostUiExtensionListPackagesInput(input)
    return yield* listExtensionPackagesView(decoded)
  })
}

export function listHostUiExtensionContributionsWith<A, E, R>(
  input: unknown,
  listContributions: (input: ExtensionListContributionsInput) => Effect.Effect<A, E, R>,
) {
  return Effect.gen(function* () {
    const decoded = yield* decodeHostUiExtensionListContributionsInput(input)
    return yield* listContributions(decoded)
  })
}

export function listHostUiExtensionContributions(input?: unknown) {
  return listHostUiExtensionContributionsWith(input, listExtensionContributionRegistryView)
}

const runtimeModuleAccessSchema = Schema.Struct({
  packagePath: Schema.String.pipe(Schema.minLength(1)),
  contentHash: Schema.String.pipe(Schema.minLength(1)),
  projectPaths: Schema.Array(Schema.String.pipe(Schema.minLength(1))),
  sessionId: Schema.optional(Schema.String.pipe(Schema.minLength(1))),
})

export function authorizeHostUiExtensionRuntimeModule(input: unknown) {
  const decoded = safeDecodeUnknown(runtimeModuleAccessSchema, input)
  return decoded.success
    ? isExtensionRuntimeModuleAccessAllowed(decoded.data)
    : Effect.fail(new Error(`Invalid runtime module authorization: ${decoded.issues.join('; ')}`))
}

export function proposeHostUiExtensionPackageWrite(input: unknown) {
  return Effect.gen(function* () {
    const normalized = yield* normalizeHostUiExtensionProposePackageWriteInput(input)
    return yield* proposeExtensionPackageWrite(normalized)
  })
}

export function applyHostUiExtensionPackageWrite(input: unknown) {
  return Effect.gen(function* () {
    const normalized = yield* normalizeHostUiExtensionApplyPackageWriteInput(input)
    return yield* createOrUpdateExtensionPackage(normalized)
  })
}

export function proposeHostUiExtensionPackageRemove(input: unknown) {
  return Effect.gen(function* () {
    const normalized = yield* normalizeHostUiExtensionProposePackageRemoveInput(input)
    return yield* proposeExtensionPackageRemove(normalized)
  })
}

export function applyHostUiExtensionPackageRemove(input: unknown) {
  return Effect.gen(function* () {
    const normalized = yield* normalizeHostUiExtensionApplyPackageRemoveInput(input)
    return yield* removeExtensionPackage(normalized)
  })
}

export function setHostUiExtensionTrusted(input: unknown) {
  return Effect.gen(function* () {
    const normalized = yield* normalizeHostUiExtensionTrustedInput(input)
    return yield* setExtensionTrusted(normalized)
  })
}

export function setHostUiExtensionEnabled(input: unknown) {
  return Effect.gen(function* () {
    const normalized = yield* normalizeHostUiExtensionEnabledInput(input)
    return yield* setExtensionEnabled(normalized)
  })
}

export function setHostUiExtensionProjectDisabled(input: unknown) {
  return Effect.gen(function* () {
    const normalized = yield* normalizeHostUiExtensionProjectDisabledInput(input)
    return yield* setExtensionProjectDisabled(normalized)
  })
}

export function acceptHostUiExtensionUpdate(input: unknown) {
  return Effect.gen(function* () {
    const normalized = yield* normalizeHostUiExtensionAcceptUpdateInput(input)
    return yield* acceptExtensionUpdate(normalized)
  })
}

export function approveHostUiExtensionBuild(input: unknown) {
  return Effect.gen(function* () {
    const normalized = yield* normalizeHostUiExtensionApproveBuildInput(input)
    return yield* approveExtensionBuild(normalized)
  })
}

export function reloadHostUiExtension(input: unknown) {
  return Effect.gen(function* () {
    const normalized = yield* normalizeHostUiExtensionReloadInput(input)
    return yield* reloadExtension(normalized)
  })
}

function invalidInvokeInput(issues: readonly string[]): ExtensionInvokeFailure {
  return {
    ok: false,
    error: {
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_INPUT,
      message: 'Invalid extension capability invocation.',
      issues,
    },
  }
}

export function invokeHostUiExtension(input: unknown) {
  const decoded = safeDecodeUnknown(extensionInvokeInputSchema, input)
  return decoded.success
    ? invokeExtensionCapability(decoded.data)
    : Effect.succeed(invalidInvokeInput(decoded.issues))
}
