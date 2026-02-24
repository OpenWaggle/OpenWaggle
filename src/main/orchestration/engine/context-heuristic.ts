import type { OpenHiveChildContextOptions } from './types'

export interface ContextHeuristicDecision {
  readonly includeConversationSummary: boolean
  readonly maxContextTokens: number
}

const DEFAULT_MAX_CONTEXT_TOKENS = 1500

const CONTEXT_HEAVY_KINDS = new Set(['analysis', 'synthesis', 'repo-edit'])

export function resolveChildContextHeuristic(
  options: OpenHiveChildContextOptions,
): ContextHeuristicDecision {
  const includeConversationSummary =
    options.needsConversationContext === true ||
    (options.taskKind ? CONTEXT_HEAVY_KINDS.has(options.taskKind) : false)

  const maxContextTokens = Math.max(1, options.maxContextTokens ?? DEFAULT_MAX_CONTEXT_TOKENS)

  return {
    includeConversationSummary,
    maxContextTokens,
  }
}
