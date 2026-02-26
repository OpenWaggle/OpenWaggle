import { waggleConfigSchema } from '@shared/schemas/waggle'
import type { AgentSendPayload } from '@shared/types/agent'
import { isTextPart } from '@shared/types/agent'
import type { ConversationId } from '@shared/types/brand'
import type { WaggleConfig } from '@shared/types/waggle'
import { classifyAgentError, makeErrorInfo } from '../agent/error-classifier'
import { runWaggleSequential } from '../agent/waggle-coordinator'
import { createLogger } from '../logger'
import { withConversationLock } from '../store/conversation-lock'
import { getConversation, saveConversation } from '../store/conversations'
import { getSettings } from '../store/settings'
import {
  clearAgentPhase,
  emitStreamChunk,
  emitWaggleStreamChunk,
  emitWaggleTurnEvent,
} from '../utils/stream-bridge'
import { hydrateAttachmentSources } from './attachments-handler'
import { typedHandle, typedOn } from './typed-ipc'

const logger = createLogger('waggle-handler')

const activeWaggleRuns = new Map<ConversationId, AbortController>()

export function registerWaggleHandlers(): void {
  typedHandle(
    'agent:send-waggle-message',
    async (
      _event,
      conversationId: ConversationId,
      payload: AgentSendPayload,
      config: WaggleConfig,
    ) => {
      // Validate config at IPC boundary
      const parseResult = waggleConfigSchema.safeParse(config)
      if (!parseResult.success) {
        emitStreamChunk(conversationId, {
          type: 'RUN_ERROR',
          timestamp: Date.now(),
          error: { message: 'Invalid Waggle mode configuration', code: 'validation-error' },
        })
        return
      }

      // Cancel any existing Waggle run for this conversation.
      const existing = activeWaggleRuns.get(conversationId)
      if (existing) {
        existing.abort()
        activeWaggleRuns.delete(conversationId)
        clearAgentPhase(conversationId)
      }

      const abortController = new AbortController()
      activeWaggleRuns.set(conversationId, abortController)

      const settings = getSettings()
      const conversation = await getConversation(conversationId)

      if (!conversation) {
        const errorInfo = makeErrorInfo('conversation-not-found', 'Conversation not found')
        emitStreamChunk(conversationId, {
          type: 'RUN_ERROR',
          timestamp: Date.now(),
          error: { message: errorInfo.userMessage, code: errorInfo.code },
        })
        activeWaggleRuns.delete(conversationId)
        return
      }

      // Waggle mode requires a project because agents need tool access.
      if (!conversation.projectPath) {
        emitStreamChunk(conversationId, {
          type: 'RUN_ERROR',
          timestamp: Date.now(),
          error: {
            message: 'Please select a project folder before starting Waggle mode.',
            code: 'no-project',
          },
        })
        activeWaggleRuns.delete(conversationId)
        return
      }

      // Auto-title on first message
      if (conversation.title === 'New thread' && conversation.messages.length === 0) {
        const trimmed = payload.text.trim()
        if (trimmed) {
          const provisionalTitle = trimmed.slice(0, 60) + (trimmed.length > 60 ? '...' : '')
          await saveConversation({ ...conversation, title: provisionalTitle })
        }
      }

      try {
        const hydratedPayload = {
          ...payload,
          attachments: await hydrateAttachmentSources(payload.attachments),
        }

        // Emit a single RUN_STARTED envelope for the entire Waggle run.
        // Individual per-turn RUN_STARTED/RUN_FINISHED are filtered below so
        // the TanStack adapter treats the whole collaboration as one run.
        emitStreamChunk(conversationId, {
          type: 'RUN_STARTED',
          timestamp: Date.now(),
          runId: `waggle-${conversationId}`,
        })

        // Track which turn we last emitted chunks for.
        // When a new turn starts, inject a synthetic _turnBoundary tool call
        // so TanStack creates a separate text part per turn (prevents text wiping).
        let lastEmittedTurn = -1

        const result = await runWaggleSequential({
          conversationId,
          conversation,
          payload: hydratedPayload,
          config,
          settings,
          signal: abortController.signal,
          onStreamChunk: (chunk, meta) => {
            // Emit on the dedicated Waggle metadata channel.
            emitWaggleStreamChunk(conversationId, chunk, meta)

            // Filter ALL per-turn terminal events. The envelope emits its own
            // RUN_STARTED/RUN_FINISHED around the entire collaboration.
            if (
              chunk.type === 'RUN_STARTED' ||
              chunk.type === 'RUN_FINISHED' ||
              chunk.type === 'RUN_ERROR'
            ) {
              return
            }

            // When a new turn starts (turn 1+), inject a _turnBoundary tool call.
            // This creates a non-text part in the UIMessage so TanStack's
            // updateTextPart() pushes a NEW TextPart instead of replacing.
            if (meta.turnNumber > lastEmittedTurn) {
              if (meta.turnNumber > 0) {
                const boundaryId = meta.isSynthesis
                  ? 'turn-boundary-synthesis'
                  : `turn-boundary-${String(meta.turnNumber)}`
                const boundaryMeta = JSON.stringify({
                  agentIndex: meta.agentIndex,
                  agentLabel: meta.agentLabel,
                  agentColor: meta.agentColor,
                  agentModel: meta.agentModel,
                  turnNumber: meta.turnNumber,
                  ...(meta.isSynthesis ? { isSynthesis: true } : {}),
                })
                emitStreamChunk(conversationId, {
                  type: 'TOOL_CALL_START',
                  timestamp: Date.now(),
                  toolCallId: boundaryId,
                  toolName: '_turnBoundary',
                })
                emitStreamChunk(conversationId, {
                  type: 'TOOL_CALL_END',
                  timestamp: Date.now(),
                  toolCallId: boundaryId,
                  toolName: '_turnBoundary',
                  result: boundaryMeta,
                  input: {},
                })
              }
              lastEmittedTurn = meta.turnNumber
            }

            emitStreamChunk(conversationId, chunk)
          },
          onTurnEvent: (event) => {
            emitWaggleTurnEvent(conversationId, event)
          },
        })

        if (abortController.signal.aborted || result.newMessages.length === 0) {
          // Emit terminal RUN_FINISHED even for aborted runs so the adapter exits
          emitStreamChunk(conversationId, {
            type: 'RUN_FINISHED',
            timestamp: Date.now(),
            runId: `waggle-${conversationId}`,
            finishReason: 'stop',
          })
          return
        }

        // Surface error when all turns failed (e.g. insufficient credits).
        // The coordinator bails early and returns lastError with zero useful turns.
        const assistantCount = result.newMessages.filter((m) => m.role === 'assistant').length
        if (assistantCount === 0 && result.lastError) {
          const classified = classifyAgentError(new Error(result.lastError))
          emitStreamChunk(conversationId, {
            type: 'RUN_ERROR',
            timestamp: Date.now(),
            error: { message: classified.userMessage, code: classified.code },
          })
          emitStreamChunk(conversationId, {
            type: 'RUN_FINISHED',
            timestamp: Date.now(),
            runId: `waggle-${conversationId}`,
            finishReason: 'stop',
          })
          return
        }

        try {
          await withConversationLock(conversationId, async () => {
            const latestConversation = await getConversation(conversationId)
            if (!latestConversation) return

            const updatedMessages = [...latestConversation.messages, ...result.newMessages]

            let title = latestConversation.title
            if (updatedMessages.length <= 3 && title === 'New thread') {
              const firstUserMsg = updatedMessages.find((m) => m.role === 'user')
              if (firstUserMsg) {
                const text = firstUserMsg.parts
                  .filter(isTextPart)
                  .map((p) => p.text)
                  .join(' ')
                title = text.slice(0, 60) + (text.length > 60 ? '...' : '')
              }
            }

            await saveConversation({
              ...latestConversation,
              title,
              messages: updatedMessages,
              waggleConfig: config,
            })
          })
        } catch (persistError) {
          logger.error('Failed to persist Waggle conversation', {
            conversationId,
            error: persistError instanceof Error ? persistError.message : String(persistError),
          })
        }

        // Emit terminal RUN_FINISHED so the TanStack adapter exits cleanly
        emitStreamChunk(conversationId, {
          type: 'RUN_FINISHED',
          timestamp: Date.now(),
          runId: `waggle-${conversationId}`,
          finishReason: 'stop',
        })
      } catch (err) {
        if (!(err instanceof Error && err.message === 'aborted')) {
          const classified = classifyAgentError(err)
          emitStreamChunk(conversationId, {
            type: 'RUN_ERROR',
            timestamp: Date.now(),
            error: { message: classified.userMessage, code: classified.code },
          })
          emitStreamChunk(conversationId, {
            type: 'RUN_FINISHED',
            timestamp: Date.now(),
            runId: `waggle-${conversationId}`,
            finishReason: 'stop',
          })
        }
      } finally {
        activeWaggleRuns.delete(conversationId)
      }
    },
  )

  typedOn('agent:cancel-waggle', (_event, conversationId: ConversationId) => {
    const controller = activeWaggleRuns.get(conversationId)
    if (controller) {
      controller.abort()
      activeWaggleRuns.delete(conversationId)
    }
    clearAgentPhase(conversationId)
  })
}
