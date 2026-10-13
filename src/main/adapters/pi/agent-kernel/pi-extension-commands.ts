import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type { AgentExtensionCommand } from '@shared/types/extension-command'

/** The commands a Pi session's extensions register, by the name Pi invokes each with. */
export function piExtensionCommands(
  session: Pick<AgentSession, 'extensionRunner'>,
): AgentExtensionCommand[] {
  return session.extensionRunner.getRegisteredCommands().map((command) => ({
    name: command.invocationName,
    ...(command.description ? { description: command.description } : {}),
  }))
}
