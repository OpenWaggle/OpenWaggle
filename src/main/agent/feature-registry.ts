import { jsonObjectSchema } from '@shared/schemas/validation'
import type { AgentToolFilter } from '@shared/types/sub-agent'
import type { ServerTool } from '@tanstack/ai'
import { createLogger } from '../logger'
import { mcpToolsFeature } from '../mcp'
import { builtInTools } from '../tools/built-in-tools'
import { withoutApproval } from '../tools/without-approval'
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
  contextInjectionPromptFragment,
  coreBehaviorPromptFragment,
  executionModePromptFragment,
  orchestrateToolPromptFragment,
  planModeActivePromptFragment,
  planToolPromptFragment,
  projectContextPromptFragment,
  runtimeModelPromptFragment,
} from './system-prompt'

const SLICE_ARG_2 = 300
const SLICE_ARG_2_VALUE_200 = 200

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
      return parsed.slice(0, SLICE_ARG_2)
    }
    if (typeof parsed === 'object' && parsed !== null) {
      const result = jsonObjectSchema.safeParse(parsed)
      if (!result.success) {
        logger.debug('tool-error-parse-mismatch', {
          preview: String(parsed).slice(0, SLICE_ARG_2_VALUE_200),
        })
        return undefined
      }
      const record = result.data
      if (typeof record.error === 'string' && record.error.trim()) {
        return record.error.slice(0, SLICE_ARG_2)
      }
      if (typeof record.message === 'string' && record.message.trim()) {
        return record.message.slice(0, SLICE_ARG_2)
      }
      if (typeof record.text === 'string' && record.text.trim()) {
        return record.text.slice(0, SLICE_ARG_2)
      }
      logger.debug('tool-error-no-recognized-key', {
        keys: Object.keys(record),
      })
    }
  } catch {
    return result.slice(0, SLICE_ARG_2)
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
    planToolPromptFragment,
    orchestrateToolPromptFragment,
    contextInjectionPromptFragment,
  ],
}

const planModeFeature: AgentFeature = {
  id: 'core.plan-mode',
  isEnabled: (context) => !!context.planModeRequested,
  getPromptFragments: () => [planModeActivePromptFragment],
}

const builtInToolsFeature: AgentFeature = {
  id: 'core.tools',
  isEnabled: (context) => context.hasProject,
  getTools: () => builtInTools,
}

const trustedToolFeature: AgentFeature = {
  id: 'core.tool-trust',
  isEnabled: (context) => !!context.toolApprovals?.tools,
  filterTools: (tools, context) => {
    if (!context.toolApprovals?.tools) {
      return tools
    }

    const trustedTools = new Set<string>()
    if (context.toolApprovals.tools.writeFile?.trusted === true) {
      trustedTools.add('writeFile')
    }
    if (context.toolApprovals.tools.editFile?.trusted === true) {
      trustedTools.add('editFile')
    }

    if (trustedTools.size === 0) {
      return tools
    }

    return tools.map((tool) =>
      tool.needsApproval && trustedTools.has(tool.name ?? '')
        ? { ...tool, needsApproval: false }
        : tool,
    )
  },
}

const fullAccessApprovalBypassFeature: AgentFeature = {
  id: 'core.full-access-approval-bypass',
  isEnabled: (context) => context.settings.executionMode === 'full-access',
  filterTools: (tools) => withoutApproval(tools),
}

const executionModeFeature: AgentFeature = {
  id: 'core.execution-mode',
  getPromptFragments: () => [executionModePromptFragment],
}

const observabilityFeature: AgentFeature = {
  id: 'core.observability',
  getLifecycleHooks: () => [observabilityHook],
}

/**
 * Sub-agent tool filtering feature.
 * When a sub-agent context is present on the run context, applies the agent type's
 * tool filter and permission mode to restrict the available tool set.
 */
const subAgentToolsFeature: AgentFeature = {
  id: 'sub-agent.tools',
  isEnabled: (context) => !!context.subAgentContext,
  filterTools: (tools, context) => {
    if (!context.subAgentContext) return tools

    const { toolFilter, permissionMode } = context.subAgentContext

    // Apply permission mode first
    let filtered: ServerTool[]
    if (permissionMode === 'plan') {
      // Plan mode forces read-only tool set regardless of agent type
      const readOnlyNames = new Set([
        'readFile',
        'glob',
        'listFiles',
        'webFetch',
        'loadSkill',
        'loadAgents',
      ])
      filtered = tools.filter((t) => readOnlyNames.has(t.name ?? ''))
    } else {
      filtered = [...tools]
    }

    // Apply agent type tool filter
    if (permissionMode !== 'plan' && toolFilter) {
      filtered = applyToolFilter(filtered, toolFilter)
    }

    // Apply permission mode approval stripping
    if (permissionMode === 'dontAsk' || permissionMode === 'bypassPermissions') {
      return withoutApproval(filtered)
    }

    if (permissionMode === 'acceptEdits') {
      const editToolNames = new Set(['writeFile', 'editFile'])
      return filtered.map((t) =>
        t.needsApproval && editToolNames.has(t.name ?? '') ? { ...t, needsApproval: false } : t,
      )
    }

    return filtered
  },
}

function applyToolFilter(tools: readonly ServerTool[], filter: AgentToolFilter): ServerTool[] {
  if (filter.kind === 'all') return [...tools]
  if (filter.kind === 'allow') {
    const allowed = new Set(filter.names)
    return tools.filter((t) => allowed.has(t.name ?? ''))
  }
  if (filter.kind === 'deny') {
    const denied = new Set(filter.names)
    return tools.filter((t) => !denied.has(t.name ?? ''))
  }
  return [...tools]
}

const defaultFeatures: readonly AgentFeature[] = [
  standardsPromptFeature,
  corePromptFeature,
  planModeFeature,
  builtInToolsFeature,
  trustedToolFeature,
  fullAccessApprovalBypassFeature,
  mcpToolsFeature,
  executionModeFeature,
  observabilityFeature,
  subAgentToolsFeature,
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
