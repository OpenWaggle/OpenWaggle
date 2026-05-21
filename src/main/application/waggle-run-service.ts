/**
 * WaggleRunService — application-layer coordination for waggle mode execution.
 *
 * Waggle runs are Pi-native turns over the same canonical Pi session as standard
 * mode. This service owns product semantics (turn order, attribution, consensus,
 * persistence) and depends on the AgentKernelService port for runtime execution.
 */

import { randomUUID } from 'node:crypto'
import { safeDecodeUnknown } from '@shared/schema'
import { waggleConfigSchema } from '@shared/schemas/waggle'
import type { AgentSendPayload, HydratedAgentSendPayload, Message } from '@shared/types/agent'
import { SessionBranchId, SessionId } from '@shared/types/brand'
import type { SessionDetail, SessionTree } from '@shared/types/session'
import type { AgentTransportEvent } from '@shared/types/stream'
import type {
  WaggleConfig,
  WaggleMessageMetadata,
  WaggleStreamMetadata,
  WaggleTurnEvent,
} from '@shared/types/waggle'
import { formatErrorMessage } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import { makeErrorInfo } from '../agent/error-classifier'
import { FileConflictTracker } from '../agent/file-conflict-tracker'
import { buildPersistedUserMessageParts, makeMessage } from '../agent/shared'
import { createLogger } from '../logger'
import { AgentKernelService } from '../ports/agent-kernel-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import { SessionRepository } from '../ports/session-repository'
import { SettingsService } from '../services/settings-service'
import { assignSessionTitleFromUserText, hydratePayloadAttachments } from './run-handler-utils'
import { applyWaggleMetadataToSnapshot, seedWaggleMetadataFromTree } from './waggle-run/metadata'
import { persistWaggleSnapshot } from './waggle-run/persistence'
import { createWaggleTurnController } from './waggle-run/turn-controller'

const MAIN_BRANCH_NAME = 'main'
const logger = createLogger('waggle-run-service')

export interface WaggleRunInput {
  readonly sessionId: SessionId
  readonly runId: string
  readonly payload: AgentSendPayload
  readonly config: WaggleConfig
  readonly signal: AbortSignal
  readonly onEvent: (event: AgentTransportEvent, meta: WaggleStreamMetadata) => void
  readonly onTurnEvent: (event: WaggleTurnEvent) => void
  readonly onTitleAssigned?: (title: string) => void
}

interface ActiveRunIdentity {
  readonly sessionId: SessionId
  readonly runId: string
}

interface PreparedWaggleRun {
  readonly assignedTitle?: string
  readonly hydratedPayload: HydratedAgentSendPayload
  readonly session: SessionDetail
  readonly skillToggles: Record<string, boolean> | undefined
}

function validationErrorOutcome() {
  return {
    outcome: 'validation-error' as const,
    message: 'Invalid Waggle mode configuration',
    code: 'validation-error',
  }
}

function notFoundOutcome() {
  const errorInfo = makeErrorInfo('session-not-found', 'Session not found')
  return {
    outcome: 'not-found' as const,
    message: errorInfo.userMessage,
    code: errorInfo.code,
  }
}

function noProjectOutcome() {
  return {
    outcome: 'no-project' as const,
    message: 'Please select a project folder before starting Waggle mode.',
    code: 'no-project',
  }
}

function mainBranchFallbackId(sessionId: SessionId) {
  return SessionBranchId(`${sessionId}:${MAIN_BRANCH_NAME}`)
}

function resolveWaggleBranchId(input: {
  readonly sessionId: SessionId
  readonly tree: SessionTree | null
}) {
  return (
    input.tree?.session.lastActiveBranchId ??
    input.tree?.branches.find((branch) => branch.isMain)?.id ??
    mainBranchFallbackId(input.sessionId)
  )
}

function clearDurableActiveRun(getActiveRunIdentity: () => ActiveRunIdentity | null) {
  return Effect.gen(function* () {
    const activeRunIdentity = getActiveRunIdentity()
    if (!activeRunIdentity) return

    const sessionRepo = yield* SessionRepository
    yield* sessionRepo.clearActiveRun(activeRunIdentity).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          logger.warn('Failed to clear durable Waggle active run', {
            sessionId: activeRunIdentity.sessionId,
            runId: activeRunIdentity.runId,
            error: formatErrorMessage(error),
          })
        }),
      ),
    )
  })
}

function prepareWaggleRun(input: WaggleRunInput) {
  return Effect.gen(function* () {
    if (!safeDecodeUnknown(waggleConfigSchema, input.config).success) {
      return { ok: false as const, outcome: validationErrorOutcome() }
    }

    const settingsService = yield* SettingsService
    const settings = yield* settingsService.get()
    const sessionProjectionRepo = yield* SessionProjectionRepository
    const session = yield* sessionProjectionRepo.getOptional(input.sessionId)
    if (!session) return { ok: false as const, outcome: notFoundOutcome() }
    if (!session.projectPath) return { ok: false as const, outcome: noProjectOutcome() }

    const assignedTitle = yield* assignPreparedTitle(input, session)
    const hydratedPayload: HydratedAgentSendPayload = {
      ...input.payload,
      attachments: yield* Effect.promise(() =>
        hydratePayloadAttachments(input.payload.attachments),
      ),
    }

    return {
      ok: true as const,
      value: {
        assignedTitle,
        hydratedPayload,
        session,
        skillToggles: settings.skillTogglesByProject[session.projectPath],
      },
    }
  })
}

