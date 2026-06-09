import { match } from '@diegogbrisa/ts-match'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
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

export type ManifestContribution = ManifestCommandContribution | ManifestEntryContribution

interface CommandFamilyDescriptor {
  readonly family: (typeof OPENWAGGLE_EXTENSION.COMMAND_CONTRIBUTION_FAMILIES)[number]
  readonly contributions: (
    contributions: ExtensionContributions,
  ) => readonly ManifestCommandContribution[] | undefined
}

interface EntryFamilyDescriptor {
  readonly family: (typeof OPENWAGGLE_EXTENSION.ENTRY_CONTRIBUTION_FAMILIES)[number]
  readonly contributions: (
    contributions: ExtensionContributions,
  ) => readonly ManifestEntryContribution[] | undefined
}

const CONTRIBUTION_FAMILY = OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY

export const COMMAND_FAMILY_DESCRIPTORS = [
  {
    family: CONTRIBUTION_FAMILY.COMMANDS,
    contributions: (contributions) => contributions.commands,
  },
  {
    family: CONTRIBUTION_FAMILY.SLASH_COMMANDS,
    contributions: (contributions) => contributions.slashCommands,
  },
] satisfies readonly CommandFamilyDescriptor[]

export const ENTRY_FAMILY_DESCRIPTORS = [
  { family: CONTRIBUTION_FAMILY.ROUTES, contributions: (contributions) => contributions.routes },
  {
    family: CONTRIBUTION_FAMILY.SETTINGS_SECTIONS,
    contributions: (contributions) => contributions.settingsSections,
  },
  {
    family: CONTRIBUTION_FAMILY.SIDE_PANELS,
    contributions: (contributions) => contributions.sidePanels,
  },
  { family: CONTRIBUTION_FAMILY.DIALOGS, contributions: (contributions) => contributions.dialogs },
  {
    family: CONTRIBUTION_FAMILY.TRANSCRIPT_RENDERERS,
    contributions: (contributions) => contributions.transcriptRenderers,
  },
  {
    family: CONTRIBUTION_FAMILY.TOOL_RENDERERS,
    contributions: (contributions) => contributions.toolRenderers,
  },
  {
    family: CONTRIBUTION_FAMILY.CUSTOM_MESSAGE_RENDERERS,
    contributions: (contributions) => contributions.customMessageRenderers,
  },
  {
    family: CONTRIBUTION_FAMILY.INTERACTION_RENDERERS,
    contributions: (contributions) => contributions.interactionRenderers,
  },
  {
    family: CONTRIBUTION_FAMILY.STATUS_WIDGETS,
    contributions: (contributions) => contributions.statusWidgets,
  },
] satisfies readonly EntryFamilyDescriptor[]

export const CONTRIBUTION_FAMILY_DESCRIPTORS = [
  ...COMMAND_FAMILY_DESCRIPTORS,
  ...ENTRY_FAMILY_DESCRIPTORS,
] satisfies readonly (CommandFamilyDescriptor | EntryFamilyDescriptor)[]

export function getManifestFamilyContributions(
  contributions: ExtensionContributions,
  family: ExtensionContributionFamily,
): readonly ManifestContribution[] | undefined {
  return match(family)
    .with(CONTRIBUTION_FAMILY.COMMANDS, () => contributions.commands)
    .with(CONTRIBUTION_FAMILY.SLASH_COMMANDS, () => contributions.slashCommands)
    .with(CONTRIBUTION_FAMILY.ROUTES, () => contributions.routes)
    .with(CONTRIBUTION_FAMILY.SETTINGS_SECTIONS, () => contributions.settingsSections)
    .with(CONTRIBUTION_FAMILY.SIDE_PANELS, () => contributions.sidePanels)
    .with(CONTRIBUTION_FAMILY.DIALOGS, () => contributions.dialogs)
    .with(CONTRIBUTION_FAMILY.TRANSCRIPT_RENDERERS, () => contributions.transcriptRenderers)
    .with(CONTRIBUTION_FAMILY.TOOL_RENDERERS, () => contributions.toolRenderers)
    .with(CONTRIBUTION_FAMILY.CUSTOM_MESSAGE_RENDERERS, () => contributions.customMessageRenderers)
    .with(CONTRIBUTION_FAMILY.INTERACTION_RENDERERS, () => contributions.interactionRenderers)
    .with(CONTRIBUTION_FAMILY.STATUS_WIDGETS, () => contributions.statusWidgets)
    .exhaustive()
}

export function isEntryContribution(
  contribution: ManifestContribution,
): contribution is ManifestEntryContribution {
  return 'entry' in contribution
}
