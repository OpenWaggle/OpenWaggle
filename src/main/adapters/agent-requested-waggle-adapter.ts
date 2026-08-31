import { matchBy } from '@diegogbrisa/ts-match'
import type { Message } from '@shared/types/agent'
import type { SessionId, SupportedModelId } from '@shared/types/brand'
import type { ThinkingLevel } from '@shared/types/settings'
import type { AgentTransportEvent } from '@shared/types/stream'
import type { WaggleHandoffRequest, WaggleInvocation } from '@shared/types/waggle'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { classifyAgentError } from '../agent/error-classifier'
import { activeWaggleRuns } from '../application/active-session-runs'
import { findWaggleHandoffRequest } from '../application/waggle-handoff'
import {
  executeWaggleRun,
  type WaggleRunInput,
  type WaggleRunResult,
} from '../application/waggle-run-service'
import type { AgentKernelService } from '../ports/agent-kernel-service'
import { AgentRequestedWaggleService } from '../ports/agent-requested-waggle-service'
import type { ExtensionLifecycleRepository } from '../ports/extension-lifecycle-repository'
import type { ExtensionManagerService } from '../ports/extension-manager-service'
import type { ExtensionProjectOverridesRepository } from '../ports/extension-project-overrides-repository'
import type { SessionProjectionRepository } from '../ports/session-projection-repository'
import type { SessionRepository } from '../ports/session-repository'
import type { SettingsService } from '../services/settings-service'
import { publishSessionHostEvent } from '../session-host/session-host-events'
import { startStreamBuffer } from '../utils/stream-bridge'

function invocation(handoff: WaggleHandoffRequest): WaggleInvocation {
  return {
    presetId: handoff.presetId,
    presetName: handoff.presetName,
    source: handoff.source,
    config: handoff.config,
  }
}

function publishTransport(sessionId: SessionId, event: AgentTransportEvent) {
  publishSessionHostEvent({ kind: 'session-transport', sessionId, event })
}

function publishEnd(
  sessionId: SessionId,
  runId: string,
  reason: 'aborted' | 'stop' | 'error',
  error?: { readonly message: string; readonly code: string },
) {
  publishTransport(sessionId, {
    type: 'agent_end',
    timestamp: Date.now(),
    runId,
    reason,
    ...(error ? { error } : {}),
  })
}

interface RequestedWaggleInput {
  readonly sessionId: SessionId
  readonly runId: string
  readonly messages: readonly Message[]
  readonly model: SupportedModelId
  readonly thinkingLevel: ThinkingLevel
  readonly controller: AbortController
}

type RequestedWaggleDependencies =
  | AgentKernelService
  | ExtensionLifecycleRepository
  | ExtensionManagerService
  | ExtensionProjectOverridesRepository
  | SessionProjectionRepository
  | SessionRepository
  | SettingsService

type RequestedWaggleRunner = (input: WaggleRunInput) => Effect.Effect<WaggleRunResult, Error>

export function runRequestedWaggleWith(
  input: RequestedWaggleInput,
  runWaggle: RequestedWaggleRunner,
) {
  const handoff = findWaggleHandoffRequest(input.messages)
  if (!handoff || input.controller.signal.aborted) return Effect.succeed(false)
  return Effect.gen(function* () {
    const waggleInvocation = invocation(handoff)
    yield* Effect.sync(() => {
      activeWaggleRuns.register(input.sessionId, input.controller, { runId: input.runId })
      publishSessionHostEvent({
        kind: 'session-waggle-turn',
        sessionId: input.sessionId,
        event: {
          type: 'collaboration-pending',
          sessionId: input.sessionId,
          invocation: waggleInvocation,
        },
      })
    })
    const runId = `waggle-${input.sessionId}`
    const result = yield* runWaggle({
      sessionId: input.sessionId,
      runId,
      payload: {
        text: handoff.prompt,
        thinkingLevel: input.thinkingLevel,
        attachments: [],
        waggle: waggleInvocation,
      },
      model: input.model,
      config: handoff.config,
      signal: input.controller.signal,
      onRunPrepared: (runtimeModel) => {
        startStreamBuffer(input.sessionId, runtimeModel, 'waggle')
        publishTransport(input.sessionId, {
          type: 'agent_start',
          timestamp: Date.now(),
          runId,
        })
      },
      onEvent: (event, meta) => {
        publishSessionHostEvent({
          kind: 'session-waggle-transport',
          sessionId: input.sessionId,
          event,
          meta,
        })
        if (event.type !== 'agent_end') publishTransport(input.sessionId, event)
      },
      onTurnEvent: (event) =>
        publishSessionHostEvent({
          kind: 'session-waggle-turn',
          sessionId: input.sessionId,
          event,
        }),
      onTitleAssigned: () => {
        publishSessionHostEvent({
          kind: 'session-list-changed',
          sessionId: input.sessionId,
          change: 'updated',
        })
      },
    })

    matchBy(result, 'outcome')
      .with('validation-error', 'not-found', 'no-project', 'error', (value) =>
        publishEnd(input.sessionId, runId, 'error', {
          message: value.message,
          code: value.code,
        }),
      )
      .with('aborted', () => publishEnd(input.sessionId, runId, 'aborted'))
      .with('success', (value) => {
        const assistantCount = value.newMessages.filter(
          (message) => message.role === 'assistant',
        ).length
        if (assistantCount === 0 && value.lastError) {
          const classified = classifyAgentError(new Error(value.lastError))
          publishEnd(input.sessionId, runId, 'error', {
            message: classified.userMessage,
            code: classified.code,
          })
          return
        }
        publishEnd(input.sessionId, runId, 'stop')
      })
      .exhaustive()
    return true
  }).pipe(
    Effect.tapError((error) =>
      Effect.sync(() => {
        const classified = classifyAgentError(error)
        publishEnd(input.sessionId, `waggle-${input.sessionId}`, 'error', {
          message: classified.userMessage,
          code: classified.code,
        })
      }),
    ),
    Effect.ensuring(
      Effect.sync(() => {
        activeWaggleRuns.deleteIfCurrent(input.sessionId, input.controller)
      }),
    ),
  )
}

export const AgentRequestedWaggleServiceLive = Layer.effect(
  AgentRequestedWaggleService,
  Effect.gen(function* () {
    const dependencies = yield* Effect.context<RequestedWaggleDependencies>()
    return AgentRequestedWaggleService.of({
      runIfRequested: (input) =>
        runRequestedWaggleWith(input, (waggleInput) =>
          executeWaggleRun(waggleInput).pipe(Effect.provide(dependencies)),
        ),
    })
  }),
)
