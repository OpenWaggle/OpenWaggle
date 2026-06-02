import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import { isExtensionRuntimeEnabled } from '../../extensions/runtime-eligibility'
import type { DiscoveredExtensionPackage } from '../../extensions/types'
import type { ExtensionLifecycleRepositoryShape } from '../../ports/extension-lifecycle-repository'
import type { ExtensionManagerServiceShape } from '../../ports/extension-manager-service'
import type { ExtensionProjectOverridesRepositoryShape } from '../../ports/extension-project-overrides-repository'

export interface OpenWagglePiExtensionSelectionServices {
  readonly manager: ExtensionManagerServiceShape
  readonly lifecycleRepository: ExtensionLifecycleRepositoryShape
  readonly projectOverridesRepository: ExtensionProjectOverridesRepositoryShape
}

function isProjectPackage(extensionPackage: DiscoveredExtensionPackage, projectPath: string) {
  return (
    extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND &&
    extensionPackage.scope.projectPath === projectPath
  )
}

function isRuntimeCandidate(extensionPackage: DiscoveredExtensionPackage, projectPath: string) {
  return (
    extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND ||
    isProjectPackage(extensionPackage, projectPath)
  )
}

function present<T>(value: T | null): value is T {
  return value !== null
}

export function listRuntimeEnabledOpenWaggleExtensionPackagePathsFromServices(
  projectPath: string,
  services: OpenWagglePiExtensionSelectionServices,
) {
  return Effect.gen(function* () {
    const packages = yield* services.manager.listPackages({ projectPath })
    const enabledPackagePaths = yield* Effect.forEach(
      packages.filter((extensionPackage) => isRuntimeCandidate(extensionPackage, projectPath)),
      (extensionPackage) =>
        Effect.gen(function* () {
          const lifecycle = yield* services.lifecycleRepository.get({
            extensionId: extensionPackage.id,
            scope: extensionPackage.scope,
          })
          const projectOverride = yield* services.projectOverridesRepository.get({
            extensionId: extensionPackage.id,
            scope: extensionPackage.scope,
            projectPath,
          })

          return isExtensionRuntimeEnabled({ extensionPackage, lifecycle, projectOverride })
            ? extensionPackage.packagePath
            : null
        }),
    )

    return enabledPackagePaths.filter(present)
  })
}
