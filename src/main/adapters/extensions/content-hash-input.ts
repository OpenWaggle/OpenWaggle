import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ContentHashInput } from './package-files'

interface ManifestEntryContribution {
  readonly entry: string
}

export interface ManifestContentHashSource {
  readonly builtArtifacts: readonly string[]
  readonly contributions?: {
    readonly routes?: readonly ManifestEntryContribution[]
    readonly settingsSections?: readonly ManifestEntryContribution[]
    readonly sidePanels?: readonly ManifestEntryContribution[]
    readonly dialogs?: readonly ManifestEntryContribution[]
    readonly transcriptRenderers?: readonly ManifestEntryContribution[]
    readonly toolRenderers?: readonly ManifestEntryContribution[]
    readonly customMessageRenderers?: readonly ManifestEntryContribution[]
    readonly interactionRenderers?: readonly ManifestEntryContribution[]
    readonly statusWidgets?: readonly ManifestEntryContribution[]
  }
  readonly trusted?: {
    readonly main?: string
    readonly renderer?: string
  }
  readonly runtimeRequirements?: readonly {
    readonly command?: string
  }[]
}

function pushContributionEntryPaths(
  entryPaths: string[],
  contributions: readonly ManifestEntryContribution[] | undefined,
) {
  for (const contribution of contributions ?? []) {
    entryPaths.push(contribution.entry)
  }
}

function getContributionEntryPaths(manifest: ManifestContentHashSource): readonly string[] {
  const contributions = manifest.contributions
  if (!contributions) {
    return []
  }

  const entryPaths: string[] = []
  pushContributionEntryPaths(entryPaths, contributions.routes)
  pushContributionEntryPaths(entryPaths, contributions.settingsSections)
  pushContributionEntryPaths(entryPaths, contributions.sidePanels)
  pushContributionEntryPaths(entryPaths, contributions.dialogs)
  pushContributionEntryPaths(entryPaths, contributions.transcriptRenderers)
  pushContributionEntryPaths(entryPaths, contributions.toolRenderers)
  pushContributionEntryPaths(entryPaths, contributions.customMessageRenderers)
  pushContributionEntryPaths(entryPaths, contributions.interactionRenderers)
  pushContributionEntryPaths(entryPaths, contributions.statusWidgets)
  return entryPaths
}

function pushIfPresent(paths: string[], pathValue: string | undefined) {
  if (pathValue) {
    paths.push(pathValue)
  }
}

export function getManifestContentHashInput(manifest: ManifestContentHashSource): ContentHashInput {
  const runtimeFiles: string[] = []

  for (const entryPath of getContributionEntryPaths(manifest)) {
    runtimeFiles.push(entryPath)
  }
  pushIfPresent(runtimeFiles, manifest.trusted?.main)
  pushIfPresent(runtimeFiles, manifest.trusted?.renderer)
  for (const requirement of manifest.runtimeRequirements ?? []) {
    pushIfPresent(runtimeFiles, requirement.command)
  }

  return {
    builtArtifacts: manifest.builtArtifacts,
    runtimeFiles,
  }
}

export function normalizeManifestRelativePath(relativePath: string) {
  return relativePath.replaceAll(
    OPENWAGGLE_EXTENSION.PATH.WINDOWS_SEPARATOR,
    OPENWAGGLE_EXTENSION.PATH.POSIX_SEPARATOR,
  )
}

export function getContentHashRelativePaths(input: ContentHashInput) {
  return [...input.builtArtifacts, ...input.runtimeFiles]
    .map(normalizeManifestRelativePath)
    .sort((left, right) => left.localeCompare(right))
}
