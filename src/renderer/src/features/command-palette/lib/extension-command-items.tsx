import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionContributionRegistryEntry,
  ExtensionContributionRegistryView,
} from '@shared/types/extensions'
import { PackageOpen } from 'lucide-react'
import {
  extensionContributionMatches,
  extensionSlashCommandText,
  isInvokableExtensionContributionCommand,
  isInvokableExtensionSlashCommandEntry,
} from '@/features/composer/commands'
import { COMMAND_PALETTE } from '../constants/command-palette'
import type { CommandPaletteItem } from '../model'
import { truncateCommandDescription } from './command-palette-text'

export interface ExtensionCommandActionInput {
  readonly entry: ExtensionContributionRegistryEntry
}

export type InvokeExtensionCommand = (input: ExtensionCommandActionInput) => void

export interface ExtensionSlashCommandActionInput {
  readonly entry: ExtensionContributionRegistryEntry
}

export type InsertExtensionSlashCommand = (input: ExtensionSlashCommandActionInput) => void

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
    if (!isExecutableCommandEntry(entry) || !extensionContributionMatches(entry, lowerQuery)) {
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

export function createExtensionSlashCommandItems({
  registry,
  lowerQuery,
  insertCommand,
}: {
  readonly registry: ExtensionContributionRegistryView | null
  readonly lowerQuery: string
  readonly insertCommand: InsertExtensionSlashCommand
}) {
  if (registry === null) {
    return []
  }

  const items: CommandPaletteItem[] = []

  for (const entry of registry.entries) {
    if (
      !isInvokableExtensionSlashCommandEntry(entry) ||
      !extensionContributionMatches(entry, lowerQuery)
    ) {
      continue
    }

    items.push({
      id: `extension-slash-command:${entry.extensionId}:${entry.contributionId}`,
      label: entry.title,
      description: truncateCommandDescription(
        `Insert ${extensionSlashCommandText(entry)} from ${entry.extensionName}`,
        COMMAND_PALETTE.DESCRIPTION_LIMIT,
      ),
      icon: <PackageOpen className="size-3.5" />,
      section: entry.category ?? 'Extensions',
      trailing: extensionSlashCommandText(entry),
      trailingBadge: entry.scope.label,
      action: () => insertCommand({ entry }),
    })
  }

  return items
}

function isExecutableCommandEntry(entry: ExtensionContributionRegistryEntry) {
  return isInvokableExtensionContributionCommand(
    entry,
    OPENWAGGLE_EXTENSION.CONTRIBUTION_FAMILY.COMMANDS,
  )
}
