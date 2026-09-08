import type { GitWorktreeMutationResult } from '@shared/types/git'
import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProjectionRepositoryError } from '../../../errors'
import { PINNED_SESSION_REPOSITORY_STUB } from '../../../ports/__tests__/session-projection-pin-stub'
import {
  SessionProjectionRepository,
  type SessionProjectionRepositoryShape,
} from '../../../ports/session-projection-repository'

type WorktreeCreateHandler = (
  event: unknown,
  projectPath: unknown,
  payload: unknown,
) => Effect.Effect<GitWorktreeMutationResult, unknown, SessionProjectionRepository>

const handlers = new Map<string, WorktreeCreateHandler>()
const operationOrder: string[] = []
const resetWorktreeSetupMock = vi.fn<SessionProjectionRepositoryShape['resetWorktreeSetup']>(() =>
  Effect.sync(() => {
    operationOrder.push('setup-pending')
  }),
)

const mocks = vi.hoisted(() => ({
  createGitWorktree: vi.fn(),
  invalidateGitStatusCache: vi.fn(),
  resolveSessionWorktreeBranch: vi.fn(async () => 'ow/session-session-1'),
}))

vi.mock('../../typed-ipc', () => ({
  typedHandle: vi.fn((channel: string, handler: WorktreeCreateHandler) => {
    handlers.set(channel, handler)
  }),
}))

vi.mock('../worktree-service', () => ({
  createGitWorktree: mocks.createGitWorktree,
  listGitWorktrees: vi.fn(),
  removeGitWorktree: vi.fn(),
}))

vi.mock('../status-cache', () => ({
  invalidateGitStatusCache: mocks.invalidateGitStatusCache,
}))

vi.mock('../../../services/git/session-branch-resolution', () => ({
  resolveSessionWorktreeBranch: mocks.resolveSessionWorktreeBranch,
}))

const SessionProjectionLayer = Layer.succeed(
  SessionProjectionRepository,
  SessionProjectionRepository.of({
    get: () => Effect.dieMessage('not used'),
    getOptional: () => Effect.succeed(null),
    list: () => Effect.succeed([]),
    listDetails: () => Effect.succeed([]),
    create: () => Effect.dieMessage('not used'),
    delete: () => Effect.void,
    archive: () => Effect.void,
    unarchive: () => Effect.void,
    listArchived: () => Effect.succeed([]),
    updateTitle: () => Effect.void,
    setWorktreePlan: () => Effect.void,
    setAuthorizationMode: () => Effect.void,
    listTurnCheckpoints: () => Effect.succeed([]),
    getTurnDiff: () => Effect.succeed(null),
    setTurnCheckpointAnchor: () => Effect.void,
    ...PINNED_SESSION_REPOSITORY_STUB,
    resetWorktreeSetup: resetWorktreeSetupMock,
  }),
)

const { registerGitWorktreeHandlers } = await import('../worktree-handler')

async function invokeCreate(payload: unknown) {
  const handler = handlers.get('git:worktrees:create')
  if (!handler) throw new Error('the worktree create handler was not registered')
  return Effect.runPromise(Effect.provide(handler({}, '/repo', payload), SessionProjectionLayer))
}

describe('git:worktrees:create Setup dispatch durability', () => {
  beforeEach(() => {
    handlers.clear()
    operationOrder.length = 0
    resetWorktreeSetupMock.mockReset().mockImplementation(() =>
      Effect.sync(() => {
        operationOrder.push('setup-pending')
      }),
    )
    mocks.createGitWorktree.mockReset().mockImplementation(async () => {
      operationOrder.push('git-create')
      return { ok: true, message: 'created', path: '/worktree' }
    })
    mocks.invalidateGitStatusCache.mockReset()
    mocks.resolveSessionWorktreeBranch.mockReset().mockResolvedValue('ow/session-session-1')
  })

  it('persists a new Setup generation before manually recreating a Session worktree', async () => {
    registerGitWorktreeHandlers()

    await expect(
      invokeCreate({
        path: '/worktree',
        branch: 'renderer-value-is-ignored',
        baseRef: 'main',
        sessionId: 'session-1',
      }),
    ).resolves.toMatchObject({ ok: true })

    expect(resetWorktreeSetupMock).toHaveBeenCalledWith('session-1', '/worktree')
    expect(operationOrder).toEqual(['setup-pending', 'git-create'])
    expect(mocks.createGitWorktree).toHaveBeenCalledWith('/repo', {
      path: '/worktree',
      branch: 'ow/session-session-1',
      baseRef: 'main',
      sessionId: 'session-1',
    })
  })

  it('does not mutate Git when the Session does not own the recreation path', async () => {
    resetWorktreeSetupMock.mockImplementation(() =>
      Effect.fail(
        new SessionProjectionRepositoryError({
          operation: 'resetWorktreeSetup',
          cause: new Error('The Session does not own this recorded worktree path.'),
        }),
      ),
    )
    registerGitWorktreeHandlers()

    await expect(
      invokeCreate({
        path: '/other-worktree',
        branch: 'ignored',
        baseRef: 'main',
        sessionId: 'session-1',
      }),
    ).rejects.toThrow()

    expect(mocks.createGitWorktree).not.toHaveBeenCalled()
  })
})