function assignPreparedTitle(input: WaggleRunInput, session: SessionDetail) {
  return Effect.gen(function* () {
    const title = yield* assignSessionTitleFromUserText(
      input.sessionId,
      session,
      input.payload.text,
    )
    if (title) yield* Effect.sync(() => input.onTitleAssigned?.(title))
    return title ?? undefined
  })
}

function recordDurableWaggleRun(input: {
  readonly branchId: SessionBranchId
  readonly run: WaggleRunInput
  readonly sessionRepo: typeof SessionRepository.Service
}) {
  return Effect.gen(function* () {
    yield* input.sessionRepo.clearInterruptedRuns({
      sessionId: input.run.sessionId,
      branchId: input.branchId,
    })
    yield* input.sessionRepo.recordActiveRun({
      runId: input.run.runId,
      sessionId: input.run.sessionId,
      branchId: input.branchId,
      runMode: 'waggle',
      model: input.run.config.agents[0].model,
    })
  })
}

function runPreparedWaggle(
  input: WaggleRunInput,
  prepared: PreparedWaggleRun,
  setActiveRunIdentity: (identity: ActiveRunIdentity) => void,
) {
  return Effect.gen(function* () {
    const accumulatedMessages: Message[] = [
      makeMessage('user', buildPersistedUserMessageParts(prepared.hydratedPayload)),
    ]
    const sessionRepo = yield* SessionRepository
    const initialTree = yield* sessionRepo.getTree(SessionId(String(input.sessionId)))
    const knownNodeIds = new Set(initialTree?.nodes.map((node) => String(node.id)) ?? [])
    const waggleMetadataByNodeId = seedWaggleMetadataFromTree(initialTree?.nodes ?? [])
    const newTurnMetadata: WaggleMessageMetadata[] = []
    const branchId = resolveWaggleBranchId({ sessionId: input.sessionId, tree: initialTree })

    yield* recordDurableWaggleRun({ branchId, run: input, sessionRepo })
    setActiveRunIdentity({ sessionId: input.sessionId, runId: input.runId })
    logWaggleStart(input)

    const turnController = createWaggleTurnController({
      accumulatedMessages,
      config: input.config,
      conflictTracker: new FileConflictTracker(),
      maxTurns: input.config.stop.maxTurnsSafety,
      newTurnMetadata,
      onEvent: input.onEvent,
      onTurnEvent: input.onTurnEvent,
      sessionId: input.sessionId,
      waggleSessionId: randomUUID(),
    })
    const agentKernel = yield* AgentKernelService
    const result = yield* agentKernel.runWaggle({
      session: prepared.session,
      runId: input.runId,
      payload: prepared.hydratedPayload,
      model: input.config.agents[0].model,
      config: input.config,
      signal: input.signal,
      skillToggles: prepared.skillToggles,
      onEvent: () => undefined,
      onWaggleEvent: turnController.handleWaggleEvent,
      onTurnEvent: input.onTurnEvent,
      createTurnMetadata: turnController.createTurnMetadata,
      onTurnComplete: turnController.handleTurnComplete,
    })

    if (result.aborted || input.signal.aborted) {
      turnController.stopForUserCancel()
      return {
        outcome: 'aborted' as const,
        ...(prepared.assignedTitle ? { assignedTitle: prepared.assignedTitle } : {}),
      }
    }

    yield* persistWaggleSnapshot({
      sessionId: input.sessionId,
      result,
      snapshot: applyWaggleMetadataToSnapshot({
        snapshot: result.sessionSnapshot,
        metadataByNodeId: waggleMetadataByNodeId,
        knownNodeIds,
        newTurnMetadata,
      }),
      waggleConfig: input.config,
    })

    turnController.completeIfStillRunning()
    return successOutcome(input, prepared, accumulatedMessages, turnController.getState())
  })
}

function logWaggleStart(input: WaggleRunInput) {
  logger.info('Starting Pi-native Waggle collaboration', {
    sessionId: input.sessionId,
    agents: input.config.agents.map((agent) => agent.label),
    maxTurns: input.config.stop.maxTurnsSafety,
    stopCondition: input.config.stop.primary,
  })
}

function successOutcome(
  input: WaggleRunInput,
  prepared: PreparedWaggleRun,
  accumulatedMessages: readonly Message[],
  finalState: ReturnType<ReturnType<typeof createWaggleTurnController>['getState']>,
) {
  logger.info('Pi-native Waggle collaboration finished', {
    sessionId: input.sessionId,
    status: finalState.status,
    totalTurns: finalState.successfulTurnCount,
    consensusReason: finalState.consensusReason,
  })

  return {
    outcome: 'success' as const,
    newMessages: accumulatedMessages,
    lastError: finalState.lastTurnError,
    ...(prepared.assignedTitle ? { assignedTitle: prepared.assignedTitle } : {}),
  }
}

export function executeWaggleRun(input: WaggleRunInput) {
  let activeRunIdentity: ActiveRunIdentity | null = null

  return Effect.gen(function* () {
    const prepared = yield* prepareWaggleRun(input)
    if (!prepared.ok) return prepared.outcome
    return yield* runPreparedWaggle(input, prepared.value, (identity) => {
      activeRunIdentity = identity
    })
  }).pipe(Effect.ensuring(clearDurableActiveRun(() => activeRunIdentity)))
}
