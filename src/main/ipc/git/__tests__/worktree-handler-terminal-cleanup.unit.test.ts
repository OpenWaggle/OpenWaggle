import type { GitWorktreeMutationResult } from '@shared/types/git'
import { Layer } from 'effect'
import * as EffectModule from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalService } from '../../../ports/terminal-service'

type WorktreeRemoveHandler = (
  event: unknown,
  projectPath: unknown,
  payload: unknown,
) => EffectModule.Effect<GitWorktreeMutationResult, unknown, TerminalService>

const handlers = new Map<string, WorktreeRemoveHandler>()

const mocks = vi.hoisted(() => {
  const statusInvalidations: Array<string | undefined> = []
  return {
    removeGitWorktree: vi.fn(),
    statusInvalidations,
  }
})

vi.mock('../../typed-ipc', () => ({
  typedHandle: vi.fn((channel: string, handler: WorktreeRemoveHandler) => {
    handlers.set(channel, handler)
  }),
}))

vi.mock('../worktree-service', () => ({
  createGitWorktree: vi.fn(),
  listGitWorktrees: vi.fn(),
  removeGitWorktree: mocks.removeGitWorktree,
}))

vi.mock('../status-cache', () => ({
  invalidateGitStatusCache: (path?: string) => {
    mocks.statusInvalidations.push(path)
  },
}))

const closeAllUnderPathCalls: Array<readonly [string, boolean]> = []

const RecordingTerminalServiceLayer = Layer.succeed(
  TerminalService,
  TerminalService.of({
    open: () => EffectModule.succeed({ history: '', outputBytes: 0, running: false }),
    write: () => EffectModule.void,
    resize: () => EffectModule.void,
    clear: () => EffectModule.void,
    restart: () => EffectModule.succeed({ history: '', outputBytes: 0, running: false }),
    close: () => EffectModule.void,
    closeAllForOwner: () => EffectModule.void,
    closeAllUnderPath: (directoryPath, deleteHistory) => {
      closeAllUnderPathCalls.push([directoryPath, deleteHistory])
      return EffectModule.void
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
    EffectModule.provide(handler({}, PROJECT_PATH, payload), RecordingTerminalServiceLayer),
  )
}

describe('git:worktrees:remove terminal cleanup', () => {
  beforeEach(() => {
    handlers.clear()
    mocks.statusInvalidations.length = 0
    closeAllUnderPathCalls.length = 0
    mocks.removeGitWorktree.mockReset()
  })

  it('closes terminals under the removed path with history deletion on success', async () => {
    mocks.removeGitWorktree.mockResolvedValue(REMOVE_SUCCESS)
    registerGitWorktreeHandlers()

    const result = await invokeRemove({ path: WORKTREE_PATH })

    expect(result).toEqual(REMOVE_SUCCESS)
    expect(closeAllUnderPathCalls).toEqual([[WORKTREE_PATH, true]])
    expect(mocks.statusInvalidations).toContain(WORKTREE_PATH)
  })

  it('leaves terminals and caches alone when the worktree removal fails', async () => {
    mocks.removeGitWorktree.mockResolvedValue(REMOVE_FAILURE)
    registerGitWorktreeHandlers()

    const result = await invokeRemove({ path: WORKTREE_PATH })

    expect(result).toEqual(REMOVE_FAILURE)
    expect(closeAllUnderPathCalls).toEqual([])
    expect(mocks.statusInvalidations).toEqual([])
  })
})
