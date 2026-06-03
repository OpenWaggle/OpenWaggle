import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { PackageOpen } from 'lucide-react'
import { COMMAND_PALETTE } from '../constants/command-palette'
import type { CommandPaletteItem } from '../model'
import { truncateCommandDescription } from './command-palette-text'

export interface ExtensionCommandActionInput {
  readonly entry: ExtensionContributionRegistryEntry
}

export type InvokeExtensionCommand = (input: ExtensionCommandActionInput) => void

export function createExtensionCommandItems({
  registry,
  lowerQuery,
  invokeCommand,
}: {
  readonly registry: ExtensionContributionRegistryView | null
  readonly lowerQuery: string
  readonly invokeCommand: InvokeExtensionCommand
}) {
  if (registry === null) {
    return []
  }

  const items: CommandPaletteItem[] = []

  for (const entry of registry.entries) {
    if (!isExecutableCommandEntry(entry) || !extensionCommandMatches(entry, lowerQuery)) {
      continue
    }

    items.push({
      id: `extension-command:${entry.extensionId}:${entry.contributionId}`,
      label: entry.title,
      description: truncateCommandDescription(
        `Extension command from ${entry.extensionName}`,
        COMMAND_PALETTE.DESCRIPTION_LIMIT,
      ),
      icon: <PackageOpen className="size-3.5" />,
      section: entry.category ?? 'Extensions',
      trailing: entry.extensionName,
      trailingBadge: entry.scope.label,
      action: () => invokeCommand({ entry }),
    })
  }

  return items
}

function isExecutableCommandEntry(entry: ExtensionContributionRegistryEntry) {
  return (
    entry.family === OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.COMMANDS &&
    entry.capability !== undefined &&
    entry.method !== undefined
  )
}

function extensionCommandMatches(entry: ExtensionContributionRegistryEntry, lowerQuery: string) {
  return (
    lowerQuery.length === 0 ||
    entry.title.toLowerCase().includes(lowerQuery) ||
    entry.extensionName.toLowerCase().includes(lowerQuery) ||
    entry.contributionId.includes(lowerQuery) ||
    Boolean(entry.category?.toLowerCase().includes(lowerQuery))
  )
}
