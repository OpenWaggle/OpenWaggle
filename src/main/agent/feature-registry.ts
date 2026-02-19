import type { ServerTool } from '@tanstack/ai'
import { builtInTools } from '../tools/built-in-tools'
import type {
  AgentFeature,
  AgentLifecycleHook,
  AgentRunContext,
  AgentRunSummary,
  AgentToolCallStartEvent,
} from './runtime-types'
import {
  coreBehaviorPromptFragment,
  executionModePromptFragment,
  projectContextPromptFragment,
  runtimeModelPromptFragment,
} from './system-prompt'

interface AgentFeatureFlags {
  readonly [featureId: string]: boolean
}

const defaultFeatureFlags: AgentFeatureFlags = {
  'core.prompt': true,
  'core.tools': true,
  'core.execution-mode': true,
  'core.observability': true,
}

function isApprovalRequiredTool(tool: ServerTool): boolean {
  const maybeApprovalTool = tool as ServerTool & { readonly needsApproval?: boolean }
  return maybeApprovalTool.needsApproval === true
}

const observabilityHook: AgentLifecycleHook = {
  id: 'core.observability.logger',
  onRunStart: (context) => {
    console.info(
      '[agent-run]',
      JSON.stringify({
        event: 'run-start',
        runId: context.runId,
        conversationId: context.conversation.id,
        model: context.model,
        provider: context.provider.id,
        executionMode: context.settings.executionMode,
      }),
    )
  },
  onToolCallStart: (context, event) => {
    logToolStart(context, event)
  },
  onToolCallEnd: (context, event) => {
    console.info(
      '[agent-run]',
      JSON.stringify({
        event: 'tool-call-end',
        runId: context.runId,
        conversationId: context.conversation.id,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        durationMs: event.durationMs,
        isError: event.isError,
      }),
    )
  },
  onRunError: (context, error) => {
    console.error(
      '[agent-run]',
      JSON.stringify({
        event: 'run-error',
        runId: context.runId,
        conversationId: context.conversation.id,
        message: error.message,
      }),
    )
  },
  onRunComplete: (context, summary) => {
    logRunComplete(context, summary)
  },
}

function logToolStart(context: AgentRunContext, event: AgentToolCallStartEvent): void {
  console.info(
    '[agent-run]',
    JSON.stringify({
      event: 'tool-call-start',
      runId: context.runId,
      conversationId: context.conversation.id,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
    }),
  )
}

function logRunComplete(context: AgentRunContext, summary: AgentRunSummary): void {
  console.info(
    '[agent-run]',
    JSON.stringify({
      event: 'run-complete',
      runId: context.runId,
      conversationId: context.conversation.id,
      promptFragments: summary.promptFragmentIds,
      stageDurationsMs: summary.stageDurationsMs,
      toolCalls: summary.toolCalls,
      toolErrors: summary.toolErrors,
    }),
  )
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
  filterTools: (tools, context) => {
    if (context.settings.executionMode !== 'sandbox') {
      return tools
    }

    return tools.filter((tool) => !isApprovalRequiredTool(tool))
  },
}

const observabilityFeature: AgentFeature = {
  id: 'core.observability',
  getLifecycleHooks: () => [observabilityHook],
}

const defaultFeatures: readonly AgentFeature[] = [
  corePromptFeature,
  builtInToolsFeature,
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
