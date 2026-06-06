import type { ExtensionContributions } from '@shared/schemas/extensions'
import type {
  ExtensionContributionFamily,
  ExtensionContributionMatchView,
  ExtensionContributionRuntime,
  ExtensionContributionTargetView,
  ExtensionExecutionPlacement,
} from '@shared/types/extensions'

export interface ManifestCommandContribution {
  readonly id: string
  readonly title: string
  readonly category?: string
  readonly target?: ExtensionContributionTargetView
  readonly capability?: string
  readonly method?: string
  readonly methods?: readonly string[]
}

export interface ManifestEntryContribution {
  readonly id: string
  readonly title: string
  readonly runtime: ExtensionContributionRuntime
  readonly execution: ExtensionExecutionPlacement
  readonly entry: string
  readonly target?: ExtensionContributionTargetView
  readonly matches?: ExtensionContributionMatchView
  readonly capability?: string
  readonly method?: string
  readonly methods?: readonly string[]
}

interface CommandFamilyDescriptor {
  readonly family: 'commands' | 'slashCommands'
  readonly contributions: (
    contributions: ExtensionContributions,
  ) => readonly ManifestCommandContribution[] | undefined
}

interface EntryFamilyDescriptor {
  readonly family: Exclude<ExtensionContributionFamily, CommandFamilyDescriptor['family']>
  readonly contributions: (
    contributions: ExtensionContributions,
  ) => readonly ManifestEntryContribution[] | undefined
}

export const COMMAND_FAMILY_DESCRIPTORS = [
  { family: 'commands', contributions: (contributions) => contributions.commands },
  { family: 'slashCommands', contributions: (contributions) => contributions.slashCommands },
] satisfies readonly CommandFamilyDescriptor[]

export const ENTRY_FAMILY_DESCRIPTORS = [
  { family: 'routes', contributions: (contributions) => contributions.routes },
  {
    family: 'settingsSections',
    contributions: (contributions) => contributions.settingsSections,
  },
  { family: 'sidePanels', contributions: (contributions) => contributions.sidePanels },
  { family: 'dialogs', contributions: (contributions) => contributions.dialogs },
  {
    family: 'transcriptRenderers',
    contributions: (contributions) => contributions.transcriptRenderers,
  },
  { family: 'toolRenderers', contributions: (contributions) => contributions.toolRenderers },
  {
    family: 'customMessageRenderers',
    contributions: (contributions) => contributions.customMessageRenderers,
  },
  {
    family: 'interactionRenderers',
    contributions: (contributions) => contributions.interactionRenderers,
  },
  { family: 'statusWidgets', contributions: (contributions) => contributions.statusWidgets },
] satisfies readonly EntryFamilyDescriptor[]

export function isEntryContribution(
  contribution: ManifestCommandContribution | ManifestEntryContribution,
): contribution is ManifestEntryContribution {
  return 'entry' in contribution
}
