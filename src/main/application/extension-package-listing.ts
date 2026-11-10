import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import * as Effect from 'effect/Effect'
import type { DiscoveredExtensionPackage } from '../extensions/types'
import {
  ExtensionManagerService,
  type ExtensionManagerServiceShape,
} from '../ports/extension-manager-service'
import {
  makeDiscoveryFailurePackage,
  scopeForProjectPath,
} from './extension-failure-isolation-model'

/** Trims the requested project paths and drops blanks and repeats, keeping their order. */
export function normalizeExtensionProjectPaths(projectPaths: readonly string[] | undefined) {
  const normalizedProjectPaths: string[] = []
  const seenProjectPaths = new Set<string>()
  for (const projectPath of projectPaths ?? []) {
    const normalized = projectPath.trim()
    if (normalized.length > 0 && !seenProjectPaths.has(normalized)) {
      seenProjectPaths.add(normalized)
      normalizedProjectPaths.push(normalized)
    }
  }
  return normalizedProjectPaths
}

export function isGlobalPackage(extensionPackage: DiscoveredExtensionPackage) {
  return extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
}

export function isProjectPackageForPath(
  extensionPackage: DiscoveredExtensionPackage,
  projectPath: string,
) {
  return (
    extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND &&
    extensionPackage.scope.projectPath === projectPath
  )
}

/** The requested projects a package applies to: all of them when global, else its own project. */
export function packageRequestedProjectPaths(
  extensionPackage: DiscoveredExtensionPackage,
  requestedProjectPaths: readonly string[],
) {
  if (requestedProjectPaths.length === 0) {
    return []
  }

  if (extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND) {
    return requestedProjectPaths
  }

  return requestedProjectPaths.includes(extensionPackage.scope.projectPath)
    ? [extensionPackage.scope.projectPath]
    : []
}

function listPackagesSafely(manager: ExtensionManagerServiceShape, projectPath: string | null) {
  return manager
    .listPackages({ projectPath })
    .pipe(
      Effect.catchAll((error) =>
        Effect.succeed([
          makeDiscoveryFailurePackage({ scope: scopeForProjectPath(projectPath), error }),
        ]),
      ),
    )
}

/**
 * Lists the global packages and each requested project's own packages. A scope whose discovery
 * fails contributes one failure package instead of failing the whole listing.
 */
export function loadScopedExtensionPackages(projectPaths: readonly string[]) {
  return Effect.gen(function* () {
    const manager = yield* ExtensionManagerService
    const globalPackages = yield* listPackagesSafely(manager, null).pipe(
      Effect.map((packages) => packages.filter(isGlobalPackage)),
    )
    const projectPackageGroups = yield* Effect.forEach(projectPaths, (projectPath) =>
      listPackagesSafely(manager, projectPath).pipe(
        Effect.map((packages) =>
          packages.filter((extensionPackage) =>
            isProjectPackageForPath(extensionPackage, projectPath),
          ),
        ),
      ),
    )

    return [...globalPackages, ...projectPackageGroups.flat()]
  })
}
