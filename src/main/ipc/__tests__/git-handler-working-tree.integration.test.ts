import { match } from '@diegogbrisa/ts-match'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  execFileMock,
  fromWebContentsMock,
  loadGitHandlers,
  registeredHandler,
  resetGitHandlerMocks,
  showMessageBoxMock,
} from './git-handler.test-harness'

describe('registerGitHandlers working-tree actions', () => {
  let registerGitHandlers: Awaited<ReturnType<typeof loadGitHandlers>>['registerGitHandlers']
  let invalidateGitStatusCache: Awaited<
    ReturnType<typeof loadGitHandlers>
  >['invalidateGitStatusCache']

  beforeEach(async () => {
    resetGitHandlerMocks()
    ;({ invalidateGitStatusCache, registerGitHandlers } = await loadGitHandlers())
    invalidateGitStatusCache()
  })

  it('registers stage-all and runs Git without shell interpolation', async () => {
    execFileMock.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        match(args.join(' '))
          .with('rev-parse --is-inside-work-tree', () => callback(null, 'true\n', ''))
          .with('add --all -- :/', () => callback(null, '', ''))
          .otherwise(() =>
            callback(new Error(`Unexpected Git arguments: ${args.join(' ')}`), '', ''),
          )
      },
    )

    registerGitHandlers()
    const handler = registeredHandler('git:working-tree:stage-all')

    expect(handler).toBeDefined()
    await expect(handler?.({}, '/tmp/repo')).resolves.toEqual({
      ok: true,
      message: 'All working-tree changes staged.',
    })
    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['add', '--all', '--', ':/'],
      expect.objectContaining({ cwd: '/tmp/repo' }),
      expect.any(Function),
    )
  })

  it('registers revert-all and executes the documented reset and clean contract', async () => {
    showMessageBoxMock.mockResolvedValue({ response: 1 })
    execFileMock.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        match(args.join(' '))
          .with('rev-parse --is-inside-work-tree', () => callback(null, 'true\n', ''))
          .with('rev-parse --verify HEAD', () => callback(null, 'abc123\n', ''))
          .with('rev-parse --show-toplevel', () => callback(null, '/tmp/repo\n', ''))
          .with('ls-tree -r -z --name-only HEAD', () => callback(null, '', ''))
          .with('ls-files -z', () => callback(null, '', ''))
          .with('ls-files --stage -z', () => callback(null, '', ''))
          .with('reset --hard HEAD', () => callback(null, 'HEAD is now at abc123\n', ''))
          .with('clean -fd -- :/', () => callback(null, 'Removing untracked.txt\n', ''))
          .otherwise(() =>
            callback(new Error(`Unexpected Git arguments: ${args.join(' ')}`), '', ''),
          )
      },
    )

    registerGitHandlers()
    const handler = registeredHandler('git:working-tree:revert-all')

    expect(handler).toBeDefined()
    await expect(handler?.({ sender: { id: 'renderer' } }, '/tmp/repo')).resolves.toEqual({
      ok: true,
      message: 'All eligible working-tree changes reverted.',
    })
    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['reset', '--hard', 'HEAD'],
      expect.objectContaining({ cwd: '/tmp/repo' }),
      expect.any(Function),
    )
    expect(execFileMock).toHaveBeenCalledWith(
      'git',
      ['clean', '-fd', '--', ':/'],
      expect.objectContaining({ cwd: '/tmp/repo' }),
      expect.any(Function),
    )
  })

  it('requires main-process confirmation before invoking destructive Git commands', async () => {
    const commands: string[] = []
    execFileMock.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        commands.push(args.join(' '))
        // The opened folder is the repository root here.
        callback(null, '/tmp/repo\n', '')
      },
    )

    registerGitHandlers()
    const handler = registeredHandler('git:working-tree:revert-all')
    const sender = { id: 'renderer' }

    await expect(handler?.({ sender }, '/tmp/repo')).resolves.toEqual({
      ok: false,
      code: 'cancelled',
      message: 'Revert all cancelled.',
    })
    expect(showMessageBoxMock).toHaveBeenCalledOnce()
    expect(fromWebContentsMock).toHaveBeenCalledWith(sender)
    expect(showMessageBoxMock).toHaveBeenCalledWith(
      { id: 'owner-window' },
      {
        type: 'warning',
        buttons: ['Cancel', 'Confirm'],
        defaultId: 0,
        cancelId: 0,
        message: 'Revert all changes?',
        detail:
          'This resets all tracked and staged changes to HEAD and permanently deletes untracked files and folders. Ignored files and nested Git repositories are kept. If either would obstruct restoring HEAD, nothing is changed. This cannot be undone.',
      },
    )
    /*
     * Only the read-only root lookup that the dialog text needs may run before confirmation.
     * The property worth pinning is that nothing mutating does.
     */
    expect(commands).toEqual(['rev-parse --show-toplevel'])
  })

  it('names the repository root in the confirmation when a subdirectory was opened', async () => {
    /*
     * Revert all is re-based onto the repository root and uses whole-repository pathspecs.
     * Verified against real git that opening /repo/packages/app and confirming deletes untracked
     * files under /repo/other too - work the user never had in view. The dialog is the only gate
     * on the one irreversible action here, so it must state the scope it actually has.
     */
    execFileMock.mockImplementation(
      (
        _command: string,
        _args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => callback(null, '/tmp/repo\n', ''),
    )

    registerGitHandlers()
    const handler = registeredHandler('git:working-tree:revert-all')

    await handler?.({ sender: { id: 'renderer' } }, '/tmp/repo/packages/app')

    const detail = showMessageBoxMock.mock.calls.at(0)?.at(1)?.detail
    expect(detail).toContain('whole repository at /tmp/repo')
    expect(detail).toContain('not only the folder you opened (/tmp/repo/packages/app)')
  })

  it('invalidates cached status after a working-tree mutation', async () => {
    execFileMock.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        match(args.join(' '))
          .with('rev-parse --is-inside-work-tree', () => callback(null, 'true\n', ''))
          .with('rev-parse --abbrev-ref HEAD', () => callback(null, 'main\n', ''))
          .with('status --porcelain=v1', () => callback(null, ' M modified.txt\n', ''))
          .with('diff --numstat HEAD', () => callback(null, '1\t0\tmodified.txt\n', ''))
          .with('rev-list --left-right --count HEAD...@{upstream}', () =>
            callback(null, '0\t0\n', ''),
          )
          .with('add --all -- :/', () => callback(null, '', ''))
          .otherwise(() =>
            callback(new Error(`Unexpected Git arguments: ${args.join(' ')}`), '', ''),
          )
      },
    )

    registerGitHandlers()
    const statusHandler = registeredHandler('git:status')
    const stageHandler = registeredHandler('git:working-tree:stage-all')

    await statusHandler?.({}, '/tmp/repo')
    await statusHandler?.({}, '/tmp/repo')
    await stageHandler?.({}, '/tmp/repo')
    await statusHandler?.({}, '/tmp/repo')

    const statusCommandCalls = execFileMock.mock.calls.filter((call: unknown[]) => {
      const args = call[1]
      return Array.isArray(args) && args.join(' ') === 'status --porcelain=v1'
    })
    expect(statusCommandCalls).toHaveLength(2)
  })

  it('does not cache a status request that started before mutation invalidation', async () => {
    let firstStatusCallback:
      | ((error: Error | null, stdout: string, stderr: string) => void)
      | undefined
    let statusCallCount = 0
    execFileMock.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        match(args.join(' '))
          .with('rev-parse --is-inside-work-tree', () => callback(null, 'true\n', ''))
          .with('rev-parse --abbrev-ref HEAD', () => callback(null, 'main\n', ''))
          .with('status --porcelain=v1', () => {
            statusCallCount += 1
            if (statusCallCount === 1) {
              firstStatusCallback = callback
              return
            }
            callback(null, '', '')
          })
          .with('diff --numstat HEAD', () => callback(null, '', ''))
          .with('rev-list --left-right --count HEAD...@{upstream}', () =>
            callback(null, '0\t0\n', ''),
          )
          .with('add --all -- :/', () => callback(null, '', ''))
          .otherwise(() =>
            callback(new Error(`Unexpected Git arguments: ${args.join(' ')}`), '', ''),
          )
      },
    )

    registerGitHandlers()
    const statusHandler = registeredHandler('git:status')
    const stageHandler = registeredHandler('git:working-tree:stage-all')
    const staleStatusPromise = statusHandler?.({}, '/tmp/repo')

    await vi.waitFor(() => expect(firstStatusCallback).toBeDefined())
    await stageHandler?.({}, '/tmp/repo')
    firstStatusCallback?.(null, ' M stale.txt\n', '')
    await staleStatusPromise
    await statusHandler?.({}, '/tmp/repo')

    expect(statusCallCount).toBe(2)
  })

  it('invalidates status cached under a repository-root alias', async () => {
    let statusCallCount = 0
    execFileMock.mockImplementation(
      (
        _command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string, stderr: string) => void,
      ) => {
        match(args.join(' '))
          .with('rev-parse --is-inside-work-tree', () => callback(null, 'true\n', ''))
          .with('rev-parse --abbrev-ref HEAD', () => callback(null, 'main\n', ''))
          .with('status --porcelain=v1', () => {
            statusCallCount += 1
            callback(null, '', '')
          })
          .with('diff --numstat HEAD', () => callback(null, '', ''))
          .with('rev-list --left-right --count HEAD...@{upstream}', () =>
            callback(null, '0\t0\n', ''),
          )
          .with('add --all -- :/', () => callback(null, '', ''))
          .otherwise(() =>
            callback(new Error(`Unexpected Git arguments: ${args.join(' ')}`), '', ''),
          )
      },
    )

    registerGitHandlers()
    const statusHandler = registeredHandler('git:status')
    const stageHandler = registeredHandler('git:working-tree:stage-all')

    await statusHandler?.({}, '/tmp/repo')
    await stageHandler?.({}, '/tmp/repo/subdirectory')
    await statusHandler?.({}, '/tmp/repo')

    expect(statusCallCount).toBe(2)
  })
})
