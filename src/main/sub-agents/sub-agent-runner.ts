import { randomUUID } from 'node:crypto'
import { getMessageText } from '@shared/types/agent'
import { ConversationId, createSkipApprovalToken, SubAgentId } from '@shared/types/brand'
import type { Conversation } from '@shared/types/conversation'
import type { SupportedModelId } from '@shared/types/llm'
import type { AgentStreamChunk } from '@shared/types/stream'
import type { AgentPermissionMode, SpawnAgentInput, SubAgentResult } from '@shared/types/sub-agent'
import { formatErrorMessage } from '@shared/utils/node-error'
import { runAgent } from '../agent/agent-loop'
import { createLogger } from '../logger'
import type { ChatStreamOptions } from '../ports/chat-service'
import { pushContext } from '../tools/context-injection-buffer'
import { respondToPlan } from '../tools/plan-manager'
import { getAgentType, refreshCustomAgentTypes } from './agent-type-registry'
import { canStartBackground, startBackground } from './background-executor'
import { deliverPendingMessages, subscribe } from './message-bus'
import { emitSubAgentEvent } from './sub-agent-bridge'
import {
  getConversationSnapshot,
  getSubAgent,
  registerSubAgent,
  storeConversationSnapshot,
  updateSubAgent,
} from './sub-agent-registry'
import {
  addTeamMember,
  getTeam,
  loadPersistedTeam,
  persistTeamConfig,
  updateMemberStatus,
} from './team-manager'
import { cleanupWorktree, createWorktree, hasWorktreeChanges } from './worktree-manager'

const AGENT_ID_PREVIEW_LENGTH = 8
const BACKGROUND_OUTPUT_PREVIEW_LENGTH = 500
const PERMISSION_LEVEL_PLAN = 0
const PERMISSION_LEVEL_DEFAULT = 1
const PERMISSION_LEVEL_ACCEPT_EDITS = 2
const PERMISSION_LEVEL_DONT_ASK = 3
const PERMISSION_LEVEL_BYPASS_PERMISSIONS = 4

const logger = createLogger('sub-agent-runner')

/** Max sub-agent nesting depth. Bounds resource consumption — each level adds a full agent loop with LLM calls. */
const MAX_DEPTH = 3

export interface RunSubAgentParams {
  readonly input: SpawnAgentInput
  readonly parentConversationId: ConversationId
  readonly parentProjectPath: string
  readonly parentModel: SupportedModelId
  readonly parentPermissionMode: AgentPermissionMode
  readonly parentDepth: number
  readonly chatStream: (options: ChatStreamOptions) => AsyncIterable<AgentStreamChunk>
}

