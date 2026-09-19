import type { Effect } from 'effect/Effect'
import { runPromise } from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitExecResult } from '../../../adapters/git/run-git'

const git = vi.hoisted(() => ({
  probe: vi.fn<(path: string) => Promise<boolean>>(),
  run: vi.fn<(path: string, args: string[]) => Promise<GitExecResult>>(),
}))

// Git process execution and IPC transport are the boundaries; use real status/branch readers.
vi.mock('../../../adapters/git/run-git', async (original) => ({
  ...(await original<typeof import('../../../adapters/git/run-git')>()),
  isGitRepository: git.probe,
  runGit: git.run,
}))
vi.mock('../../../utils/broadcast', () => ({ broadcastToWindows: vi.fn() }))

type ReadHandler = (event: unknown, path: unknown) => Effect<unknown, never, never>
const handlers = new Map<string, ReadHandler>()
vi.mock('../../typed-ipc', () => ({
  typedHandle: (channel: string, handler: ReadHandler) => handlers.set(channel, handler),
}))

const { registerGitStatusHandlers } = await import('../status-handler')
const { registerGitBranchHandlers } = await import('../branches-handler')
const { invalidateGitStatusCache } = await import('../status-cache')

function read(channel = 'git:status', path = '/repo') {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`Missing read handler: ${channel}`)
  return runPromise(handler({}, path))
}

describe('concurrent Git reads', () => {
  afterEach(() => vi.useRealTimers())
  beforeEach(() => {
    invalidateGitStatusCache()
    git.probe.mockReset().mockResolvedValue(true)
    git.run.mockReset().mockImplementation(async (_path, args) => ({
      code: 0,
      stdout: args.includes('--abbrev-ref') ? 'main\n' : '',
      stderr: '',
    }))
    registerGitStatusHandlers()
    registerGitBranchHandlers()
  })

  it('shares one status lookup among simultaneous consumers of the same working tree', async () => {
    const ready = Promise.withResolvers<boolean>()
    git.probe.mockReturnValue(ready.promise)
    const readers = Array.from({ length: 4 }, () => read())
    ready.resolve(true)
    await expect(Promise.all(readers)).resolves.toEqual(
      Array.from({ length: 4 }, () => expect.objectContaining({ branch: 'main' })),
    )
    expect(git.probe).toHaveBeenCalledOnce()
  })

  it('shares a pending branch list without retaining a completed list', async () => {
    const ready = Promise.withResolvers<boolean>()
    git.probe.mockReturnValue(ready.promise)
    const readers = Array.from({ length: 3 }, () => read('git:branches:list'))
    ready.resolve(true)
    await expect(Promise.all(readers)).resolves.toEqual(
      Array.from({ length: 3 }, () => ({ currentBranch: 'main', branches: [] })),
    )
    expect(git.probe).toHaveBeenCalledOnce()
    await read('git:branches:list')
    expect(git.probe).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['git:status', '/repo/src'],
    ['git:branches:list', '/outside/worktrees/worker'],
  ])(
    'invalidates pending %s without letting its old completion remove the new read',
    async (channel, changedPath) => {
      const oldHead = Promise.withResolvers<GitExecResult>()
      const newHead = Promise.withResolvers<GitExecResult>()
      let headReads = 0
      git.run.mockImplementation(async (_path, args) => {
        if (!args.includes('--abbrev-ref')) return { code: 0, stdout: '', stderr: '' }
        headReads += 1
        return headReads === 1 ? oldHead.promise : newHead.promise
      })
      const old = read(channel)
      await vi.waitFor(() => expect(headReads).toBe(1))
      invalidateGitStatusCache(changedPath)
      const fresh = read(channel)
      await vi.waitFor(() => expect(headReads).toBe(2))
      oldHead.resolve({ code: 0, stdout: 'old', stderr: '' })
      await old
      const joined = read(channel)
      newHead.resolve({ code: 0, stdout: 'new', stderr: '' })
      const expected = channel === 'git:status' ? { branch: 'new' } : { currentBranch: 'new' }
      for (const result of await Promise.all([fresh, joined])) {
        expect(result).toMatchObject(expected)
      }
      expect(git.probe).toHaveBeenCalledTimes(2)
      if (channel === 'git:status') {
        await expect(read()).resolves.toMatchObject(expected)
        expect(git.probe).toHaveBeenCalledTimes(2)
      }
    },
  )

  it.each(['git:status', 'git:branches:list'])(
    'does not retain a failed %s read',
    async (channel) => {
      git.probe.mockRejectedValueOnce(new Error('temporary Git failure'))
      const results = await Promise.allSettled([read(channel), read(channel)])
      expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected'])
      expect(git.probe).toHaveBeenCalledOnce()
      await read(channel)
      expect(git.probe).toHaveBeenCalledTimes(2)
    },
  )

  it.each(['git:status', 'git:branches:list'])(
    'keeps different working trees isolated for %s',
    async (channel) => {
      const ready = Promise.withResolvers<boolean>()
      git.probe.mockReturnValue(ready.promise)
      git.run.mockImplementation(async (path, args) => ({
        code: 0,
        stdout: args.includes('--abbrev-ref') ? path : '',
        stderr: '',
      }))
      const readers = [read(channel, '/alpha'), read(channel, '/beta')]
      ready.resolve(true)
      const field = channel === 'git:status' ? 'branch' : 'currentBranch'
      await expect(Promise.all(readers)).resolves.toEqual([
        expect.objectContaining({ [field]: '/alpha' }),
        expect.objectContaining({ [field]: '/beta' }),
      ])
      expect(git.probe).toHaveBeenCalledTimes(2)
    },
  )

  it.each(['git:status', 'git:branches:list'])(
    'lets a later %s refresh recover from a stalled read without stale publication',
    async (channel) => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(1_000)
      const oldHead = Promise.withResolvers<GitExecResult>()
      const newHead = Promise.withResolvers<GitExecResult>()
      let headReads = 0
      git.run.mockImplementation(async (_path, args) => {
        if (!args.includes('--abbrev-ref')) return { code: 0, stdout: '', stderr: '' }
        headReads += 1
        return headReads === 1 ? oldHead.promise : newHead.promise
      })
      const old = read(channel)
      await vi.waitFor(() => expect(headReads).toBe(1))
      vi.setSystemTime(32_000)
      const fresh = read(channel)
      try {
        await vi.waitFor(() => expect(headReads).toBe(2))
        newHead.resolve({ code: 0, stdout: 'new', stderr: '' })
        await fresh
        oldHead.resolve({ code: 0, stdout: 'old', stderr: '' })
        await old
        const expected = channel === 'git:status' ? { branch: 'new' } : { currentBranch: 'new' }
        await expect(read(channel)).resolves.toMatchObject(expected)
      } finally {
        oldHead.resolve({ code: 0, stdout: 'old', stderr: '' })
        newHead.resolve({ code: 0, stdout: 'new', stderr: '' })
        await Promise.all([old, fresh])
      }
    },
  )
})
