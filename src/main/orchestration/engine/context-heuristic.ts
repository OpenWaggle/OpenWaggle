import { CONTEXT_BUDGET } from '@shared/constants/orchestration-config'
import type { OpenWaggleChildContextOptions } from './types'

export interface ContextHeuristicDecision {
  readonly includeConversationSummary: boolean
  readonly maxContextTokens: number
}

const CONTEXT_HEAVY_KINDS = new Set(['analysis', 'synthesis', 'repo-edit'])

export function resolveChildContextHeuristic(
  options: OpenWaggleChildContextOptions,
): ContextHeuristicDecision {
  const includeConversationSummary =
    options.needsConversationContext === true ||
    (options.taskKind ? CONTEXT_HEAVY_KINDS.has(options.taskKind) : false)

  const maxContextTokens = Math.max(1, options.maxContextTokens ?? CONTEXT_BUDGET.MAX_TOKENS)

  return {
    includeConversationSummary,
    maxContextTokens,
  }
}