export async function runSubAgent(params: RunSubAgentParams): Promise<SubAgentResult> {
  const {
    input,
    parentConversationId,
    parentProjectPath,
    parentModel,
    parentPermissionMode,
    parentDepth,
  } = params

  // ── Validation ──
  const depth = parentDepth + 1
  if (depth > MAX_DEPTH) {
    throw new Error(
      `Sub-agent spawn depth exceeded (max ${String(MAX_DEPTH)}). Cannot spawn deeper.`,
    )
  }

  // Permission escalation prevention
  const effectiveMode = resolvePermissionMode(input.mode ?? 'default', parentPermissionMode)

  // Resolve agent type
  await refreshCustomAgentTypes(parentProjectPath)
  const agentType = getAgentType(input.agentType ?? 'general-purpose', parentProjectPath)
  if (!agentType) {
    throw new Error(`Unknown agent type: "${input.agentType ?? 'general-purpose'}"`)
  }

  // ── Resume check ──
  if (input.resume) {
    const existing = getSubAgent(input.resume)
    if (!existing) {
      throw new Error(`Cannot resume agent: ${input.resume} not found`)
    }
    // For resume, we continue with the same agentId
  }

  const agentId = input.resume ?? SubAgentId(randomUUID())
  // First 8 hex chars of UUID for human-readable default name; full ID preserved in registry
  const agentName = input.name ?? `${agentType.id}-${agentId.slice(0, AGENT_ID_PREVIEW_LENGTH)}`
  const conversationId = ConversationId(randomUUID())
  const model = input.model ?? parentModel

  // ── Worktree isolation ──
  let projectPath = parentProjectPath
  let worktreeBranch: string | undefined
  if (input.isolation === 'worktree') {
    const worktree = await createWorktree(parentProjectPath, agentName)
    projectPath = worktree.worktreePath
    worktreeBranch = worktree.branch
  }

  // ── Team registration ──
  if (input.teamName) {
    let team = getTeam(input.teamName)
    if (!team) {
      await loadPersistedTeam(parentProjectPath, input.teamName)
      team = getTeam(input.teamName)
    }
    if (!team) {
      throw new Error(`Team "${input.teamName}" not found. Create it first with teamCreate.`)
    }
    addTeamMember(input.teamName, {
      name: agentName,
      agentId,
      agentType: agentType.id,
      status: 'active',
    })
    await persistTeamConfig(parentProjectPath, input.teamName)
  }

  // ── Register sub-agent ──
  registerSubAgent({
    agentId,
    name: agentName,
    agentType: agentType.id,
    conversationId,
    parentConversationId,
    teamId: input.teamName,
    status: 'running',
    startedAt: Date.now(),
  })

  emitSubAgentEvent({
    agentId,
    agentName,
    teamId: input.teamName,
    eventType: 'started',
    timestamp: Date.now(),
    data: { agentType: agentType.id, depth },
  })

  // ── Build runner function ──
  const runnerFn = async (signal: AbortSignal): Promise<SubAgentResult> => {
    // Subscribe to plan approval responses from team lead
    const unsubscribe = input.teamName
      ? subscribe(agentName, (message) => {
          if (message.type === 'plan_approval_response') {
            respondToPlan(
              conversationId,
              message.approve
                ? { action: 'approve' }
                : { action: 'revise', feedback: message.content },
            )
          }
        })
      : undefined

    try {
      // Deliver any pending messages from team
      deliverPendingMessages(agentName, conversationId)

      // Build the system prompt addition
      const systemPromptSnippet = agentType.systemPromptAddition

      // Build conversation with prior messages if resuming
      const priorMessages = input.resume ? (getConversationSnapshot(input.resume) ?? []) : []

      const conversation: Conversation = {
        id: conversationId,
        title: input.description,
        projectPath,
        messages: [...priorMessages],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      // Prepare the payload
      const augmentedPrompt = [systemPromptSnippet, '', '---', '', input.prompt].join('\n')

      // Lazy import to avoid circular dependency during sub-agent startup.
      const { getSettings } = await import('../store/settings')
      const settings = getSettings()

      const skipApproval =
        effectiveMode === 'bypassPermissions' || effectiveMode === 'dontAsk'
          ? createSkipApprovalToken()
          : undefined

      let turnCount = 0
      let toolCallCount = 0

      const result = await runAgent({
        conversation,
        payload: {
          text: augmentedPrompt,
          qualityPreset: 'medium',
          attachments: [],
        },
        model,
        settings,
        chatStream: params.chatStream,
        skipApproval,
        maxTurns: input.maxTurns,
        onChunk: (chunk) => {
          if (chunk.type === 'STEP_STARTED') turnCount++
          if (chunk.type === 'TOOL_CALL_START') toolCallCount++
        },
        signal,
        subAgentContext: {
          agentId,
          agentName,
          agentType: agentType.id,
          teamId: input.teamName,
          permissionMode: effectiveMode,
          toolFilter: agentType.toolFilter,
          depth,
        },
      })

      // Store conversation snapshot for resume
      const allMessages = [...conversation.messages, ...result.newMessages]
      storeConversationSnapshot(agentId, allMessages)

      const outputText = getMessageText(result.finalMessage)

      // Worktree info
      let worktreeInfo: SubAgentResult['worktreeInfo']
      if (input.isolation === 'worktree' && worktreeBranch) {
        const hasChanges = await hasWorktreeChanges(projectPath)
        if (!hasChanges) {
          await cleanupWorktree(parentProjectPath, agentName)
          worktreeInfo = { path: projectPath, branch: worktreeBranch, hasChanges: false }
        } else {
          worktreeInfo = { path: projectPath, branch: worktreeBranch, hasChanges: true }
        }
      }

      const agentResult: SubAgentResult = {
        agentId,
        status: 'completed',
        output: outputText,
        turnCount,
        toolCallCount,
        worktreeInfo,
      }

      updateSubAgent(agentId, { status: 'completed', completedAt: Date.now(), result: agentResult })

      emitSubAgentEvent({
        agentId,
        agentName,
        teamId: input.teamName,
        eventType: 'completed',
        timestamp: Date.now(),
        data: { turnCount, toolCallCount },
      })

      if (input.teamName) {
        updateMemberStatus(input.teamName, agentId, 'idle')

        emitSubAgentEvent({
          agentId,
          agentName,
          teamId: input.teamName,
          eventType: 'idle',
          timestamp: Date.now(),
        })

        pushContext(
          parentConversationId,
          `<agent_notification type="idle" from="${agentName}">\nSub-agent "${agentName}" (${agentType.id}) has completed its turn and is now idle. Agent ID: ${agentId}\n</agent_notification>`,
        )
      }

      return agentResult
    } catch (error) {
      const isAborted = signal.aborted || (error instanceof Error && error.message === 'aborted')
      const resultStatus = isAborted ? ('cancelled' as const) : ('failed' as const)

      const failedResult: SubAgentResult = {
        agentId,
        status: resultStatus,
        output: isAborted ? 'Agent was cancelled.' : formatErrorMessage(error),
        turnCount: 0,
        toolCallCount: 0,
      }

      // SubAgentEntry has no 'cancelled' status — map both to 'failed'
      updateSubAgent(agentId, {
        status: 'failed',
        completedAt: Date.now(),
        result: failedResult,
      })

      emitSubAgentEvent({
        agentId,
        agentName,
        teamId: input.teamName,
        eventType: 'failed',
        timestamp: Date.now(),
        data: { reason: isAborted ? 'cancelled' : 'error' },
      })

      if (input.teamName) {
        updateMemberStatus(input.teamName, agentId, 'shutdown')
      }

      if (!isAborted) {
        logger.error('Sub-agent failed', {
          agentId,
          error: formatErrorMessage(error),
        })
      }

      return failedResult
    } finally {
      unsubscribe?.()
    }
  }

  // ── Background execution ──
  if (input.runInBackground) {
    if (!canStartBackground()) {
      throw new Error('Maximum concurrent background agents reached (4). Wait for one to complete.')
    }

    startBackground(agentId, runnerFn, (result) => {
      pushContext(
        parentConversationId,
        `<agent_notification type="background_completed" from="${agentName}">\nBackground agent "${agentName}" completed with status: ${result.status}.\nOutput: ${result.output.slice(0, BACKGROUND_OUTPUT_PREVIEW_LENGTH)}\n</agent_notification>`,
      )
      logger.info('Background sub-agent completed', {
        agentId,
        name: agentName,
        status: result.status,
      })
    })

    return {
      agentId,
      status: 'completed',
      output: `Background agent "${agentName}" (${agentType.id}) started. Agent ID: ${agentId}`,
      turnCount: 0,
      toolCallCount: 0,
    }
  }

  // ── Foreground execution ──
  const abortController = new AbortController()
  return runnerFn(abortController.signal)
}

/**
 * Resolve effective permission mode. Children cannot exceed parent's permission level.
 * Permission restrictiveness order: plan > default > acceptEdits > dontAsk > bypassPermissions
 */
function resolvePermissionMode(
  requested: AgentPermissionMode,
  parent: AgentPermissionMode,
): AgentPermissionMode {
  const levels: Record<AgentPermissionMode, number> = {
    plan: PERMISSION_LEVEL_PLAN,
    default: PERMISSION_LEVEL_DEFAULT,
    acceptEdits: PERMISSION_LEVEL_ACCEPT_EDITS,
    dontAsk: PERMISSION_LEVEL_DONT_ASK,
    bypassPermissions: PERMISSION_LEVEL_BYPASS_PERMISSIONS,
  }

  const parentLevel = levels[parent]
  const requestedLevel = levels[requested]

  // Child cannot exceed parent's permission level
  if (requestedLevel > parentLevel) {
    logger.warn('Permission escalation prevented', {
      requested,
      parent,
      effective: parent,
    })
    return parent
  }

  return requested
}
