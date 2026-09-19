import type {
  ExtensionContributionRegistryView,
  ExtensionListContributionsInput,
} from '@shared/types/extensions'
import type { Effect as EffectType } from 'effect/Effect'
import {
  acceptHostUiExtensionUpdate,
  applyHostUiExtensionPackageRemove,
  applyHostUiExtensionPackageWrite,
  approveHostUiExtensionBuild,
  listHostUiExtensionContributions,
  listHostUiExtensionContributionsWith,
  listHostUiExtensionPackages,
  proposeHostUiExtensionPackageRemove,
  proposeHostUiExtensionPackageWrite,
  reloadHostUiExtension,
  setHostUiExtensionEnabled,
  setHostUiExtensionProjectDisabled,
  setHostUiExtensionTrusted,
} from '../application/host-ui-extension-operations'
import type { AppServices } from '../runtime'
import { hostHandle as typedHandle } from './typed-ipc'

export interface RegisterExtensionsHandlersDependencies {
  readonly listExtensionContributionsView?: (
    input: ExtensionListContributionsInput,
  ) => EffectType<ExtensionContributionRegistryView, unknown, AppServices>
}

export function registerExtensionsHandlers(
  dependencies: RegisterExtensionsHandlersDependencies = {},
): void {
  typedHandle('extensions:list-packages', (_event, input?: unknown) =>
    listHostUiExtensionPackages(input),
  )

  typedHandle('extensions:list-contributions', (_event, input?: unknown) =>
    dependencies.listExtensionContributionsView
      ? listHostUiExtensionContributionsWith(input, dependencies.listExtensionContributionsView)
      : listHostUiExtensionContributions(input),
  )

  typedHandle('extensions:propose-package-write', (_event, input: unknown) =>
    proposeHostUiExtensionPackageWrite(input),
  )

  typedHandle('extensions:apply-package-write', (_event, input: unknown) =>
    applyHostUiExtensionPackageWrite(input),
  )

  typedHandle('extensions:propose-package-remove', (_event, input: unknown) =>
    proposeHostUiExtensionPackageRemove(input),
  )

  typedHandle('extensions:apply-package-remove', (_event, input: unknown) =>
    applyHostUiExtensionPackageRemove(input),
  )

  typedHandle('extensions:set-trusted', (_event, input: unknown) =>
    setHostUiExtensionTrusted(input),
  )

  typedHandle('extensions:set-enabled', (_event, input: unknown) =>
    setHostUiExtensionEnabled(input),
  )

  typedHandle('extensions:set-project-disabled', (_event, input: unknown) =>
    setHostUiExtensionProjectDisabled(input),
  )

  typedHandle('extensions:accept-update', (_event, input: unknown) =>
    acceptHostUiExtensionUpdate(input),
  )

  typedHandle('extensions:approve-build', (_event, input: unknown) =>
    approveHostUiExtensionBuild(input),
  )

  typedHandle('extensions:reload', (_event, input: unknown) => reloadHostUiExtension(input))
}
