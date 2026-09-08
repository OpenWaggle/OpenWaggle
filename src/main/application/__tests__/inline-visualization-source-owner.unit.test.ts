import { SessionId } from '@shared/types/brand'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  InlineVisualizationService,
  type InlineVisualizationServiceShape,
} from '../../ports/inline-visualization-service'
import {
  SessionProjectionRepository,
  type SessionProjectionRepositoryShape,
} from '../../ports/session-projection-repository'
import { SessionRepository, type SessionRepositoryShape } from '../../ports/session-repository'
import { reserveActiveSessionRun } from '../active-session-runs'
import { prepareInlineVisualizationSourceOwner } from '../inline-visualization-source-owner'
import { deleteSessionWithVisualizations } from '../session-visualization-deletion'

const sessionId = SessionId('source-owner')
const session = {
  id: sessionId,
  title: 'Not in the DTO',
  projectPath: '/checkout',
  environmentMode: 'worktree',
  worktreePath: '/worktree',
  createdAt: 1,
  updatedAt: 1,
} as const
const listByIds = vi.fn<SessionRepositoryShape['listByIds']>()
const prepareSession = vi.fn<InlineVisualizationServiceShape['prepareSession']>()
const stageSessionDeletion = vi.fn<InlineVisualizationServiceShape['stageSessionDeletion']>()
const deleteSession = vi.fn<SessionProjectionRepositoryShape['delete']>()
const layer = Layer.mergeAll(
  Layer.succeed(SessionRepository, fromPartial<SessionRepositoryShape>({ listByIds })),
  Layer.succeed(
    InlineVisualizationService,
    fromPartial<InlineVisualizationServiceShape>({ prepareSession, stageSessionDeletion }),
  ),
  Layer.succeed(
    SessionProjectionRepository,
    fromPartial<SessionProjectionRepositoryShape>({ delete: deleteSession }),
  ),
)

beforeEach(() => {
  vi.resetAllMocks()
  listByIds.mockReturnValue(Effect.succeed([session]))
  prepareSession.mockReturnValue(Effect.succeed('/visualizations/source-owner'))
  stageSessionDeletion.mockReturnValue(
    Effect.succeed({ commit: Effect.void, rollback: Effect.void }),
  )
  deleteSession.mockReturnValue(Effect.void)
})

describe('prepareInlineVisualizationSourceOwner', () => {
  it('prepares only the exact requested owner and returns only working-root metadata', async () => {
    await expect(
      Effect.runPromise(
        prepareInlineVisualizationSourceOwner(sessionId).pipe(Effect.provide(layer)),
      ),
    ).resolves.toEqual({
      id: sessionId,
      projectPath: '/checkout',
      environmentMode: 'worktree',
      worktreePath: '/worktree',
    })
    expect(listByIds).toHaveBeenCalledExactlyOnceWith([sessionId])
    expect(prepareSession).toHaveBeenCalledExactlyOnceWith(sessionId)
  })

  it.each([null, 42, '', ' '])(
    'rejects invalid owner input %j before lookup or recovery',
    async (input) => {
      await expect(
        Effect.runPromise(prepareInlineVisualizationSourceOwner(input).pipe(Effect.provide(layer))),
      ).rejects.toThrow()
      expect(listByIds).not.toHaveBeenCalled()
      expect(prepareSession).not.toHaveBeenCalled()
    },
  )

  it.each([
    { reason: 'missing', owners: [] },
    { reason: 'different', owners: [{ ...session, id: SessionId('different') }] },
    { reason: 'duplicate', owners: [session, session] },
  ])('does not prepare a $reason owner', async ({ owners }) => {
    listByIds.mockReturnValue(Effect.succeed(owners))
    await expect(
      Effect.runPromise(
        prepareInlineVisualizationSourceOwner(sessionId).pipe(Effect.provide(layer)),
      ),
    ).resolves.toBeNull()
    expect(prepareSession).not.toHaveBeenCalled()
  })

  it('allows source preparation while its Pi run owns the session writer', async () => {
    const writer = reserveActiveSessionRun(sessionId, 'visualization-producing-run')
    try {
      await expect(
        Effect.runPromise(
          prepareInlineVisualizationSourceOwner(sessionId).pipe(Effect.provide(layer)),
        ),
      ).resolves.toMatchObject({ id: sessionId })
    } finally {
      writer.release()
    }
  })

  it('finishes admitted source recovery before deletion can stage or remove the owner', async () => {
    const preparationStarted = Promise.withResolvers<void>()
    const finishPreparation = Promise.withResolvers<string>()
    prepareSession.mockImplementation(() =>
      Effect.promise(() => {
        preparationStarted.resolve()
        return finishPreparation.promise
      }),
    )
    const preparing = Effect.runPromise(
      prepareInlineVisualizationSourceOwner(sessionId).pipe(Effect.provide(layer)),
    )
    await preparationStarted.promise
    const deleting = Effect.runPromise(
      deleteSessionWithVisualizations(sessionId).pipe(Effect.provide(layer)),
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    try {
      expect(stageSessionDeletion).not.toHaveBeenCalled()
      expect(deleteSession).not.toHaveBeenCalled()
    } finally {
      finishPreparation.resolve('/visualizations/source-owner')
      await Promise.all([preparing, deleting])
    }
    expect(stageSessionDeletion).toHaveBeenCalledOnce()
    expect(deleteSession).toHaveBeenCalledOnce()
  })

  it('holds deletion ordering until admitted recovery settles even if its caller cancels', async () => {
    const preparationStarted = Promise.withResolvers<void>()
    const finishPreparation = Promise.withResolvers<string>()
    prepareSession.mockImplementation(() =>
      Effect.promise(() => {
        preparationStarted.resolve()
        return finishPreparation.promise
      }),
    )
    const preparing = Effect.runFork(
      prepareInlineVisualizationSourceOwner(sessionId).pipe(Effect.provide(layer)),
    )
    await preparationStarted.promise
    const interrupting = Effect.runPromise(Fiber.interrupt(preparing))
    const deleting = Effect.runPromise(
      deleteSessionWithVisualizations(sessionId).pipe(Effect.provide(layer)),
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    try {
      expect(stageSessionDeletion).not.toHaveBeenCalled()
      expect(deleteSession).not.toHaveBeenCalled()
    } finally {
      finishPreparation.resolve('/visualizations/source-owner')
      await Promise.all([interrupting, deleting])
    }
    expect(stageSessionDeletion).toHaveBeenCalledOnce()
    expect(deleteSession).toHaveBeenCalledOnce()
  })
})
