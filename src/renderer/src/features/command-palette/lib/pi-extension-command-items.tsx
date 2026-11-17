import type { AgentExtensionCommand } from '@shared/types/extension-command'
import { SquareTerminal } from 'lucide-react'
import { BUILT_IN_COMPOSER_SLASH_COMMANDS } from '@/features/composer/commands'
import { COMMAND_PALETTE } from '../constants/command-palette'
import { truncateCommandDescription } from './command-palette-text'

const NO_DESCRIPTION = 'Pi extension command'

/**
 * The slash menu's items for the commands the Session's Pi extensions register. Choosing one
 * inserts `/name`, which Pi runs when the message is sent. OpenWaggle's own commands and the
 * project's enabled skills of the same name are listed instead: Pi runs an extension command
 * before it expands a skill, so a shared name would never reach the skill.
 */
export function createPiExtensionCommandItems({
  commands,
  lowerQuery,
  insertCommand,
  skillOwnedCommandNames,
}: {
  readonly commands: readonly AgentExtensionCommand[]
  readonly lowerQuery: string
  readonly insertCommand: (command: string) => void
  /** Lowercased names an enabled skill owns, so the menu lists the skill item for that name. */
  readonly skillOwnedCommandNames: ReadonlySet<string>
}) {
  return commands
    .filter(
      (command) =>
        command.name.toLowerCase().startsWith(lowerQuery) &&
        !skillOwnedCommandNames.has(command.name.toLowerCase()) &&
        !BUILT_IN_COMPOSER_SLASH_COMMANDS.includes(`/${command.name}`),
    )
    .map((command) => ({
      id: `pi-extension-command:${command.name}`,
      label: command.name,
      description: truncateCommandDescription(
        command.description ?? NO_DESCRIPTION,
        COMMAND_PALETTE.DESCRIPTION_LIMIT,
      ),
      icon: <SquareTerminal className="size-3.5" />,
      section: 'Pi extensions',
      trailing: `/${command.name}`,
      action: () => insertCommand(`/${command.name}`),
    }))
}
