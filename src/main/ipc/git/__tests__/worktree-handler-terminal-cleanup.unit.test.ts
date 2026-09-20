import type { GitWorktreeMutationResult } from '@shared/types/git'
import { fromPartial } from '@total-typescript/shoehorn'
import { Layer } from 'effect'
import * as EffectModule from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GitWorktreeService } from '../../../ports/git-worktree-service'
import { SessionWorkspaceResourceRepository } from '../../../ports/session-workspace-resource-repository'
import { TerminalService } from '../../../ports/terminal-service'

type WorktreeRemoveHandler = (
  event: unknown,
  projectPath: unknown,
  payload: unknown,
) => EffectModule.Effect<
  GitWorktreeMutationResult,
  unknown,
  TerminalService | GitWorktreeService | SessionWorkspaceResourceRepository
>

const handlers = new Map<string, WorktreeRemoveHandler>()

const mocks = vi.hoisted(() => {
  const statusInvalidations: Array<string | undefined> = []
  return {
    removeGitWorktree: vi.fn(),
    statusInvalidations,
  }
})

vi.mock('../../typed-ipc', () => ({
  hostHandle: vi.fn((channel: string, handler: WorktreeRemoveHandler) => {
    handlers.set(channel, handler)
  }),
  typedHandle: vi.fn((channel: string, handler: WorktreeRemoveHandler) => {
    handlers.set(channel, handler)
  }),
}))

vi.mock('../worktree-service', () => ({
  createGitWorktree: vi.fn(),
  listGitWorktrees: vi.fn(),
  removeGitWorktree: mocks.removeGitWorktree,
}))

vi.mock('../../../services/git-status-cache', () => ({
  invalidateGitStatusCache: (path?: string) => {
    mocks.statusInvalidations.push(path)
  },
}))

const closeAllUnderPathCalls: Array<readonly [string, boolean]> = []
const operationOrder: string[] = []
const mutationScopes: unknown[] = []
let closeAllUnderPathFailure: Error | null = null
let historyCleanupError: Error | null = null

const RecordingTerminalServiceLayer = Layer.succeed(
  TerminalService,
  TerminalService.of({
    getActivitySnapshot: () =>
      EffectModule.succeed({ revision: 0, summaries: [], truncated: false }),
    open: () =>
      EffectModule.succeed({
        history: '',
        outputBytes: 0,
        outputGeneration: 0,
        readiness: null,
        running: false,
        processName: null,
        ports: [],
        projectActionPending: false,
      }),
    write: () => EffectModule.succeed({ status: 'written', acceptedBytes: 0 }),
    sendInputNow: () => EffectModule.succeed({ status: 'already-ready', releasedBytes: 0 }),
    acknowledgeOutput: () => EffectModule.void,
    migrateOwner: () => EffectModule.succeed({ terminalIds: [] }),
    resize: () => EffectModule.void,
    clear: () => EffectModule.void,
    restart: () =>
      EffectModule.succeed({
        history: '',
        outputBytes: 0,
        outputGeneration: 0,
        readiness: null,
        running: false,
        processName: null,
        ports: [],
        projectActionPending: false,
      }),
    assessClose: () => EffectModule.succeed({ disposition: 'safe', reason: 'dead' }),
    close: () => EffectModule.void,
    closeAllForOwner: () => EffectModule.void,
    closeAllUnderPath: (directoryPath, deleteHistory) => {
      closeAllUnderPathCalls.push([directoryPath, deleteHistory])
      operationOrder.push(`terminal:${deleteHistory ? 'delete' : 'stop'}`)
      const failure = deleteHistory ? historyCleanupError : closeAllUnderPathFailure
      return failure === null ? EffectModule.void : EffectModule.fail(failure)
    },
    runWithMutationFence: (scope, operation) => {
      mutationScopes.push(scope)
      return operation
    },
    attachSurface: () => EffectModule.void,
    detachTerminal: () => EffectModule.void,
    detachSurface: () => EffectModule.void,
    closeAll: () => EffectModule.void,
  }),
)

const PROJECT_PATH = '/repo'
const WORKTREE_PATH = '/repo/.worktrees/session-1'
const REMOVE_SUCCESS: GitWorktreeMutationResult = {
  ok: true,
  message: 'Worktree removed.',
  path: WORKTREE_PATH,
}
const REMOVE_FAILURE: GitWorktreeMutationResult = {
  ok: false,
  code: 'not-git-repo',
  message: 'Not a git repository.',
}

