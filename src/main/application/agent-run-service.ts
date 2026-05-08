/**
 * AgentRunService — application-layer coordination for agent message execution.
 *
 * Extracts business logic from agent-handler.ts into Effect programs
 * that depend on hexagonal ports. The handler retains transport concerns
 * (abort controllers, active run tracking, stream buffers, IPC emission).
 */

import type { AgentSendPayload, HydratedAgentSendPayload, Message } from '@shared/types/agent'
import { SessionBranchId, SessionId } from '@shared/types/brand'
import type { SupportedModelId } from '@shared/types/llm'
import type { SessionTree } from '@shared/types/session'
import type { AgentTransportEvent } from '@shared/types/stream'
import { formatErrorMessage } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import { classifyAgentError, makeErrorInfo } from '../agent/error-classifier'
import { createLogger } from '../logger'
import { AgentKernelService } from '../ports/agent-kernel-service'
import { ProviderService } from '../ports/provider-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionRepository } from '../ports/session-repository'
import { SettingsService } from '../services/settings-service'
import { assignSessionTitleFromUserText, hydratePayloadAttachments } from './run-handler-utils'

const MAIN_BRANCH_NAME = 'main'
const logger = createLogger('agent-run-service')

// ─── Types ───────────────────────────────────────────────────

export interface AgentRunInput {
  readonly sessionId: SessionId
  readonly runId: string
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

interface ActiveRunIdentity {
  readonly sessionId: SessionId
  readonly runId: string
}

// ─── Service Functions ───────────────────────────────────────

function fallbackMainBranchId(sessionId: SessionId): SessionBranchId {
  return SessionBranchId(`${sessionId}:${MAIN_BRANCH_NAME}`)
}

function resolveActiveBranchId(sessionId: SessionId, tree: SessionTree | null): SessionBranchId {
  return (
    tree?.session.lastActiveBranchId ??
    tree?.branches.find((branch) => branch.isMain)?.id ??
    fallbackMainBranchId(sessionId)
  )
}

/**
 * Validate preconditions, execute the agent run, and persist results.
 * Returns a discriminated union describing the outcome.
 *
 * The handler reads the outcome and performs transport actions
 * (IPC emission, stream buffer, active run cleanup).
 */
export function executeAgentRun(input: AgentRunInput) {
  let assignedTitle: string | undefined
  let activeRunIdentity: ActiveRunIdentity | null = null

  return Effect.gen(function* () {
    const { sessionId, runId, payload, model, signal, onEvent } = input

    // ─── Fetch session ──────────────────────────────
    const sessionProjectionRepo = yield* SessionProjectionRepository
    const session = yield* sessionProjectionRepo.getOptional(sessionId)
    if (!session) {
      const errorInfo = makeErrorInfo('session-not-found', 'Session not found')
      return { outcome: 'not-found' as const, message: errorInfo.userMessage, code: errorInfo.code }
    }

    // ─── Validate model against the project-scoped Pi registry ─────────────
    const providerService = yield* ProviderService
    const isKnown = yield* providerService.isKnownModel(model, session.projectPath)
    if (!isKnown) {
      return {
        outcome: 'invalid-model' as const,
        message: `Unknown model: ${model}`,
        code: 'invalid-model',
      }
    }

    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()
    const skillToggles = session.projectPath
      ? settings.skillTogglesByProject[session.projectPath]
      : undefined

    const nextTitle = yield* assignSessionTitleFromUserText(sessionId, session, payload.text)
    if (nextTitle) {
      assignedTitle = nextTitle
    }

    const sessionRepo = yield* SessionRepository
    const sessionTree = yield* sessionRepo.getTree(sessionId)
    const branchId = resolveActiveBranchId(sessionId, sessionTree)
    yield* sessionRepo.clearInterruptedRuns({ sessionId, branchId })
    yield* sessionRepo.recordActiveRun({
      runId,
      sessionId,
      branchId,
      runMode: 'classic',
      model,
    })
    activeRunIdentity = { sessionId, runId }

    // ─── Hydrate attachments ─────────────────────────────
    const hydratedPayload: HydratedAgentSendPayload = {
      ...payload,
      attachments: yield* Effect.promise(() => hydratePayloadAttachments(payload.attachments)),
    }

    // ─── Execute Pi-backed agent kernel ──────────────────
    const agentKernel = yield* AgentKernelService
    const agentResult = yield* agentKernel.run({
      session,
      runId,
      payload: hydratedPayload,
      model,
      signal,
      onEvent,
      ...(skillToggles ? { skillToggles } : {}),
    })

    yield* sessionRepo.persistSnapshot({
      sessionId: SessionId(String(sessionId)),
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
    Effect.ensuring(
      Effect.gen(function* () {
        if (!activeRunIdentity) {
          return
        }
        const sessionRepo = yield* SessionRepository
        yield* sessionRepo.clearActiveRun(activeRunIdentity).pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              logger.warn('Failed to clear durable active run', {
                sessionId: activeRunIdentity?.sessionId,
                runId: activeRunIdentity?.runId,
                error: formatErrorMessage(error),
              })
            }),
          ),
        )
      }),
    ),
  )
}

export function reconcileInterruptedAgentRuns() {
  return Effect.gen(function* () {
    const sessionRepo = yield* SessionRepository
    const sessionProjectionRepo = yield* SessionProjectionRepository
    const agentKernel = yield* AgentKernelService
    const activeRuns = yield* sessionRepo.listActiveRunsForRecovery()

    for (const activeRun of activeRuns) {
      const identity: ActiveRunIdentity = {
        sessionId: activeRun.sessionId,
        runId: activeRun.runId,
      }
      const session = yield* sessionProjectionRepo.getOptional(activeRun.sessionId)
      if (!session) {
        yield* sessionRepo.clearActiveRun(identity)
        continue
      }

      yield* agentKernel
        .getSessionSnapshot({
          session,
          model: activeRun.model,
        })
        .pipe(
          Effect.flatMap((result) =>
            sessionRepo.persistSnapshot({
              sessionId: activeRun.sessionId,
              nodes: result.sessionSnapshot.nodes,
              activeNodeId: result.sessionSnapshot.activeNodeId,
              piSessionId: result.piSessionId,
              piSessionFile: result.piSessionFile,
            }),
          ),
          Effect.catchAll((error) =>
            Effect.sync(() => {
              logger.warn('Failed to reconcile interrupted active run snapshot', {
                sessionId: activeRun.sessionId,
                runId: activeRun.runId,
                error: formatErrorMessage(error),
              })
            }),
          ),
        )

      yield* sessionRepo.markActiveRunInterrupted(identity)
    }
  })
}

export function dismissInterruptedAgentRun(input: ActiveRunIdentity) {
  return Effect.gen(function* () {
    const sessionRepo = yield* SessionRepository
    yield* sessionRepo.clearActiveRun(input)
  })
}
