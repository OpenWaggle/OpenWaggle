import * as Effect from 'effect/Effect'
import { agentDefinitionTogglesForProject } from './agents/agent-definition-toggle-settings'
import { SettingsService } from './services/settings-service'

export type AgentDefinitionToggleLoader = (
  projectPath: string,
) => Promise<Readonly<Record<string, boolean>>>

/**
 * The Agent definitions turned on or off for one project, from the same Settings the Host reads
 * for a Run and for spawn and launch. CLI and MCP server processes read Settings in-process, as
 * `openwaggle agents` and `openwaggle mcp` already do.
 */
export const loadAgentDefinitionTogglesForProject: AgentDefinitionToggleLoader = async (
  projectPath,
) => {
  const { installPiRuntimeIntegration } = await import('./runtime-pi-integration')
  installPiRuntimeIntegration()
  const { runAppEffect } = await import('./runtime')
  const settings = await runAppEffect(Effect.flatMap(SettingsService, (service) => service.get()))
  return agentDefinitionTogglesForProject(settings.agentDefinitionTogglesByProject, projectPath)
}
