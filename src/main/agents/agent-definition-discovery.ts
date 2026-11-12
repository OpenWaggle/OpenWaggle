import { listAgentDefinitions, searchAgentDefinitions } from './agent-definition-catalog'

const DEFAULT_AGENT_DEFINITION_RESULTS = 50

/** A discovery limit that keeps every definition, for callers that filter before they cut. */
export const ALL_AGENT_DEFINITIONS = Number.POSITIVE_INFINITY

/** A definition stays on unless the project's toggle turns it off; an unknown name is on. */
export function agentDefinitionEnabled(
  enabledByName: Readonly<Partial<Record<string, boolean>>>,
  name: string,
) {
  return enabledByName[name] !== false
}

/**
 * Agent-definition discovery as the hive tool's `agent_definitions_list` and
 * `agent_definitions_search` and the `openwaggle_hive` MCP operations of the same name answer it:
 * names and descriptions only, never instructions. Definitions turned off for the project are
 * left out when their toggles are known.
 */
export async function discoverAgentDefinitions(input: {
  readonly projectPath: string
  readonly query?: string
  readonly limit?: number
  readonly enabledByName?: Readonly<Partial<Record<string, boolean>>>
  readonly userHome?: string
}) {
  const location = {
    projectPath: input.projectPath,
    ...(input.userHome ? { userHome: input.userHome } : {}),
  }
  const definitions =
    input.query === undefined
      ? await listAgentDefinitions(location)
      : await searchAgentDefinitions({ ...location, query: input.query })
  const enabledByName = input.enabledByName ?? {}
  return {
    definitions: definitions
      .filter((item) => agentDefinitionEnabled(enabledByName, item.name))
      .slice(0, input.limit ?? DEFAULT_AGENT_DEFINITION_RESULTS)
      .map((item) => ({
        name: item.name,
        description: item.description,
        scope: item.scope,
        valid: !item.loadError,
        ...(item.loadError ? { diagnostic: item.loadError } : {}),
      })),
  }
}
