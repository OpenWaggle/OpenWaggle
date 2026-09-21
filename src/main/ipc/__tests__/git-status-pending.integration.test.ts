import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  execFileMock,
  loadGitHandlers,
  registeredHandler,
  resetGitHandlerMocks,
} from './git-handler.test-harness'

vi.mock('../../utils/broadcast', () => ({ broadcastToWindows: vi.fn() }))

interface RepositoryCheck {
  readonly path: string
  readonly complete: (error: Error | null, stdout: string, stderr: string) => void
}

describe('Git status pending request coalescing', () => {
  const checks: RepositoryCheck[] = []
  let invalidate: Awaited<ReturnType<typeof loadGitHandlers>>['invalidateGitStatusCache']
  let readStatus: NonNullable<ReturnType<typeof registeredHandler>>

  beforeEach(async () => {
    resetGitHandlerMocks()
    checks.length = 0
    const handlers = await loadGitHandlers()
    invalidate = handlers.invalidateGitStatusCache
    invalidate()
    handlers.registerGitHandlers()
    const handler = registeredHandler('git:status')
    if (!handler) throw new Error('Git status handler was not registered.')
    readStatus = handler
    execFileMock.mockImplementation(
      (
        _command: string,
        args: string[],
        options: { readonly cwd: string },
        complete: RepositoryCheck['complete'],
      ) => {
        if (args.join(' ') === 'rev-parse --is-inside-work-tree') {
          checks.push({ path: options.cwd, complete })
          return
        }
        complete(null, args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? 'main\n' : '', '')
      },
    )
  })

  it('shares pending reads for one path without blocking disjoint paths or later refreshes', async () => {
    const pending = [
      ...Array.from({ length: 10 }, () => readStatus({}, '/tmp/tree-a')),
      readStatus({}, '/tmp/tree-b'),
    ]
    await vi.waitFor(() => expect(checks.length).toBeGreaterThan(0))
    const launchedPaths = checks.map(({ path }) => path).sort()
    for (const check of checks.splice(0)) check.complete(null, 'true\n', '')
    await Promise.all(pending)
    expect(launchedPaths).toEqual(['/tmp/tree-a', '/tmp/tree-b'])

    await readStatus({}, '/tmp/tree-a')
    expect(checks).toEqual([])
    invalidate('/tmp/tree-a')
    const refresh = readStatus({}, '/tmp/tree-a')
    await vi.waitFor(() => expect(checks).toHaveLength(1))
    checks[0]?.complete(null, 'true\n', '')
    await expect(refresh).resolves.toMatchObject({ branch: 'main' })
  })

  it('releases rejected pending reads so a retry can succeed', async () => {
    const pending = Array.from({ length: 3 }, () => readStatus({}, '/tmp/retry'))
    const outcomes = Promise.allSettled(pending)
    await vi.waitFor(() => expect(checks.length).toBeGreaterThan(0))
    const launched = checks.length
    for (const check of checks.splice(0)) check.complete(new Error('Git unavailable'), '', '')
    expect((await outcomes).every(({ status }) => status === 'rejected')).toBe(true)
    expect(launched).toBe(1)

    const retry = readStatus({}, '/tmp/retry')
    await vi.waitFor(() => expect(checks).toHaveLength(1))
    checks[0]?.complete(null, 'true\n', '')
    await expect(retry).resolves.toMatchObject({ branch: 'main' })
  })

  it('does not reuse an invalidated pending ancestor or erase its replacement on completion', async () => {
    const old = readStatus({}, '/tmp/ancestor')
    await vi.waitFor(() => expect(checks).toHaveLength(1))
    invalidate('/tmp/ancestor/src')
    const fresh = readStatus({}, '/tmp/ancestor')
    await vi.waitFor(() => expect(checks).toHaveLength(2))
    checks[0]?.complete(null, 'true\n', '')
    await old
    const shared = readStatus({}, '/tmp/ancestor')
    await Promise.resolve()
    expect(checks).toHaveLength(2)
    checks[1]?.complete(null, 'true\n', '')
    await Promise.all([fresh, shared])
  })
})