const { registerGitWorktreeHandlers } = await import('../worktree-handler')
const { runPromise } = await import('effect/Effect')

async function invokeRemove(payload: unknown): Promise<GitWorktreeMutationResult> {
  const handler = handlers.get('git:worktrees:remove')
  if (!handler) throw new Error('the worktree remove handler was not registered')
  return runPromise(
    EffectModule.provide(
      handler({}, PROJECT_PATH, payload),
      Layer.mergeAll(
        RecordingTerminalServiceLayer,
        Layer.succeed(GitWorktreeService, {
          create: () => EffectModule.dieMessage('not used'),
          remove: (projectPath, input) =>
            EffectModule.promise(() => mocks.removeGitWorktree(projectPath, input)),
        }),
        Layer.succeed(
          SessionWorkspaceResourceRepository,
          fromPartial<SessionWorkspaceResourceRepository['Type']>({
            listManagedWorktreeRemovalCandidates: () => EffectModule.succeed([]),
            admitManagedWorktreeRemoval: () =>
              EffectModule.succeed({
                status: 'reserved',
                resourceId: 'removal-resource',
                createdReservation: true,
              }),
            finalizeManagedWorktreeRemoval: () => EffectModule.void,
          }),
        ),
      ),
    ),
  )
}

describe('git:worktrees:remove terminal cleanup', () => {
  beforeEach(() => {
    handlers.clear()
    mocks.statusInvalidations.length = 0
    closeAllUnderPathCalls.length = 0
    operationOrder.length = 0
    mutationScopes.length = 0
    closeAllUnderPathFailure = null
    historyCleanupError = null
    mocks.removeGitWorktree.mockReset()
    mocks.removeGitWorktree.mockImplementation(async () => {
      operationOrder.push('git')
      return REMOVE_SUCCESS
    })
  })

  it('stops terminals before Git and deletes retained history only after success', async () => {
    registerGitWorktreeHandlers()

    const result = await invokeRemove({ path: WORKTREE_PATH })

    expect(result).toEqual(REMOVE_SUCCESS)
    expect(closeAllUnderPathCalls).toEqual([
      [WORKTREE_PATH, false],
      [WORKTREE_PATH, true],
    ])
    expect(operationOrder).toEqual(['terminal:stop', 'git', 'terminal:delete'])
    expect(mutationScopes).toEqual([{ kind: 'path', directoryPath: WORKTREE_PATH }])
    expect(mocks.statusInvalidations).toContain(WORKTREE_PATH)
  })

  it('stops terminals but retains history when Git refuses the removal', async () => {
    mocks.removeGitWorktree.mockImplementation(async () => {
      operationOrder.push('git')
      return REMOVE_FAILURE
    })
    registerGitWorktreeHandlers()

    const result = await invokeRemove({ path: WORKTREE_PATH })

    expect(result).toEqual(REMOVE_FAILURE)
    expect(closeAllUnderPathCalls).toEqual([[WORKTREE_PATH, false]])
    expect(operationOrder).toEqual(['terminal:stop', 'git'])
    expect(mocks.statusInvalidations).toEqual([])
  })

  it('does not call Git when terminal shutdown fails', async () => {
    closeAllUnderPathFailure = new Error('terminal shutdown failed')
    registerGitWorktreeHandlers()

    await expect(invokeRemove({ path: WORKTREE_PATH })).rejects.toThrow('terminal shutdown failed')

    expect(mocks.removeGitWorktree).not.toHaveBeenCalled()
    expect(operationOrder).toEqual(['terminal:stop'])
    expect(mocks.statusInvalidations).toEqual([])
  })

  it('returns Git success and invalidates caches when deferred history cleanup fails', async () => {
    historyCleanupError = new Error('history cleanup failed')
    registerGitWorktreeHandlers()

    await expect(invokeRemove({ path: WORKTREE_PATH })).resolves.toEqual(REMOVE_SUCCESS)

    expect(operationOrder).toEqual(['terminal:stop', 'git', 'terminal:delete'])
    expect(mocks.statusInvalidations).toEqual([WORKTREE_PATH, PROJECT_PATH])
  })

  it('rejects relative paths before stopping terminals or mutating Git', async () => {
    registerGitWorktreeHandlers()

    await expect(invokeRemove({ path: '.worktrees/session-1' })).rejects.toThrow()

    expect(closeAllUnderPathCalls).toEqual([])
    expect(mocks.removeGitWorktree).not.toHaveBeenCalled()
    expect(mocks.statusInvalidations).toEqual([])
  })
})
