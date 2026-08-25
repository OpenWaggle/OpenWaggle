import { tmpdir } from 'node:os'
import type { Effect } from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'

const { invalidatedVcsPaths, invalidatedStatusPaths } = vi.hoisted(() => {
  const vcs: (string | undefined)[] = []
  const status: (string | undefined)[] = []
  return { invalidatedVcsPaths: vcs, invalidatedStatusPaths: status }
})

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir(), getName: () => 'openwaggle-test' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))
vi.mock('../vcs-status-cache', () => ({
  invalidateVcsStatus: (path?: string) => invalidatedVcsPaths.push(path),
}))
vi.mock('../status-cache', () => ({
  invalidateGitStatusCache: (path?: string) => invalidatedStatusPaths.push(path),
}))
vi.mock('../branch-mutations', () => ({
  checkoutGitBranch: vi.fn(async () => ({ ok: true, message: 'Switched branch.' })),
  createGitBranch: vi.fn(async () => ({ ok: true, message: 'Created branch.' })),
}))

type BranchHandler = (
  event: unknown,
  path: unknown,
  payload: unknown,
) => Effect<unknown, never, never>

const handlers = new Map<string, BranchHandler>()
vi.mock('../../typed-ipc', () => ({
  typedHandle: (channel: string, handler: BranchHandler) => {
    handlers.set(channel, handler)
  },
}))

const { registerGitBranchHandlers } = await import('../branches-handler')
const { runPromise } = await import('effect/Effect')

/**
 * A checkout moves HEAD, so the cached VCS status describes the branch the user has left. That status carries
 * `isDefaultRef`, which the confirmation before a push to the default branch waits on - so leaving it cached
 * meant checking out the default branch and pressing Commit & push within the cache window pushed to it with no
 * confirmation at all.
 */
describe('checking out a branch', () => {
  it('invalidates the VCS status the default-branch confirmation reads', async () => {
    registerGitBranchHandlers()
    const checkout = handlers.get('git:branches:checkout')
    if (!checkout) throw new Error('the checkout handler was not registered')

    await runPromise(checkout({}, '/repo', { name: 'main' }))

    expect(invalidatedVcsPaths).toContain('/repo')
    expect(invalidatedStatusPaths).toContain('/repo')
  })
})
