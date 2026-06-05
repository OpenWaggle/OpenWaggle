import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
  ExtensionDiagnosticView,
  ExtensionListContributionsInput,
} from '@shared/types/extensions'
import * as Effect from 'effect/Effect'
import type {
  DiscoveredExtensionPackage,
  ExtensionDiagnostic,
  ExtensionLifecycleState,
} from '../extensions/types'
import { ExtensionLifecycleRepository } from '../ports/extension-lifecycle-repository'
import {
  ExtensionManagerService,
  type ExtensionManagerServiceShape,
} from '../ports/extension-manager-service'
import {
  ExtensionProjectOverridesRepository,
  type ExtensionProjectOverridesRepositoryShape,
} from '../ports/extension-project-overrides-repository'
import {
  type ExtensionContributionProjectOverrideLookup,
  packageToContributionEntries,
} from './extension-contribution-registry-model'
import {
  appendExtensionDiagnostic,
  makeDiscoveryFailurePackage,
  makeExtensionFailureDiagnostic,
  scopeForProjectPath,
} from './extension-failure-isolation-model'

interface LifecycleLookup {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState | null
}

interface ContributionRegistryPackageResult {
  readonly entries: readonly ExtensionContributionRegistryEntry[]
  readonly diagnostics: readonly ExtensionDiagnostic[]
}

function normalizeProjectPaths(projectPaths: readonly string[] | undefined) {
  const normalizedProjectPaths: string[] = []
  for (const projectPath of projectPaths ?? []) {
    const normalized = projectPath.trim()
    if (normalized.length > 0 && !normalizedProjectPaths.includes(normalized)) {
      normalizedProjectPaths.push(normalized)
    }
  }
  return normalizedProjectPaths
}

function normalizeSessionId(sessionId: string | undefined) {
  const normalized = sessionId?.trim()
  return normalized && normalized.length > 0 ? normalized : undefined
}

function isGlobalPackage(extensionPackage: DiscoveredExtensionPackage) {
  return extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.GLOBAL_KIND
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

function isProjectPackageForPath(
  extensionPackage: DiscoveredExtensionPackage,
  projectPath: string,
) {
  return (
    extensionPackage.scope.kind === OPENWAGGLE_EXTENSION.SCOPE.PROJECT_KIND &&
    extensionPackage.scope.projectPath === projectPath
  )
}

function getCandidateProjectPaths(
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

function diagnosticsToView(
  diagnostics: readonly ExtensionDiagnostic[],
): readonly ExtensionDiagnosticView[] {
  return diagnostics.map((diagnostic) => ({
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.path !== undefined ? { path: diagnostic.path } : {}),
  }))
}

function loadContributionPackages(projectPaths: readonly string[]) {
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

function unavailableProjectOverrideLookup(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly projectPath: string
  readonly error: unknown
}): ExtensionContributionProjectOverrideLookup {
  return {
    projectPath: input.projectPath,
    projectOverride: { disabled: true },
    diagnostics: [
      makeExtensionFailureDiagnostic({
        operation: `Extension project override read for "${input.extensionPackage.id}"`,
        code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.PROJECT_OVERRIDE_UNAVAILABLE,
        error: input.error,
        path: input.projectPath,
      }),
    ],
  }
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
            projectPath,
            projectOverride,
            diagnostics: [],
          }) satisfies ExtensionContributionProjectOverrideLookup,
      ),
      Effect.catchAll((error) =>
        Effect.succeed(unavailableProjectOverrideLookup({ extensionPackage, projectPath, error })),
      ),
    )
}

function loadProjectOverrides(
  extensionPackage: DiscoveredExtensionPackage,
  projectPaths: readonly string[],
) {
  return Effect.gen(function* () {
    const projectOverridesRepository = yield* ExtensionProjectOverridesRepository
    return yield* Effect.forEach(projectPaths, (projectPath) =>
      loadProjectOverride(projectOverridesRepository, extensionPackage, projectPath),
    )
  })
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

function packageToContributionEntriesSafely(input: {
  readonly extensionPackage: DiscoveredExtensionPackage
  readonly lifecycle: ExtensionLifecycleState | null
  readonly projectOverrides: readonly ExtensionContributionProjectOverrideLookup[]
  readonly requestedProjectPaths: readonly string[]
  readonly requestedSessionId: string | undefined
}) {
  return Effect.try({
    try: () => packageToContributionEntries(input),
    catch: (error) => error,
  }).pipe(
    Effect.map(
      (entries) =>
        ({
          entries,
          diagnostics: [],
        }) satisfies ContributionRegistryPackageResult,
    ),
    Effect.catchAll((error) =>
      Effect.succeed({
        entries: [],
        diagnostics: [
          makeExtensionFailureDiagnostic({
            operation: `Extension contribution registry build for "${input.extensionPackage.id}"`,
            code: OPENWAGGLE_EXTENSION.DIAGNOSTIC.CODE.CONTRIBUTION_REGISTRATION_FAILED,
            error,
            path: input.extensionPackage.manifestPath,
          }),
        ],
      } satisfies ContributionRegistryPackageResult),
    ),
  )
}

export function listExtensionContributionRegistryView(input: ExtensionListContributionsInput = {}) {
  return Effect.gen(function* () {
    const projectPaths = normalizeProjectPaths(input.projectPaths)
    const packages = yield* loadContributionPackages(projectPaths)
    const packageResults = yield* Effect.forEach(packages, (extensionPackage) =>
      Effect.gen(function* () {
        const lifecycleLookup = yield* loadLifecycle(extensionPackage)
        const candidateProjectPaths = getCandidateProjectPaths(extensionPackage, projectPaths)
        const projectOverrides = yield* loadProjectOverrides(
          lifecycleLookup.extensionPackage,
          candidateProjectPaths,
        )

        const registryPackageResult = yield* packageToContributionEntriesSafely({
          extensionPackage: lifecycleLookup.extensionPackage,
          lifecycle: lifecycleLookup.lifecycle,
          projectOverrides,
          requestedProjectPaths: projectPaths,
          requestedSessionId: normalizeSessionId(input.sessionId),
        })

        return {
          entries: registryPackageResult.entries,
          diagnostics: [
            ...lifecycleLookup.extensionPackage.diagnostics,
            ...projectOverrides.flatMap((projectOverride) => projectOverride.diagnostics),
            ...registryPackageResult.diagnostics,
          ],
        } satisfies ContributionRegistryPackageResult
      }),
    )

    return {
      projectPaths,
      entries: packageResults.flatMap((result) => result.entries),
      diagnostics: diagnosticsToView(packageResults.flatMap((result) => result.diagnostics)),
    } satisfies ExtensionContributionRegistryView
  })
}
