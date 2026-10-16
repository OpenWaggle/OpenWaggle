import type { AgentExtensionCommand } from '@shared/types/extension-command'

/**
 * The extension commands each Session's latest Run had. A Run loads extensions a read of the
 * Session's file does not; the slash menu lists their commands from here. Pi's MCP extension is one
 * of them, but its `/mcp` is left out: MCP is managed in Settings > MCP
 * (`mcp-openwaggle-surface.ts`).
 */
const runCommandsBySession = new Map<string, readonly AgentExtensionCommand[]>()

export function rememberRunExtensionCommands(
  sessionId: string,
  commands: readonly AgentExtensionCommand[],
) {
  runCommandsBySession.set(sessionId, commands)
}

export function forgetRunExtensionCommands(sessionId: string) {
  runCommandsBySession.delete(sessionId)
}

/** `commands`, then those of the Session's latest Run that `commands` does not name. */
export function withRunExtensionCommands(
  sessionId: string,
  commands: readonly AgentExtensionCommand[],
): AgentExtensionCommand[] {
  const named = new Set(commands.map((command) => command.name))
  const runOnly = (runCommandsBySession.get(sessionId) ?? []).filter(
    (command) => !named.has(command.name),
  )
  return [...commands, ...runOnly]
}
