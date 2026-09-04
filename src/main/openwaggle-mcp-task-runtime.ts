import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { EstablishSessionLineageInput, SessionDelegationState } from '@shared/types/session'
import type { ThinkingLevel } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import { type AgentRunResult, executeAgentRun } from './application/agent-run-service'
import type { ServerTaskRecord } from './openwaggle-mcp-task-store'
import { AgentKernelService } from './ports/agent-kernel-service'
import { SessionProjectionRepository } from './ports/session-projection-repository'
import { runAppEffect } from './runtime'
import { SettingsService } from './services/settings-service'
import { broadcastToWindows } from './utils/broadcast'

export interface TaskExecutionProfile {
  readonly model: string
  readonly thinkingLevel: ThinkingLevel
}

interface CreatedOrReusedSession {
  readonly sessionId: SessionId
  readonly created: boolean
}

export interface OpenWaggleServerTaskServices {
  readonly resolveExecutionProfile: (sessionId?: string) => Promise<TaskExecutionProfile>
  readonly createOrReuseSession: (task: ServerTaskRecord) => Promise<CreatedOrReusedSession>
  readonly establishLineage: (input: EstablishSessionLineageInput) => Promise<void>
  readonly setDelegationState: (
    sessionId: SessionId,
    state: SessionDelegationState,
  ) => Promise<void>
  readonly execute: (input: {
    readonly sessionId: SessionId
    readonly runId: string
    readonly objective: string
    readonly thinkingLevel: ThinkingLevel
    readonly model: string
    readonly signal: AbortSignal
  }) => Promise<AgentRunResult>
}

export const defaultTaskServices: OpenWaggleServerTaskServices = {
  resolveExecutionProfile: resolveTargetExecutionProfile,
  createOrReuseSession,
  establishLineage: async (input) => {
    await runAppEffect(
      Effect.gen(function* () {
        const sessions = yield* SessionProjectionRepository
        yield* sessions.establishLineage(input)
      }),
    )
    broadcastToWindows('sessions:list-invalidated', {
      sessionIds: [input.parentSessionId, input.sessionId],
    })
  },
  setDelegationState: async (sessionId, state) => {
    await runAppEffect(
      Effect.gen(function* () {
        const sessions = yield* SessionProjectionRepository
        yield* sessions.setDelegationState(sessionId, state)
      }),
    )
    broadcastToWindows('sessions:list-invalidated', { sessionIds: [sessionId] })
  },
  execute: (input) =>
    runAppEffect(
      executeAgentRun({
        sessionId: input.sessionId,
        runId: input.runId,
        payload: { text: input.objective, attachments: [], thinkingLevel: input.thinkingLevel },
        model: SupportedModelId(input.model),
        signal: input.signal,
        onEvent: () => undefined,
      }),
    ),
}

async function resolveTargetExecutionProfile(sessionId?: string): Promise<TaskExecutionProfile> {
  return runAppEffect(
    Effect.gen(function* () {
      const settingsService = yield* SettingsService
      const settings = yield* settingsService.get()
      if (!sessionId) {
        if (!settings.selectedModel) {
          return yield* Effect.fail(
            new Error(
              'OpenWaggle has no default model selected. Select a model in the desktop app, then retry.',
            ),
          )
        }
        return { model: settings.selectedModel, thinkingLevel: settings.thinkingLevel }
      }
      const sessions = yield* SessionProjectionRepository
      const session = yield* sessions.getOptional(SessionId(sessionId))
      if (!session) return yield* Effect.fail(new Error(`Session ${sessionId} was not found.`))
      const targetModel = session.messages.findLast((message) => Boolean(message.model))?.model
      const model = targetModel ?? settings.selectedModel
      if (!model) {
        return yield* Effect.fail(
          new Error(
            'The target session has no model profile. Select a model in the desktop app, then retry.',
          ),
        )
      }
      return { model, thinkingLevel: settings.thinkingLevel }
    }),
  )
}

async function createOrReuseSession(task: ServerTaskRecord): Promise<CreatedOrReusedSession> {
  return runAppEffect(
    Effect.gen(function* () {
      if (task.sessionId) return { sessionId: SessionId(task.sessionId), created: false as const }
      const kernel = yield* AgentKernelService
      const runtimeSession = yield* kernel.createSession({ projectPath: task.projectPath })
      const sessions = yield* SessionProjectionRepository
      const session = yield* sessions.create({
        projectPath: task.projectPath,
        piSessionId: runtimeSession.piSessionId,
        piSessionFile: runtimeSession.piSessionFile,
      })
      return { sessionId: session.id, created: true as const }
    }),
  )
}
