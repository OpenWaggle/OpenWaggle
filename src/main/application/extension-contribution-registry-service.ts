import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryView,
  ExtensionListContributionsInput,
} from '@shared/types/extensions'
import * as Effect from 'effect/Effect'
import type { DiscoveredExtensionPackage, ExtensionPackageScope } from '../extensions/types'
import { ExtensionLifecycleRepository } from '../ports/extension-lifecycle-repository'
import { ExtensionManagerService } from '../ports/extension-manager-service'
import { ExtensionProjectOverridesRepository } from '../ports/extension-project-overrides-repository'
import {
  type ExtensionContributionProjectOverrideLookup,
  packageToContributionEntries,
} from './extension-contribution-registry-model'

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

function loadContributionPackages(projectPaths: readonly string[]) {
  return Effect.gen(function* () {
    const manager = yield* ExtensionManagerService
    const globalPackages = yield* manager
      .listPackages({ projectPath: null })
      .pipe(Effect.map((packages) => packages.filter(isGlobalPackage)))
    const projectPackageGroups = yield* Effect.forEach(projectPaths, (projectPath) =>
      manager
        .listPackages({ projectPath })
        .pipe(
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

function loadProjectOverrides(
  extensionId: string,
  extensionScope: ExtensionPackageScope,
  projectPaths: readonly string[],
) {
  return Effect.gen(function* () {
    const projectOverridesRepository = yield* ExtensionProjectOverridesRepository
    return yield* Effect.forEach(projectPaths, (projectPath) =>
      Effect.gen(function* () {
        const projectOverride = yield* projectOverridesRepository.get({
          extensionId,
          scope: extensionScope,
          projectPath,
        })
        return {
          projectPath,
          projectOverride,
        } satisfies ExtensionContributionProjectOverrideLookup
      }),
    )
  })
}

export function listExtensionContributionRegistryView(input: ExtensionListContributionsInput = {}) {
  return Effect.gen(function* () {
    const projectPaths = normalizeProjectPaths(input.projectPaths)
    const lifecycleRepository = yield* ExtensionLifecycleRepository
    const packages = yield* loadContributionPackages(projectPaths)
    const entries = yield* Effect.forEach(packages, (extensionPackage) =>
      Effect.gen(function* () {
        const lifecycle = yield* lifecycleRepository.get({
          extensionId: extensionPackage.id,
          scope: extensionPackage.scope,
        })
        const candidateProjectPaths = getCandidateProjectPaths(extensionPackage, projectPaths)
        const projectOverrides = yield* loadProjectOverrides(
          extensionPackage.id,
          extensionPackage.scope,
          candidateProjectPaths,
        )

        return packageToContributionEntries({
          extensionPackage,
          lifecycle,
          projectOverrides,
          requestedProjectPaths: projectPaths,
        })
      }),
    )

    return {
      projectPaths,
      entries: entries.flat(),
    } satisfies ExtensionContributionRegistryView
  })
}
