import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import { isExtensionRuntimeEnabled } from '../extensions/runtime-eligibility'
import type { DiscoveredExtensionPackage } from '../extensions/types'
import { ExtensionLifecycleRepository } from '../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../ports/extension-project-overrides-repository'

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

export function listRuntimeEnabledOpenWaggleExtensionPackagePaths(projectPath: string) {
  return Effect.gen(function* () {
    const manager = yield* ExtensionManagerService
    const lifecycleRepository = yield* ExtensionLifecycleRepository
    const projectOverridesRepository = yield* ExtensionProjectOverridesRepository
    const packages = yield* manager.listPackages({ projectPath })
    const enabledPackagePaths = yield* Effect.forEach(
      packages.filter((extensionPackage) => isRuntimeCandidate(extensionPackage, projectPath)),
      (extensionPackage) =>
        Effect.gen(function* () {
          const lifecycle = yield* lifecycleRepository.get({
            extensionId: extensionPackage.id,
            scope: extensionPackage.scope,
          })
          const projectOverride = yield* projectOverridesRepository.get({
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
