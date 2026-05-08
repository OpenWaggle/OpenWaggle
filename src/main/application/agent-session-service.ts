import { SessionId, type SessionNodeId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { AgentTransportEvent } from '@shared/types/stream'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import {
  type AgentKernelForkPosition,
  type AgentKernelNavigateTreeResult,
  AgentKernelService,
  type AgentKernelSessionSnapshot,
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
  readonly sessionId: SessionId
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

export interface AgentSessionForkInput extends AgentSessionCommandInput {
  readonly targetNodeId: SessionNodeId
}

interface AgentSessionCopyInput extends AgentSessionForkInput {
  readonly position: AgentKernelForkPosition
}

interface KernelSnapshotResult {
  readonly piSessionId: string
  readonly piSessionFile?: string
  readonly sessionSnapshot: AgentKernelSessionSnapshot
}

function loadSessionForCommand(input: AgentSessionCommandInput) {
  return Effect.gen(function* () {
    const sessionProjectionRepo = yield* SessionProjectionRepository
    const session = yield* sessionProjectionRepo.getOptional(input.sessionId)
    if (!session) {
      return yield* Effect.fail(new Error('Session not found'))
    }

    const providerService = yield* ProviderService
    const isKnown = yield* providerService.isKnownModel(input.model, session.projectPath)
    if (!isKnown) {
      return yield* Effect.fail(new Error(`Unknown model: ${input.model}`))
    }

    return session
  })
}

function loadValidatedAgentSession(input: AgentSessionCommandInput) {
  return Effect.gen(function* () {
    const session = yield* loadSessionForCommand(input)
    const skillToggles = yield* getSkillToggles(session.projectPath)
    return {
      session,
      ...(skillToggles ? { skillToggles } : {}),
    }
  })
}

function persistKernelSnapshot(sessionId: SessionId, result: KernelSnapshotResult) {
  return Effect.gen(function* () {
    const sessionRepo = yield* SessionRepository
    yield* sessionRepo.persistSnapshot({
      sessionId: SessionId(String(sessionId)),
      nodes: result.sessionSnapshot.nodes,
      activeNodeId: result.sessionSnapshot.activeNodeId,
      piSessionId: result.piSessionId,
      piSessionFile: result.piSessionFile,
    })
  })
}

export function getAgentContextUsage(input: AgentSessionCommandInput) {
  return Effect.gen(function* () {
    const sessionProjectionRepo = yield* SessionProjectionRepository
    const session = yield* sessionProjectionRepo.getOptional(input.sessionId)
    if (!session) {
      return null
    }

    const providerService = yield* ProviderService
    const isKnown = yield* providerService.isKnownModel(input.model, session.projectPath)
    if (!isKnown) {
      return null
    }

    const agentKernel = yield* AgentKernelService
    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()
    const skillToggles = session.projectPath
      ? settings.skillTogglesByProject[session.projectPath]
      : undefined
    return yield* agentKernel.getContextUsage({
      session,
      model: input.model,
      ...(skillToggles ? { skillToggles } : {}),
    })
  })
}

function getSkillToggles(projectPath: string | null | undefined) {
  return Effect.gen(function* () {
    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()
    return projectPath ? settings.skillTogglesByProject[projectPath] : undefined
  })
}

function copyAgentSessionToNewSession(input: AgentSessionCopyInput) {
  return Effect.gen(function* () {
    const { session, skillToggles } = yield* loadValidatedAgentSession(input)

    if (!session.projectPath) {
      return yield* Effect.fail(new Error('No project path set on the session.'))
    }

    const agentKernel = yield* AgentKernelService
    const result = yield* agentKernel.forkSession({
      session,
      model: input.model,
      targetNodeId: String(input.targetNodeId),
      position: input.position,
      ...(skillToggles ? { skillToggles } : {}),
    })

    if (result.cancelled) {
      return { cancelled: true }
    }

    const sessionProjectionRepo = yield* SessionProjectionRepository
    const createdProjection = yield* sessionProjectionRepo.create({
      projectPath: session.projectPath,
      piSessionId: result.piSessionId,
      piSessionFile: result.piSessionFile,
    })

    yield* persistKernelSnapshot(SessionId(String(createdProjection.id)), result)

    const persistedSession = yield* sessionProjectionRepo.get(
      SessionId(String(createdProjection.id)),
    )
    return {
      session: persistedSession,
      cancelled: false,
      ...(result.editorText ? { editorText: result.editorText } : {}),
    }
  })
}

export function forkAgentSessionToNewSession(input: AgentSessionForkInput) {
  return copyAgentSessionToNewSession({ ...input, position: 'before' })
}

export function cloneAgentSessionToNewSession(input: AgentSessionForkInput) {
  return copyAgentSessionToNewSession({ ...input, position: 'at' })
}

export function compactAgentSession(input: AgentSessionCompactInput) {
  return Effect.gen(function* () {
    const { session, skillToggles } = yield* loadValidatedAgentSession(input)
    const agentKernel = yield* AgentKernelService
    const result = yield* agentKernel.compact({
      session,
      model: input.model,
      customInstructions: input.customInstructions,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onEvent ? { onEvent: input.onEvent } : {}),
      ...(skillToggles ? { skillToggles } : {}),
    })

    yield* persistKernelSnapshot(input.sessionId, result)

    return {
      summary: result.summary,
      firstKeptEntryId: result.firstKeptEntryId,
      tokensBefore: result.tokensBefore,
    }
  })
}

export function navigateAgentSessionTree(input: AgentSessionNavigateTreeInput) {
  return Effect.gen(function* () {
    const { session, skillToggles } = yield* loadValidatedAgentSession(input)
    const agentKernel = yield* AgentKernelService
    const navigation = yield* agentKernel
      .navigateTree({
        session,
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
              sessionId: String(input.sessionId),
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
    yield* persistKernelSnapshot(input.sessionId, result)

    return {
      editorText: result.editorText,
      cancelled: result.cancelled,
    }
  })
}
