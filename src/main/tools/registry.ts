import type { ServerTool } from '@tanstack/ai'
import type { AgentFeature, AgentRunContext } from '../agent/runtime-types'

/**
 * Resolve tools from active features and then apply feature-level filters.
 * This keeps tool composition extensible without hardcoding lists in the agent loop.
 */
export function getServerTools(
  context: AgentRunContext,
  features: readonly AgentFeature[],
): ServerTool[] {
  const providedTools = features.flatMap((feature) => feature.getTools?.(context) ?? [])

  return features.reduce<ServerTool[]>(
    (currentTools, feature) => {
      if (!feature.filterTools) {
        return currentTools
      }
      return [...feature.filterTools(currentTools, context)]
    },
    [...providedTools],
  )
}
