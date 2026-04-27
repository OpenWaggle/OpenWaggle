/**
 * AgentRunService — application-layer coordination for agent message execution.
 *
 * Extracts business logic from agent-handler.ts into Effect programs
 * that depend on hexagonal ports. The handler retains transport concerns
 * (abort controllers, active run tracking, stream buffers, IPC emission).
 */

import type { AgentSendPayload, HydratedAgentSendPayload, Message } from '@shared/types/agent'
import { type ConversationId, SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { AgentTransportEvent } from '@shared/types/stream'
import * as Effect from 'effect/Effect'
import { classifyAgentError, makeErrorInfo } from '../agent/error-classifier'
import { AgentKernelService } from '../ports/agent-kernel-service'
import { ProviderService } from '../ports/provider-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionRepository } from '../ports/session-repository'
import { SettingsService } from '../services/settings-service'
import { assignSessionTitleFromUserText, hydratePayloadAttachments } from './run-handler-utils'

// ─── Types ───────────────────────────────────────────────────

export interface AgentRunInput {
  readonly conversationId: ConversationId
  readonly payload: AgentSendPayload
  readonly model: SupportedModelId
  readonly signal: AbortSignal
  readonly onEvent: (event: AgentTransportEvent) => void
}

interface AgentRunResultBase {
  readonly assignedTitle?: string
}

export type AgentRunResult =
  | (AgentRunResultBase & {
      readonly outcome: 'success'
      readonly newMessages: readonly Message[]
    })
  | (AgentRunResultBase & { readonly outcome: 'aborted' })
  | (AgentRunResultBase & {
      readonly outcome: 'invalid-model'
      readonly message: string
      readonly code: string
    })
  | (AgentRunResultBase & {
      readonly outcome: 'not-found'
      readonly message: string
      readonly code: string
    })
  | (AgentRunResultBase & {
      readonly outcome: 'error'
      readonly message: string
      readonly code: string
      readonly transportEmitted?: boolean
    })

// ─── Service Functions ───────────────────────────────────────

/**
 * Validate preconditions, execute the agent run, and persist results.
 * Returns a discriminated union describing the outcome.
 *
 * The handler reads the outcome and performs transport actions
 * (IPC emission, stream buffer, active run cleanup).
 */
export function executeAgentRun(input: AgentRunInput) {
  let assignedTitle: string | undefined

  return Effect.gen(function* () {
    const { conversationId, payload, model, signal, onEvent } = input

    // ─── Fetch conversation ──────────────────────────────
    const conversationRepo = yield* SessionProjectionRepository
    const conversation = yield* conversationRepo.getOptional(conversationId)
    if (!conversation) {
      const errorInfo = makeErrorInfo('conversation-not-found', 'Conversation not found')
      return { outcome: 'not-found' as const, message: errorInfo.userMessage, code: errorInfo.code }
    }

    // ─── Validate model against the project-scoped Pi registry ─────────────
    const providerService = yield* ProviderService
    const isKnown = yield* providerService.isKnownModel(model, conversation.projectPath)
    if (!isKnown) {
      return {
        outcome: 'invalid-model' as const,
        message: `Unknown model: ${model}`,
        code: 'invalid-model',
      }
    }

    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()
    const skillToggles = conversation.projectPath
      ? settings.skillTogglesByProject[conversation.projectPath]
      : undefined

    const nextTitle = yield* assignSessionTitleFromUserText(
      conversationId,
      conversation,
      payload.text,
    )
    if (nextTitle) {
      assignedTitle = nextTitle
    }

    // ─── Hydrate attachments ─────────────────────────────
    const hydratedPayload: HydratedAgentSendPayload = {
      ...payload,
      attachments: yield* Effect.promise(() => hydratePayloadAttachments(payload.attachments)),
    }

    // ─── Execute Pi-backed agent kernel ──────────────────
    const agentKernel = yield* AgentKernelService
    const agentResult = yield* agentKernel.run({
      conversation,
      payload: hydratedPayload,
      model,
      signal,
      onEvent,
      ...(skillToggles ? { skillToggles } : {}),
    })

    const sessionRepo = yield* SessionRepository
    yield* sessionRepo.persistSnapshot({
      sessionId: SessionId(String(conversationId)),
      nodes: agentResult.sessionSnapshot.nodes,
      activeNodeId: agentResult.sessionSnapshot.activeNodeId,
      piSessionId: agentResult.piSessionId,
      piSessionFile: agentResult.piSessionFile,
    })

    if (agentResult.terminalError) {
      const classified = classifyAgentError(new Error(agentResult.terminalError))
      return {
        outcome: 'error' as const,
        message: classified.userMessage,
        code: classified.code,
        transportEmitted: true,
        ...(assignedTitle ? { assignedTitle } : {}),
      }
    }

    if (signal.aborted || agentResult.aborted || agentResult.newMessages.length === 0) {
      return { outcome: 'aborted' as const, ...(assignedTitle ? { assignedTitle } : {}) }
    }

    return {
      outcome: 'success' as const,
      newMessages: agentResult.newMessages,
      ...(assignedTitle ? { assignedTitle } : {}),
    }
  }).pipe(
    Effect.catchAll((err): Effect.Effect<AgentRunResult> => {
      if (err instanceof Error && err.message === 'aborted') {
        return Effect.succeed({
          outcome: 'aborted',
          ...(assignedTitle ? { assignedTitle } : {}),
        })
      }
      const classified = classifyAgentError(err)
      return Effect.succeed({
        outcome: 'error' as const,
        message: classified.userMessage,
        code: classified.code,
        ...(assignedTitle ? { assignedTitle } : {}),
      })
    }),
  )
}
