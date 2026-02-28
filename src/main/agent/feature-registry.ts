import { jsonObjectSchema } from '@shared/schemas/validation'
import { createLogger } from '../logger'
import { mcpToolsFeature } from '../mcp'
import { builtInTools } from '../tools/built-in-tools'
import type {
  AgentFeature,
  AgentLifecycleHook,
  AgentRunContext,
  AgentRunSummary,
  AgentToolCallStartEvent,
} from './runtime-types'
import {
  activeSkillsPromptFragment,
  agentsEntryPromptFragment,
  scopedAgentsPromptFragment,
  skillCatalogPromptFragment,
} from './standards-prompt'
import {
  coreBehaviorPromptFragment,
  executionModePromptFragment,
  projectContextPromptFragment,
  runtimeModelPromptFragment,
} from './system-prompt'

const logger = createLogger('agent-run')

interface AgentFeatureFlags {
  readonly [featureId: string]: boolean
}

const defaultFeatureFlags: AgentFeatureFlags = {
  'standards.prompt': true,
  'core.prompt': true,
  'core.tools': true,
  'core.execution-mode': true,
  'core.observability': true,
  'mcp.tools': true,
}

const observabilityHook: AgentLifecycleHook = {
  id: 'core.observability.logger',
  onRunStart: (context) => {
    logger.info('run-start', {
      runId: context.runId,
      conversationId: context.conversation.id,
      model: context.model,
      provider: context.provider.id,
      executionMode: context.settings.executionMode,
      selectedSkills: context.standards?.activation.selectedSkillIds ?? [],
      resolvedAgentsFiles: context.standards?.agentsResolvedFiles ?? [],
      standardsWarnings: context.standards?.warnings ?? [],
    })
  },
  onToolCallStart: (context, event) => {
    logToolStart(context, event)
  },
  onToolCallEnd: (context, event) => {
    const errorSummary = event.isError ? summarizeToolError(event.result) : undefined
    logger.info('tool-call-end', {
      runId: context.runId,
      conversationId: context.conversation.id,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      durationMs: event.durationMs,
      isError: event.isError,
      error: errorSummary,
    })
  },
  onRunError: (context, error) => {
    logger.error('run-error', {
      runId: context.runId,
      conversationId: context.conversation.id,
      message: error.message,
    })
  },
  onRunComplete: (context, summary) => {
    logRunComplete(context, summary)
  },
}

function logToolStart(context: AgentRunContext, event: AgentToolCallStartEvent): void {
  logger.info('tool-call-start', {
    runId: context.runId,
    conversationId: context.conversation.id,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
  })
}

function logRunComplete(context: AgentRunContext, summary: AgentRunSummary): void {
  logger.info('run-complete', {
    runId: context.runId,
    conversationId: context.conversation.id,
    promptFragments: summary.promptFragmentIds,
    stageDurationsMs: summary.stageDurationsMs,
    toolCalls: summary.toolCalls,
    toolErrors: summary.toolErrors,
    selectedSkillIds: summary.selectedSkillIds ?? [],
    dynamicallyLoadedSkillIds: summary.dynamicallyLoadedSkillIds ?? [],
    resolvedAgentsFiles: summary.resolvedAgentsFiles ?? [],
    dynamicallyLoadedAgentsScopes: summary.dynamicallyLoadedAgentsScopes ?? [],
    standardsWarnings: summary.standardsWarnings ?? [],
  })
}

function summarizeToolError(result: string | undefined): string | undefined {
  if (!result) return undefined

  try {
    const parsed: unknown = JSON.parse(result)
    if (typeof parsed === 'string') {
      return parsed.slice(0, 300)
    }
    if (typeof parsed === 'object' && parsed !== null) {
      const result = jsonObjectSchema.safeParse(parsed)
      if (!result.success) return undefined
      const record = result.data
      if (typeof record.error === 'string' && record.error.trim()) {
        return record.error.slice(0, 300)
      }
      if (typeof record.message === 'string' && record.message.trim()) {
        return record.message.slice(0, 300)
      }
      if (typeof record.text === 'string' && record.text.trim()) {
        return record.text.slice(0, 300)
      }
    }
  } catch {
    return result.slice(0, 300)
  }

  return undefined
}

const standardsPromptFeature: AgentFeature = {
  id: 'standards.prompt',
  getPromptFragments: () => [
    agentsEntryPromptFragment,
    scopedAgentsPromptFragment,
    skillCatalogPromptFragment,
    activeSkillsPromptFragment,
  ],
}

const corePromptFeature: AgentFeature = {
  id: 'core.prompt',
  getPromptFragments: () => [
    coreBehaviorPromptFragment,
    runtimeModelPromptFragment,
    projectContextPromptFragment,
  ],
}

const builtInToolsFeature: AgentFeature = {
  id: 'core.tools',
  isEnabled: (context) => context.hasProject,
  getTools: () => builtInTools,
}

const executionModeFeature: AgentFeature = {
  id: 'core.execution-mode',
  getPromptFragments: () => [executionModePromptFragment],
}

const observabilityFeature: AgentFeature = {
  id: 'core.observability',
  getLifecycleHooks: () => [observabilityHook],
}

const defaultFeatures: readonly AgentFeature[] = [
  standardsPromptFeature,
  corePromptFeature,
  builtInToolsFeature,
  mcpToolsFeature,
  executionModeFeature,
  observabilityFeature,
]

export function getAgentFeatureFlags(): AgentFeatureFlags {
  return defaultFeatureFlags
}

export function getActiveAgentFeatures(context: AgentRunContext): AgentFeature[] {
  const flags = getAgentFeatureFlags()

  return defaultFeatures.filter((feature) => {
    if (flags[feature.id] === false) {
      return false
    }

    return feature.isEnabled ? feature.isEnabled(context) : true
  })
}

export function getFeaturePromptFragments(
  context: AgentRunContext,
  features: readonly AgentFeature[],
) {
  return features.flatMap((feature) => feature.getPromptFragments?.(context) ?? [])
}

export function getFeatureLifecycleHooks(
  context: AgentRunContext,
  features: readonly AgentFeature[],
): AgentLifecycleHook[] {
  return features.flatMap((feature) => feature.getLifecycleHooks?.(context) ?? [])
}
