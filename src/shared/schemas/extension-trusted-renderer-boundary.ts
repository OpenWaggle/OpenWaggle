import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'

interface ManifestTrustedRendererBoundaryContribution {
  readonly runtime?: string
}

interface ManifestTrustedRendererBoundaryInput {
  readonly trusted?: {
    readonly renderer?: string
  }
  readonly contributions?: {
    readonly routes?: readonly ManifestTrustedRendererBoundaryContribution[]
    readonly settingsSections?: readonly ManifestTrustedRendererBoundaryContribution[]
    readonly sidePanels?: readonly ManifestTrustedRendererBoundaryContribution[]
    readonly dialogs?: readonly ManifestTrustedRendererBoundaryContribution[]
    readonly transcriptRenderers?: readonly ManifestTrustedRendererBoundaryContribution[]
    readonly toolRenderers?: readonly ManifestTrustedRendererBoundaryContribution[]
    readonly customMessageRenderers?: readonly ManifestTrustedRendererBoundaryContribution[]
    readonly interactionRenderers?: readonly ManifestTrustedRendererBoundaryContribution[]
    readonly statusWidgets?: readonly ManifestTrustedRendererBoundaryContribution[]
  }
}

function contributionUsesTrustedRendererRuntime(
  contribution: ManifestTrustedRendererBoundaryContribution,
) {
  return contribution.runtime === OPENWAGGLE_EXTENSION.CONTRIBUTION_RUNTIME.TRUSTED_RENDERER
}

function contributionsUseTrustedRendererRuntime(
  contributions: readonly ManifestTrustedRendererBoundaryContribution[] | undefined,
) {
  return contributions?.some(contributionUsesTrustedRendererRuntime) === true
}

function manifestUsesTrustedRendererRuntime(manifest: ManifestTrustedRendererBoundaryInput) {
  const contributions = manifest.contributions
  if (!contributions) {
    return false
  }

  return (
    contributionsUseTrustedRendererRuntime(contributions.routes) ||
    contributionsUseTrustedRendererRuntime(contributions.settingsSections) ||
    contributionsUseTrustedRendererRuntime(contributions.sidePanels) ||
    contributionsUseTrustedRendererRuntime(contributions.dialogs) ||
    contributionsUseTrustedRendererRuntime(contributions.transcriptRenderers) ||
    contributionsUseTrustedRendererRuntime(contributions.toolRenderers) ||
    contributionsUseTrustedRendererRuntime(contributions.customMessageRenderers) ||
    contributionsUseTrustedRendererRuntime(contributions.interactionRenderers) ||
    contributionsUseTrustedRendererRuntime(contributions.statusWidgets)
  )
}

export function validateTrustedRendererRuntimeBoundary(
  manifest: ManifestTrustedRendererBoundaryInput,
) {
  if (manifestUsesTrustedRendererRuntime(manifest) && manifest.trusted?.renderer === undefined) {
    return 'Trusted renderer contributions require trusted.renderer to declare privileged renderer runtime execution.'
  }

  return true
}
