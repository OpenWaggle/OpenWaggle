import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type { ExtensionInvokeScope } from '@shared/types/extension-broker'
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
export type CanInvokeExtensionCommand = (entry: ExtensionContributionRegistryEntry) => boolean

export function resolveExtensionCommandInvocationScope(input: {
  readonly entry: ExtensionContributionRegistryEntry
  readonly projectPath: string | null | undefined
  readonly sessionId?: string | null
}): ExtensionInvokeScope | null {
  const { entry, projectPath, sessionId } = input
  const declaredScopes = entry.declaredScopes

  if (declaredScopes === undefined) {
    return projectPath ? { kind: 'project', projectPath } : { kind: 'app' }
  }

  if (
    projectPath &&
    sessionId &&
    declaredScopes.includes('session') &&
    entry.projectPaths.includes(projectPath)
  ) {
    return { kind: 'session', projectPath, sessionId }
  }

  if (
    projectPath &&
    declaredScopes.includes('project') &&
    entry.projectPaths.includes(projectPath)
  ) {
    return { kind: 'project', projectPath }
  }

  if (declaredScopes.includes('app')) {
    return { kind: 'app' }
  }

  return null
}

export interface ExtensionSlashCommandActionInput {
  readonly entry: ExtensionContributionRegistryEntry
}

export type InsertExtensionSlashCommand = (input: ExtensionSlashCommandActionInput) => void

export interface ExtensionSidePanelActionInput {
  readonly entry: ExtensionContributionRegistryEntry
}

export function createExtensionCommandItems({
  registry,
  lowerQuery,
  invokeCommand,
  canInvokeCommand = () => true,
}: {
  readonly registry: ExtensionContributionRegistryView | null
  readonly lowerQuery: string
  readonly invokeCommand: InvokeExtensionCommand
  readonly canInvokeCommand?: CanInvokeExtensionCommand
}) {
  if (registry === null) {
    return []
  }

  const items: CommandPaletteItem[] = []

  for (const entry of registry.entries) {
    if (
      !isExecutableCommandEntry(entry) ||
      !extensionContributionMatches(entry, lowerQuery) ||
      !canInvokeCommand(entry)
    ) {
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
