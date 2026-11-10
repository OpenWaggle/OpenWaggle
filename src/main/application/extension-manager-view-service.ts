import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionListPackagesInput,
  ExtensionManagerView,
  ExtensionProjectOverrideView,
} from '@shared/types/extensions'
import * as Effect from 'effect/Effect'
import type {
  DiscoveredExtensionPackage,
  ExtensionDiagnostic,
  ExtensionLifecycleState,
} from '../extensions/types'
import { ExtensionLifecycleRepository } from '../ports/extension-lifecycle-repository'
import {
  ExtensionProjectOverridesRepository,
  type ExtensionProjectOverridesRepositoryShape,
} from '../ports/extension-project-overrides-repository'
import {
  appendExtensionDiagnostic,
  appendExtensionDiagnostics,
  makeExtensionFailureDiagnostic,
} from './extension-failure-isolation-model'
import {
  packageToSummary,
  projectOverrideToView,
  unavailableProjectOverrideToView,
} from './extension-manager-view-model'
import {
  loadScopedExtensionPackages,
  normalizeExtensionProjectPaths,
  packageRequestedProjectPaths,
} from './extension-package-listing'

interface LifecycleLookup {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState | null
}

interface ProjectOverrideLookup {
  readonly projectOverride: ExtensionProjectOverrideView
  readonly diagnostics: readonly ExtensionDiagnostic[]
}

function getPrimaryProjectOverride(
  extensionPackage: DiscoveredExtensionPackage,
  projectOverrides: readonly ExtensionProjectOverrideView[],
) {
  if (extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND) {
    const packageProjectPath = extensionPackage.scope.projectPath
    return (
      projectOverrides.find(
        (projectOverride) => projectOverride.projectPath === packageProjectPath,
      ) ?? null
    )
  }

  return projectOverrides.length === 1 ? (projectOverrides[0] ?? null) : null
}

function loadLifecycle(extensionPackage: DiscoveredExtensionPackage) {
  return Effect.gen(function* () {
    const lifecycleRepository = yield* ExtensionLifecycleRepository
    return yield* lifecycleRepository
      .get({
        extensionId: extensionPackage.id,
        scope: extensionPackage.scope,
      })
      .pipe(
        Effect.map(
          (lifecycle) =>
            ({
              extensionPackage,
              lifecycle,
            }) satisfies LifecycleLookup,
        ),
        Effect.catchAll((error) =>
          Effect.succeed({
            extensionPackage: appendExtensionDiagnostic(
              extensionPackage,
              makeExtensionFailureDiagnostic({
                operation: `Extension lifecycle state read for "${extensionPackage.id}"`,
                code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.LIFECYCLE_STATE_UNAVAILABLE,
                error,
                path: extensionPackage.packagePath,
              }),
            ),
            lifecycle: null,
          } satisfies LifecycleLookup),
        ),
      )
  })
}

function loadProjectOverride(
  projectOverridesRepository: ExtensionProjectOverridesRepositoryShape,
  extensionPackage: DiscoveredExtensionPackage,
  projectPath: string,
) {
  return projectOverridesRepository
    .get({
      extensionId: extensionPackage.id,
      scope: extensionPackage.scope,
      projectPath,
    })
    .pipe(
      Effect.map(
        (projectOverride) =>
          ({
            projectOverride: projectOverrideToView(projectPath, projectOverride),
            diagnostics: [],
          }) satisfies ProjectOverrideLookup,
      ),
      Effect.catchAll((error) =>
        Effect.succeed({
          projectOverride: unavailableProjectOverrideToView(projectPath),
          diagnostics: [
            makeExtensionFailureDiagnostic({
              operation: `Extension project override read for "${extensionPackage.id}"`,
              code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.PROJECT_OVERRIDE_UNAVAILABLE,
              error,
              path: projectPath,
            }),
          ],
        } satisfies ProjectOverrideLookup),
      ),
    )
}

function loadProjectOverrides(
  extensionPackage: DiscoveredExtensionPackage,
  projectPaths: readonly string[],
) {
  return Effect.gen(function* () {
    const projectOverridesRepository = yield* ExtensionProjectOverridesRepository
    const overrideProjectPaths = packageRequestedProjectPaths(extensionPackage, projectPaths)
    const lookups = yield* Effect.forEach(overrideProjectPaths, (projectPath) =>
      loadProjectOverride(projectOverridesRepository, extensionPackage, projectPath),
    )

    return {
      projectOverrides: lookups.map((lookup) => lookup.projectOverride),
      diagnostics: lookups.flatMap((lookup) => lookup.diagnostics),
    }
  })
}

export function listExtensionPackagesView(input: ExtensionListPackagesInput) {
  return Effect.gen(function* () {
    const projectPaths = normalizeExtensionProjectPaths(input.projectPaths)
    const packages = yield* loadScopedExtensionPackages(projectPaths)
    const summaries = yield* Effect.forEach(packages, (extensionPackage) =>
      Effect.gen(function* () {
        const lifecycleLookup = yield* loadLifecycle(extensionPackage)
        const projectOverrideLookup = yield* loadProjectOverrides(
          lifecycleLookup.extensionPackage,
          projectPaths,
        )
        const extensionPackageWithDiagnostics = appendExtensionDiagnostics(
          lifecycleLookup.extensionPackage,
          projectOverrideLookup.diagnostics,
        )
        const projectOverrides = projectOverrideLookup.projectOverrides
        const projectOverride = getPrimaryProjectOverride(extensionPackage, projectOverrides)
        return packageToSummary({
          extensionPackage: extensionPackageWithDiagnostics,
          lifecycle: lifecycleLookup.lifecycle,
          projectOverride,
          projectOverrides,
        })
      }),
    )

    return {
      projectPath: projectPaths[0] ?? null,
      projectPaths,
      packages: summaries,
    } satisfies ExtensionManagerView
  })
}
