/**
 * AgentRunService — application-layer coordination for agent message execution.
 *
 * Extracts business logic from agent-handler.ts into Effect programs
 * that depend on hexagonal ports. The handler retains transport concerns
 * (abort controllers, active run tracking, stream buffers, IPC emission).
 */

import { formatErrorMessage } from '@shared/utils/node-error'
import * as Effect from 'effect/Effect'
import { createLogger } from '../logger'
import { AgentKernelService } from '../ports/agent-kernel-service'
import { SessionProjectionRepository } from '../ports/session-projection-repository'
import type { ProjectedSessionNodeInput } from '../ports/session-repository'
import { SessionRepository } from '../ports/session-repository'
import { clearDurableActiveRun, recordDurableActiveRun } from './agent-run/active-run'
import {
  appendDurableAgentLoopEvents,
  type DurableAgentLoopEvent,
  isDurableAgentLoopEvent,
} from './agent-run/agent-loop-events'
import { hydrateAgentRunPayload, runAgentKernel } from './agent-run/kernel'
import { buildAgentRunOutcome, recoverAgentRunFailure } from './agent-run/outcome'
import { loadAgentRunPreflight } from './agent-run/preflight'
import type { ActiveRunIdentity, AgentRunInput, AgentRunResult } from './agent-run/types'
import { listRuntimeEnabledOpenWaggleExtensionPackagePaths } from './extension-runtime-service'

export type { AgentRunInput, AgentRunResult } from './agent-run/types'

const logger = createLogger('agent-run-service')

/** The persisted assistant node with the greatest created order (the run's final assistant turn). */
function resolveLatestAssistantNodeId(nodes: readonly ProjectedSessionNodeInput[]): string | null {
  let latest: ProjectedSessionNodeInput | null = null
  for (const node of nodes) {
    if (node.role === 'assistant' && (latest === null || node.createdOrder > latest.createdOrder)) {
      latest = node
    }
  }
  return latest?.id ?? null
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
  // Whether the agent got the message: a failure after that point is not a refused send.
  let reachedAgent = false
  const durableAgentLoopEvents: DurableAgentLoopEvent[] = []

  return Effect.gen(function* () {
    const preflight = yield* loadAgentRunPreflight(input)
    if (!preflight.ok) return preflight.result
    assignedTitle = preflight.assignedTitle

    const { sessionRepo, identity } = yield* recordDurableActiveRun(input)
    const sessionProjectionRepo = yield* SessionProjectionRepository
    activeRunIdentity = identity

    const hydratedPayload = yield* hydrateAgentRunPayload(input.payload)
    const agentResult = yield* runAgentKernel(
      {
        ...input,
        onEvent: (event) => {
          if (isDurableAgentLoopEvent(event)) {
            durableAgentLoopEvents.push(event)
          }
          input.onEvent(event)
        },
      },
      hydratedPayload,
      preflight,
    )
    /*
     * From here on the agent has the message and has answered it, so a failure past this point is not a refused
     * send. Everything below is persistence, and a database write failure is a typed failure that the recovery
     * below turns into an ordinary error outcome - which was then reported to the caller as "the agent never
     * received this", making it restore a review the agent already held.
     */
    reachedAgent = true
    const existingTree = yield* sessionRepo.getTree(input.sessionId)
    const sessionSnapshot = appendDurableAgentLoopEvents({
      snapshot: agentResult.sessionSnapshot,
      events: durableAgentLoopEvents,
      runId: input.runId,
      existingNodes: existingTree?.nodes ?? [],
    })
    yield* sessionRepo.persistSnapshot({
      sessionId: input.sessionId,
      nodes: sessionSnapshot.nodes,
      activeNodeId: sessionSnapshot.activeNodeId,
      piSessionId: agentResult.piSessionId,
      piSessionFile: agentResult.piSessionFile,
    })

    // WS6b: anchor this turn's checkpoint to the run's final assistant node so
    // the transcript can reveal its Turn diff (no-op when no checkpoint/anchor).
    const anchorNodeId = resolveLatestAssistantNodeId(sessionSnapshot.nodes)
    if (anchorNodeId) {
      yield* sessionProjectionRepo.setTurnCheckpointAnchor(
        input.sessionId,
        input.runId,
        anchorNodeId,
      )
    }

    return buildAgentRunOutcome({
      agentResult,
      signal: input.signal,
      assignedTitle,
      sessionId: input.sessionId,
      runId: input.runId,
      model: input.model,
    })
  }).pipe(
    Effect.catchAll(
      (error): Effect.Effect<AgentRunResult> =>
        recoverAgentRunFailure({
          reachedAgent,
          error,
          assignedTitle,
          sessionId: input.sessionId,
          runId: input.runId,
          model: input.model,
        }),
    ),
    Effect.ensuring(clearDurableActiveRun(() => activeRunIdentity)),
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
      const enabledOpenWaggleExtensionPackagePaths = session.projectPath
        ? yield* listRuntimeEnabledOpenWaggleExtensionPackagePaths(session.projectPath)
        : undefined

      yield* agentKernel
        .getSessionSnapshot({
          session,
          model: activeRun.model,
          ...(enabledOpenWaggleExtensionPackagePaths
            ? { enabledOpenWaggleExtensionPackagePaths }
            : {}),
        })
        .pipe(
          Effect.flatMap((result) =>
            Effect.gen(function* () {
              const existingTree = yield* sessionRepo.getTree(activeRun.sessionId)
              const sessionSnapshot = appendDurableAgentLoopEvents({
                snapshot: result.sessionSnapshot,
                events: [],
                runId: activeRun.runId,
                existingNodes: existingTree?.nodes ?? [],
              })
              yield* sessionRepo.persistSnapshot({
                sessionId: activeRun.sessionId,
                nodes: sessionSnapshot.nodes,
                activeNodeId: sessionSnapshot.activeNodeId,
                piSessionId: result.piSessionId,
                piSessionFile: result.piSessionFile,
              })
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
