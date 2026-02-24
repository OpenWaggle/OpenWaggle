import type { ServerTool } from '@tanstack/ai'
import type { AgentFeature, AgentRunContext } from '../agent/runtime-types'

function toolName(tool: ServerTool): string {
  return tool.name ?? 'unknown'
}

function assertUniqueToolNames(tools: readonly ServerTool[]): void {
  const seenNames = new Set<string>()

  for (const tool of tools) {
    const name = toolName(tool)
    if (seenNames.has(name)) {
      throw new Error(`Duplicate tool registration for "${name}"`)
    }
    seenNames.add(name)
  }
}

/**
 * Resolve tools from active features and then apply feature-level filters.
 * This keeps tool composition extensible without hardcoding lists in the agent loop.
 */
export function getServerTools(
  context: AgentRunContext,
  features: readonly AgentFeature[],
): ServerTool[] {
  const providedTools = features.flatMap((feature) => feature.getTools?.(context) ?? [])

  const resolvedTools = features.reduce<ServerTool[]>(
    (currentTools, feature) => {
      if (!feature.filterTools) {
        return currentTools
      }
      return [...feature.filterTools(currentTools, context)]
    },
    [...providedTools],
  )

  assertUniqueToolNames(resolvedTools)

  return resolvedTools
}
