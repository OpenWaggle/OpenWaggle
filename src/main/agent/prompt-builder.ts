import type { ServerTool } from '@tanstack/ai'
import { getServerTools } from '../tools/registry'
import { withoutApproval } from '../tools/without-approval'
import {
  getActiveAgentFeatures,
  getFeatureLifecycleHooks,
  getFeaturePromptFragments,
} from './feature-registry'
import { buildSystemPrompt } from './prompt-pipeline'
import type { AgentFeature, AgentLifecycleHook, AgentRunContext } from './runtime-types'

export interface BuiltAgentPrompt {
  readonly systemPrompt: string
  readonly tools: readonly ServerTool[]
  readonly promptFragmentIds: readonly string[]
  readonly features: readonly AgentFeature[]
  readonly hooks: readonly AgentLifecycleHook[]
}

/**
 * Resolve features, compose system prompt, and gather tools.
 * Extracted from `runAgent()` for testability.
 */
export function buildAgentPrompt(
  runContext: AgentRunContext,
  skipApproval: boolean,
): BuiltAgentPrompt {
  const features = getActiveAgentFeatures(runContext)
  const hooks = getFeatureLifecycleHooks(runContext, features)

  const fragments = getFeaturePromptFragments(runContext, features)
  const { prompt: systemPrompt, fragmentIds } = buildSystemPrompt(runContext, fragments)

  let tools = getServerTools(runContext, features)

  if (skipApproval) {
    tools = withoutApproval(tools)
  }

  return {
    systemPrompt,
    tools,
    promptFragmentIds: fragmentIds,
    features,
    hooks,
  }
}
