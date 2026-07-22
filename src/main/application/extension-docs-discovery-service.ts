import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { DocsListInput } from '@shared/types/docs'
import * as Effect from 'effect/Effect'
import type { DiscoveredExtensionPackage } from '../extensions/types'
import { ExtensionLifecycleRepository } from '../ports/extension-lifecycle-repository'
import {
  ExtensionManagerService,
  type ExtensionManagerServiceShape,
} from '../ports/extension-manager-service'
import {
  compareExtensionTopics,
  type ExtensionPackageWithLifecycle,
  extensionPackageDocs,
  packageLoadDiagnostic,
} from './extension-docs-topic-model'

function normalizeProjectPaths(projectPaths: readonly string[] | undefined) {
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

function isGlobalPackage(extensionPackage: DiscoveredExtensionPackage) {
  return extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
}

function isProjectPackageForPath(
  extensionPackage: DiscoveredExtensionPackage,
  projectPath: string,
) {
  return (
    extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND &&
    extensionPackage.scope.projectPath === projectPath
  )
}

function listPackagesSafely(manager: ExtensionManagerServiceShape, projectPath: string | null) {
  return manager.listPackages({ projectPath }).pipe(
    Effect.map((packages) => ({ packages, diagnostics: [] })),
    Effect.catchAll((error) =>
      Effect.succeed({
        packages: [],
        diagnostics: [
          packageLoadDiagnostic({
            operation: 'Failed to discover extension packages for docs',
            error,
            ...(projectPath !== null ? { path: projectPath } : {}),
          }),
        ],
      }),
    ),
  )
}

function loadExtensionDocPackages(projectPaths: readonly string[]) {
  return Effect.gen(function* () {
    const manager = yield* ExtensionManagerService
    const globalPackages = yield* listPackagesSafely(manager, null).pipe(
      Effect.map((result) => ({
        packages: result.packages.filter(isGlobalPackage),
        diagnostics: result.diagnostics,
      })),
    )
    const projectPackageGroups = yield* Effect.forEach(projectPaths, (projectPath) =>
      listPackagesSafely(manager, projectPath).pipe(
        Effect.map((result) => ({
          packages: result.packages.filter((extensionPackage) =>
            isProjectPackageForPath(extensionPackage, projectPath),
          ),
          diagnostics: result.diagnostics,
        })),
      ),
    )

    return {
      packages: [
        ...globalPackages.packages,
        ...projectPackageGroups.flatMap((group) => group.packages),
      ],
      diagnostics: [
        ...globalPackages.diagnostics,
        ...projectPackageGroups.flatMap((group) => group.diagnostics),
      ],
    }
  })
}

function loadLifecycle(extensionPackage: DiscoveredExtensionPackage) {
  return Effect.gen(function* () {
    const lifecycleRepository = yield* ExtensionLifecycleRepository
    return yield* lifecycleRepository
      .get({ extensionId: extensionPackage.id, scope: extensionPackage.scope })
      .pipe(
        Effect.map(
          (lifecycle) =>
            ({
              extensionPackage,
              lifecycle,
              diagnostics: [],
            }) satisfies ExtensionPackageWithLifecycle,
        ),
        Effect.catchAll((error) =>
          Effect.succeed({
            extensionPackage,
            lifecycle: null,
            diagnostics: [
              packageLoadDiagnostic({
                operation: `Failed to read lifecycle for extension "${extensionPackage.id}"`,
                error,
                path: extensionPackage.packagePath,
              }),
            ],
          } satisfies ExtensionPackageWithLifecycle),
        ),
      )
  })
}

export function listExtensionDocs(input: DocsListInput) {
  return Effect.gen(function* () {
    if (input.includeExtensions === false) {
      return { topics: [], diagnostics: [] }
    }

    const packageLookup = yield* loadExtensionDocPackages(normalizeProjectPaths(input.projectPaths))
    const packagesWithLifecycle = yield* Effect.forEach(packageLookup.packages, loadLifecycle)
    const packageTopics = yield* Effect.forEach(packagesWithLifecycle, extensionPackageDocs)
    return {
      topics: packageTopics.flat().sort(compareExtensionTopics),
      diagnostics: packageLookup.diagnostics,
    }
  })
}
