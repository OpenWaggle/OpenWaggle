import type {
  ExtensionContributionRegistryView,
  ExtensionListContributionsInput,
} from '@shared/types/extensions'
import type { Effect as EffectType } from 'effect/Effect'
import * as Effect from 'effect/Effect'
import { listExtensionContributionRegistryView } from '../application/extension-contribution-registry-service'
import {
  acceptExtensionUpdate,
  approveExtensionBuild,
  reloadExtension,
  setExtensionEnabled,
  setExtensionProjectDisabled,
  setExtensionTrusted,
} from '../application/extension-lifecycle-service'
import { listExtensionPackagesView } from '../application/extension-manager-view-service'
import {
  createOrUpdateExtensionPackage,
  proposeExtensionPackageRemove,
  proposeExtensionPackageWrite,
  removeExtensionPackage,
} from '../application/extension-package-workflow-service'
import type { AppServices } from '../runtime'
import {
  decodeListContributionsInput,
  decodeListPackagesInput,
  normalizeAcceptUpdateInput,
  normalizeApplyPackageRemoveInput,
  normalizeApplyPackageWriteInput,
  normalizeApproveBuildInput,
  normalizeEnabledInput,
  normalizeProjectDisabledInput,
  normalizeProposePackageRemoveInput,
  normalizeProposePackageWriteInput,
  normalizeReloadInput,
  normalizeTrustedInput,
} from './extensions-handler-input'
import { typedHandle } from './typed-ipc'

export interface RegisterExtensionsHandlersDependencies {
  readonly listExtensionContributionsView?: (
    input: ExtensionListContributionsInput,
  ) => EffectType<ExtensionContributionRegistryView, unknown, AppServices>
}

export function registerExtensionsHandlers(
  dependencies: RegisterExtensionsHandlersDependencies = {},
): void {
  const listExtensionContributionsView =
    dependencies.listExtensionContributionsView ?? listExtensionContributionRegistryView

  typedHandle('extensions:list-packages', (_event, input?: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeListPackagesInput(input)
      return yield* listExtensionPackagesView(decoded)
    }),
  )

  typedHandle('extensions:list-contributions', (_event, input?: unknown) =>
    Effect.gen(function* () {
      const decoded = yield* decodeListContributionsInput(input)
      return yield* listExtensionContributionsView(decoded)
    }),
  )

  typedHandle('extensions:propose-package-write', (_event, input: unknown) =>
    Effect.gen(function* () {
      const normalizedInput = yield* normalizeProposePackageWriteInput(input)
      return yield* proposeExtensionPackageWrite(normalizedInput)
    }),
  )

  typedHandle('extensions:apply-package-write', (_event, input: unknown) =>
    Effect.gen(function* () {
      const normalizedInput = yield* normalizeApplyPackageWriteInput(input)
      return yield* createOrUpdateExtensionPackage(normalizedInput)
    }),
  )

  typedHandle('extensions:propose-package-remove', (_event, input: unknown) =>
    Effect.gen(function* () {
      const normalizedInput = yield* normalizeProposePackageRemoveInput(input)
      return yield* proposeExtensionPackageRemove(normalizedInput)
    }),
  )

  typedHandle('extensions:apply-package-remove', (_event, input: unknown) =>
    Effect.gen(function* () {
      const normalizedInput = yield* normalizeApplyPackageRemoveInput(input)
      return yield* removeExtensionPackage(normalizedInput)
    }),
  )

  typedHandle('extensions:set-trusted', (_event, input: unknown) =>
    Effect.gen(function* () {
      const normalizedInput = yield* normalizeTrustedInput(input)
      return yield* setExtensionTrusted(normalizedInput)
    }),
  )

  typedHandle('extensions:set-enabled', (_event, input: unknown) =>
    Effect.gen(function* () {
      const normalizedInput = yield* normalizeEnabledInput(input)
      return yield* setExtensionEnabled(normalizedInput)
    }),
  )

  typedHandle('extensions:set-project-disabled', (_event, input: unknown) =>
    Effect.gen(function* () {
      const normalizedInput = yield* normalizeProjectDisabledInput(input)
      return yield* setExtensionProjectDisabled(normalizedInput)
    }),
  )

  typedHandle('extensions:accept-update', (_event, input: unknown) =>
    Effect.gen(function* () {
      const normalizedInput = yield* normalizeAcceptUpdateInput(input)
      return yield* acceptExtensionUpdate(normalizedInput)
    }),
  )

  typedHandle('extensions:approve-build', (_event, input: unknown) =>
    Effect.gen(function* () {
      const normalizedInput = yield* normalizeApproveBuildInput(input)
      return yield* approveExtensionBuild(normalizedInput)
    }),
  )

  typedHandle('extensions:reload', (_event, input: unknown) =>
    Effect.gen(function* () {
      const normalizedInput = yield* normalizeReloadInput(input)
      return yield* reloadExtension(normalizedInput)
    }),
  )
}
