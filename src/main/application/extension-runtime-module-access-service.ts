import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionContributionRegistryEntry } from '@shared/types/extensions'
import * as Effect from 'effect/Effect'
import { listExtensionContributionRegistryView } from './extension-contribution-registry-service'

export interface ExtensionRuntimeModuleAccessInput {
  readonly packagePath: string
  readonly contentHash: string
  readonly projectPaths: readonly string[]
}

function requestedProjectsAreCovered(
  entry: ExtensionContributionRegistryEntry,
  requestedProjectPaths: readonly string[],
) {
  return requestedProjectPaths.every((projectPath) => entry.projectPaths.includes(projectPath))
}

function entryCanServeRuntimeModule(
  entry: ExtensionContributionRegistryEntry,
  input: ExtensionRuntimeModuleAccessInput,
) {
  return (
    entry.packagePath === input.packagePath &&
    entry.contentHash === input.contentHash &&
    entry.runtime === OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.FEDERATED_MODULE &&
    entry.entryPath !== undefined &&
    entry.eligibility.runtimeEnabled &&
    entry.eligibility.enabled &&
    entry.eligibility.trusted &&
    entry.eligibility.sdkCompatible !== false &&
    !entry.eligibility.updateAvailable &&
    requestedProjectsAreCovered(entry, input.projectPaths)
  )
}

export function isExtensionRuntimeModuleAccessAllowed(input: ExtensionRuntimeModuleAccessInput) {
  return listExtensionContributionRegistryView({ projectPaths: input.projectPaths }).pipe(
    Effect.map((registry) =>
      registry.entries.some((entry) => entryCanServeRuntimeModule(entry, input)),
    ),
  )
}
