import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import { isExtensionRuntimeEnabled } from '../../extensions/runtime-eligibility'
import { applyRuntimeLoadFailureToLifecycle } from '../../extensions/runtime-load-failure'
import type { DiscoveredExtensionPackage, ExtensionLifecycleState } from '../../extensions/types'
import type { ExtensionLifecycleRepositoryShape } from '../../ports/extension-lifecycle-repository'
import type { ExtensionManagerServiceShape } from '../../ports/extension-manager-service'
import type { ExtensionProjectOverridesRepositoryShape } from '../../ports/extension-project-overrides-repository'
import type { OpenWaggleExtensionPiResourceRoot } from './openwaggle-pi-settings-resources'

export interface OpenWagglePiExtensionSelectionServices {
  readonly manager: ExtensionManagerServiceShape
  readonly lifecycleRepository: ExtensionLifecycleRepositoryShape
  readonly projectOverridesRepository: ExtensionProjectOverridesRepositoryShape
}

export interface RuntimeEnabledOpenWaggleExtensionPackage {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState
  readonly packagePath: string
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

export function listRuntimeEnabledPackages(
  projectPath: string,
  services: OpenWagglePiExtensionSelectionServices,
) {
  return Effect.gen(function* () {
    const packages = yield* services.manager.listPackages({ projectPath })
    const enabledPackages = yield* Effect.forEach(
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

          if (!lifecycle) {
            return null
          }

          if (!isExtensionRuntimeEnabled({ extensionPackage, lifecycle, projectOverride })) {
            return null
          }

          return {
            extensionPackage,
            lifecycle,
            packagePath: extensionPackage.packagePath,
          } satisfies RuntimeEnabledOpenWaggleExtensionPackage
        }),
    )

    return enabledPackages.filter(present)
  })
}

export function listRuntimeEnabledPackagePaths(
  projectPath: string,
  services: OpenWagglePiExtensionSelectionServices,
) {
  return listRuntimeEnabledPackages(projectPath, services).pipe(
    Effect.map((packages) => packages.map((extensionPackage) => extensionPackage.packagePath)),
  )
}

export function getRuntimeEnabledPackagePiResourceRoots(
  selection: RuntimeEnabledOpenWaggleExtensionPackage,
): readonly OpenWaggleExtensionPiResourceRoot[] {
  return (selection.extensionPackage.manifest?.pi?.resourceRoots ?? []).map((resourceRoot) => ({
    packagePath: selection.packagePath,
    resourceRoot,
  }))
}

export function getRuntimeEnabledPackagesPiResourceRoots(
  selections: readonly RuntimeEnabledOpenWaggleExtensionPackage[],
  packagePaths: readonly string[],
) {
  const selectedPaths = new Set(packagePaths)
  return selections.flatMap((selection) =>
    selectedPaths.has(selection.packagePath)
      ? getRuntimeEnabledPackagePiResourceRoots(selection)
      : [],
  )
}

export function upsertRuntimeLoadFailure(
  selection: RuntimeEnabledOpenWaggleExtensionPackage,
  error: unknown,
  services: Pick<OpenWagglePiExtensionSelectionServices, 'lifecycleRepository'>,
) {
  return Effect.gen(function* () {
    const nextLifecycle = yield* Effect.sync(() =>
      applyRuntimeLoadFailureToLifecycle({
        extensionPackage: selection.extensionPackage,
        lifecycle: selection.lifecycle,
        error,
        now: Date.now(),
      }),
    )
    yield* services.lifecycleRepository.upsert(nextLifecycle)
  })
}
