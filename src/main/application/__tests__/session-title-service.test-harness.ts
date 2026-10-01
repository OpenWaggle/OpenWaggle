import type { SessionTitleModelSetting } from '@shared/session-title-model'
import type { SessionTitleSource } from '@shared/session-title-source'
import type { Message } from '@shared/types/agent'
import { MessageId, SessionId, SupportedModelId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { fromPartial } from '@total-typescript/shoehorn'
import { Effect, Layer } from 'effect'
import { type Mock, vi } from 'vitest'
import { SessionTitleGenerationError } from '../../errors'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import {
  type SessionTitleGenerationRequest,
  SessionTitleGenerator,
} from '../../ports/session-title-generator'
import {
  SessionTitleRepository,
  type SessionTitleState,
} from '../../ports/session-title-repository'
import { SettingsService } from '../../services/settings-service'

export const publishSessionHostEventMock: Mock<(event: unknown) => void> = vi.fn()

export const SESSION_ID = SessionId('session-1')
export const SESSION_MODEL = SupportedModelId('anthropic/claude-opus')

export function text(role: Message['role'], body: string, id: string): Message {
  return { id: MessageId(id), role, parts: [{ type: 'text', text: body }], createdAt: 1 }
}

export interface World {
  state: SessionTitleState
  messages: readonly Message[]
  titleModel: SessionTitleModelSetting
  replies: Array<string | SessionTitleGenerationError>
  readonly requests: SessionTitleGenerationRequest[]
  readonly cleared: SessionId[]
  /** Runs while the model "thinks", to simulate a rename landing mid-generation. */
  duringGeneration?: () => void
  /** Runs while the transcript is read, to simulate a Run ending mid-refinement. */
  duringRead?: () => void
}

let currentWorld: World | null = null

/** The scripted state one test drives; reset with `resetWorld` before each test. */
export function world(): World {
  if (!currentWorld) throw new Error('Call resetWorld() before using the title test world().')
  return currentWorld
}

export function resetWorld(overrides: Partial<SessionTitleState> = {}) {
  currentWorld = makeWorld(overrides)
  publishSessionHostEventMock.mockClear()
  return currentWorld
}

function makeWorld(overrides: Partial<SessionTitleState> = {}): World {
  return {
    state: {
      sessionId: SESSION_ID,
      title: 'I would like a short title that describes',
      source: 'provisional',
      needsRefinement: false,
      projectPath: '/repo',
      executionModel: SESSION_MODEL,
      archived: false,
      isWorker: false,
      createdAt: Date.now(),
      ...overrides,
    },
    messages: [],
    titleModel: 'automatic',
    replies: [],
    requests: [],
    cleared: [],
  }
}

const TestRepository = Layer.succeed(
  SessionTitleRepository,
  SessionTitleRepository.of({
    getState: () => Effect.sync(() => ({ ...world().state })),
    assignProvisional: () => Effect.succeed(false),
    applyGenerated: (input) =>
      Effect.sync(() => {
        const current = world().state
        const matches =
          current.title === input.expected.title &&
          input.expected.sources.some((source: SessionTitleSource) => source === current.source)
        if (!matches) return false
        world().state = {
          ...current,
          title: input.title,
          source: 'generated',
          needsRefinement: input.needsRefinement,
        }
        return true
      }),
    clearRefinement: (sessionId) =>
      Effect.sync(() => {
        world().cleared.push(sessionId)
        world().state = { ...world().state, needsRefinement: false }
      }),
    settleRefinementsCreatedBefore: (createdBefore) =>
      Effect.sync(() => {
        if (world().state.createdAt < createdBefore) {
          world().state = { ...world().state, needsRefinement: false }
        }
      }),
    listRecentProvisional: () =>
      Effect.sync(() => (world().state.source === 'provisional' ? [world().state.sessionId] : [])),
    listPendingRefinements: () =>
      Effect.sync(() =>
        world().state.needsRefinement && world().state.source === 'generated'
          ? [world().state.sessionId]
          : [],
      ),
  }),
)

const TestGenerator = Layer.succeed(
  SessionTitleGenerator,
  SessionTitleGenerator.of({
    generate: (request) =>
      Effect.suspend(() => {
        world().requests.push(request)
        world().duringGeneration?.()
        const reply = world().replies.shift()
        if (reply === undefined) return Effect.dieMessage('No scripted Title model reply')
        return reply instanceof SessionTitleGenerationError
          ? Effect.fail(reply)
          : Effect.succeed({ text: reply, modelRef: SupportedModelId('anthropic/claude-haiku') })
      }),
  }),
)

const TestSettings = Layer.succeed(
  SettingsService,
  fromPartial({
    get: () => Effect.sync(() => ({ ...DEFAULT_SETTINGS, sessionTitleModel: world().titleModel })),
  }),
)

const TestProjection = Layer.succeed(
  SessionProjectionRepository,
  fromPartial({
    get: () =>
      Effect.sync((): SessionDetail => {
        const messages = [...world().messages]
        world().duringRead?.()
        return {
          id: SESSION_ID,
          title: world().state.title,
          projectPath: '/repo',
          messages,
          createdAt: 1,
          updatedAt: 1,
        }
      }),
  }),
)

export const TestLayer = Layer.mergeAll(TestRepository, TestGenerator, TestSettings, TestProjection)

export function run<A, E>(
  effect: Effect.Effect<
    A,
    E,
    SessionTitleRepository | SessionTitleGenerator | SettingsService | SessionProjectionRepository
  >,
) {
  return Effect.runPromise(effect.pipe(Effect.provide(TestLayer)))
}

export function json(title: string, needsRefinement = false) {
  return JSON.stringify({ title, needsRefinement })
}
