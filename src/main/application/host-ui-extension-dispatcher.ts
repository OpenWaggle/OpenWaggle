import { match } from '@diegogbrisa/ts-match'
import type { HostBackedGuiChannel } from '@shared/types/host-ui-protocol'
import * as Effect from 'effect/Effect'
import {
  acceptHostUiExtensionUpdate,
  applyHostUiExtensionPackageRemove,
  applyHostUiExtensionPackageWrite,
  approveHostUiExtensionBuild,
  authorizeHostUiExtensionRuntimeModule,
  invokeHostUiExtension,
  listHostUiExtensionContributions,
  listHostUiExtensionPackages,
  proposeHostUiExtensionPackageRemove,
  proposeHostUiExtensionPackageWrite,
  reloadHostUiExtension,
  setHostUiExtensionEnabled,
  setHostUiExtensionProjectDisabled,
  setHostUiExtensionTrusted,
} from './host-ui-extension-operations'
import { oneInput, requireHostUiArgCount, TWO_ARGUMENTS } from './host-ui-operation-validation'

export function dispatchHostUiExtensionOperation(
  channel: Extract<HostBackedGuiChannel, `extensions:${string}`>,
  args: readonly unknown[],
) {
  return match(channel)
    .with('extensions:list-packages', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, 0, 1)
        return yield* listHostUiExtensionPackages(args[0])
      }),
    )
    .with('extensions:list-contributions', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, 0, 1)
        return yield* listHostUiExtensionContributions(args[0])
      }),
    )
    .with('extensions:propose-package-write', () =>
      oneInput(args, proposeHostUiExtensionPackageWrite),
    )
    .with('extensions:apply-package-write', () => oneInput(args, applyHostUiExtensionPackageWrite))
    .with('extensions:propose-package-remove', () =>
      oneInput(args, proposeHostUiExtensionPackageRemove),
    )
    .with('extensions:apply-package-remove', () =>
      oneInput(args, applyHostUiExtensionPackageRemove),
    )
    .with('extensions:invoke', () =>
      Effect.gen(function* () {
        yield* requireHostUiArgCount(args, 1, TWO_ARGUMENTS)
        return yield* invokeHostUiExtension(args[0], args[1])
      }),
    )
    .with('extensions:set-trusted', () => oneInput(args, setHostUiExtensionTrusted))
    .with('extensions:set-enabled', () => oneInput(args, setHostUiExtensionEnabled))
    .with('extensions:set-project-disabled', () =>
      oneInput(args, setHostUiExtensionProjectDisabled),
    )
    .with('extensions:accept-update', () => oneInput(args, acceptHostUiExtensionUpdate))
    .with('extensions:approve-build', () => oneInput(args, approveHostUiExtensionBuild))
    .with('extensions:reload', () => oneInput(args, reloadHostUiExtension))
    .with('extensions:authorize-runtime-module', () =>
      oneInput(args, authorizeHostUiExtensionRuntimeModule),
    )
    .exhaustive()
}
