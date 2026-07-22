import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import { isExtensionRuntimeEnabled } from '../extensions/runtime-eligibility'
import type { DiscoveredExtensionPackage } from '../extensions/types'
import {
  ExtensionLifecycleRepository,
  type ExtensionLifecycleRepositoryShape,
} from '../ports/extension-lifecycle-repository'
import {
  ExtensionManagerService,
  type ExtensionManagerServiceShape,
} from '../ports/extension-manager-service'
import {
  ExtensionProjectOverridesRepository,
  type ExtensionProjectOverridesRepositoryShape,
} from '../ports/extension-project-overrides-repository'

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

function listPackagesSafely(manager: ExtensionManagerServiceShape, projectPath: string) {
  return manager.listPackages({ projectPath }).pipe(Effect.catchAll(() => Effect.succeed([])))
}

function packageRuntimeEnabledSafely(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly projectPath: string
  readonly lifecycleRepository: ExtensionLifecycleRepositoryShape
  readonly projectOverridesRepository: ExtensionProjectOverridesRepositoryShape
}) {
  return Effect.gen(function* () {
    const lifecycle = yield* input.lifecycleRepository
      .get({
        extensionId: input.extensionPackage.id,
        scope: input.extensionPackage.scope,
      })
      .pipe(Effect.catchAll(() => Effect.succeed(null)))
    const projectOverride = yield* input.projectOverridesRepository
      .get({
        extensionId: input.extensionPackage.id,
        scope: input.extensionPackage.scope,
        projectPath: input.projectPath,
      })
      .pipe(Effect.catchAll(() => Effect.succeed({ disabled: true })))

    return isExtensionRuntimeEnabled({
      extensionPackage: input.extensionPackage,
      lifecycle,
      projectOverride,
    })
  })
}

export function listRuntimeEnabledOpenWaggleExtensionPackagePaths(projectPath: string) {
  return Effect.gen(function* () {
    const manager = yield* ExtensionManagerService
    const lifecycleRepository = yield* ExtensionLifecycleRepository
    const projectOverridesRepository = yield* ExtensionProjectOverridesRepository
    const packages = yield* listPackagesSafely(manager, projectPath)
    const enabledPackagePaths = yield* Effect.forEach(
      packages.filter((extensionPackage) => isRuntimeCandidate(extensionPackage, projectPath)),
      (extensionPackage) =>
        Effect.gen(function* () {
          const runtimeEnabled = yield* packageRuntimeEnabledSafely({
            extensionPackage,
            projectPath,
            lifecycleRepository,
            projectOverridesRepository,
          })
          return runtimeEnabled ? extensionPackage.packagePath : null
        }),
    )

    return enabledPackagePaths.filter(present)
  })
}
