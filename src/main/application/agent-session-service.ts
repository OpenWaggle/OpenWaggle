import type { ConversationId, SessionNodeId } from '@shared/types/brand'
import { SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { AgentTransportEvent } from '@shared/types/stream'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import {
  type AgentKernelNavigateTreeResult,
  AgentKernelService,
  isAgentKernelMissingEntryError,
} from '../ports/agent-kernel-service'
import { ProviderService } from '../ports/provider-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionRepository } from '../ports/session-repository'
import { SettingsService } from '../services/settings-service'

const logger = createLogger('agent-session-service')

type NavigateTreeOutcome =
  | { readonly type: 'success'; readonly result: AgentKernelNavigateTreeResult }
  | { readonly type: 'missing-entry' }

export interface AgentSessionCommandInput {
  readonly conversationId: ConversationId
  readonly model: SupportedModelId
}

export interface AgentSessionCompactInput extends AgentSessionCommandInput {
  readonly customInstructions?: string
  readonly signal?: AbortSignal
  readonly onEvent?: (event: AgentTransportEvent) => void
}

export interface AgentSessionNavigateTreeInput extends AgentSessionCommandInput {
  readonly targetNodeId: SessionNodeId
  readonly summarize?: boolean
  readonly customInstructions?: string
}

export function getAgentContextUsage(input: AgentSessionCommandInput) {
  return Effect.gen(function* () {
    const conversationRepo = yield* SessionProjectionRepository
    const conversation = yield* conversationRepo.getOptional(input.conversationId)
    if (!conversation) {
      return null
    }

    const providerService = yield* ProviderService
    const isKnown = yield* providerService.isKnownModel(input.model, conversation.projectPath)
    if (!isKnown) {
      return null
    }

    const agentKernel = yield* AgentKernelService
    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()
    const skillToggles = conversation.projectPath
      ? settings.skillTogglesByProject[conversation.projectPath]
      : undefined
    return yield* agentKernel.getContextUsage({
      conversation,
      model: input.model,
      ...(skillToggles ? { skillToggles } : {}),
    })
  })
}

export function compactAgentSession(input: AgentSessionCompactInput) {
  return Effect.gen(function* () {
    const conversationRepo = yield* SessionProjectionRepository
    const conversation = yield* conversationRepo.getOptional(input.conversationId)
    if (!conversation) {
      return yield* Effect.fail(new Error('Conversation not found'))
    }

    const providerService = yield* ProviderService
    const isKnown = yield* providerService.isKnownModel(input.model, conversation.projectPath)
    if (!isKnown) {
      return yield* Effect.fail(new Error(`Unknown model: ${input.model}`))
    }

    const agentKernel = yield* AgentKernelService
    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()
    const skillToggles = conversation.projectPath
      ? settings.skillTogglesByProject[conversation.projectPath]
      : undefined
    const result = yield* agentKernel.compact({
      conversation,
      model: input.model,
      customInstructions: input.customInstructions,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onEvent ? { onEvent: input.onEvent } : {}),
      ...(skillToggles ? { skillToggles } : {}),
    })

    const sessionRepo = yield* SessionRepository
    yield* sessionRepo.persistSnapshot({
      sessionId: SessionId(String(input.conversationId)),
      nodes: result.sessionSnapshot.nodes,
      activeNodeId: result.sessionSnapshot.activeNodeId,
      piSessionId: result.piSessionId,
      piSessionFile: result.piSessionFile,
    })

    return {
      summary: result.summary,
      firstKeptEntryId: result.firstKeptEntryId,
      tokensBefore: result.tokensBefore,
    }
  })
}

export function navigateAgentSessionTree(input: AgentSessionNavigateTreeInput) {
  return Effect.gen(function* () {
    const conversationRepo = yield* SessionProjectionRepository
    const conversation = yield* conversationRepo.getOptional(input.conversationId)
    if (!conversation) {
      return yield* Effect.fail(new Error('Conversation not found'))
    }

    const providerService = yield* ProviderService
    const isKnown = yield* providerService.isKnownModel(input.model, conversation.projectPath)
    if (!isKnown) {
      return yield* Effect.fail(new Error(`Unknown model: ${input.model}`))
    }

    const agentKernel = yield* AgentKernelService
    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()
    const skillToggles = conversation.projectPath
      ? settings.skillTogglesByProject[conversation.projectPath]
      : undefined

    const navigation = yield* agentKernel
      .navigateTree({
        conversation,
        model: input.model,
        targetNodeId: String(input.targetNodeId),
        summarize: input.summarize,
        customInstructions: input.customInstructions,
        ...(skillToggles ? { skillToggles } : {}),
      })
      .pipe(
        Effect.map(
          (result): NavigateTreeOutcome => ({
            type: 'success',
            result,
          }),
        ),
        Effect.catchAll((error): Effect.Effect<NavigateTreeOutcome, Error> => {
          if (isAgentKernelMissingEntryError(error)) {
            logger.warn('Skipped Pi tree navigation because the target entry is absent', {
              conversationId: String(input.conversationId),
              targetNodeId: String(input.targetNodeId),
            })
            return Effect.succeed({ type: 'missing-entry' })
          }

          return Effect.fail(error)
        }),
      )

    if (navigation.type === 'missing-entry') {
      return { cancelled: true }
    }

    const { result } = navigation
    const sessionRepo = yield* SessionRepository
    yield* sessionRepo.persistSnapshot({
      sessionId: SessionId(String(input.conversationId)),
      nodes: result.sessionSnapshot.nodes,
      activeNodeId: result.sessionSnapshot.activeNodeId,
      piSessionId: result.piSessionId,
      piSessionFile: result.piSessionFile,
    })

    return {
      editorText: result.editorText,
      cancelled: result.cancelled,
    }
  })
}
