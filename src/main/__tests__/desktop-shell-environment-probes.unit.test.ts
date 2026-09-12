import type { ChildProcessByStdio, SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { Readable } from 'node:stream'
import { PassThrough } from 'node:stream'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type ProbeChild = ChildProcessByStdio<null, Readable, null>

const spawnMock = vi.hoisted(() =>
  vi.fn<(command: string, args: readonly string[], options: SpawnOptions) => ProbeChild>(),
)

vi.mock('node:child_process', () => ({ spawn: spawnMock }))

const { runBoundedShellEnvironmentCommand } = await import('../desktop-shell-environment-probes')

const PROBE_PID = 71_401
const PROBE_TIMEOUT_MS = 50

function fakeChild(pid: number) {
  const stdout = new PassThrough()
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    kill: vi.fn<(signal?: NodeJS.Signals | number) => boolean>(() => true),
    pid,
    signalCode: null,
    stderr: null,
    stdin: null,
    stdout,
    unref: vi.fn<() => void>(),
  })
  return {
    child: fromPartial<ProbeChild>(child),
    destroy: vi.spyOn(stdout, 'destroy'),
  }
}

describe('bounded desktop shell environment probes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    spawnMock.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('settles empty at its deadline when an exited parent never closes inherited stdout', async () => {
    const probe = fakeChild(PROBE_PID)
    const treeKill = fakeChild(PROBE_PID + 1)
    spawnMock.mockImplementation((command) =>
      command === 'taskkill.exe' ? treeKill.child : probe.child,
    )
    const processKill = vi.spyOn(process, 'kill').mockReturnValue(true)
    const settlement = vi.fn<(value: string) => void>()

    const result = runBoundedShellEnvironmentCommand({
      probe: 'login-shell',
      command: '/bin/example-shell',
      args: ['-ilc', 'printenv PATH'],
      timeoutMs: PROBE_TIMEOUT_MS,
    })
    void result.then(settlement)

    // A background descendant retains stdout, so the parent emits exit but the
    // child-process close event never arrives.
    Reflect.set(probe.child, 'exitCode', 0)
    probe.child.emit('exit', 0, null)
    await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS)

    try {
      expect(settlement).toHaveBeenCalledExactlyOnceWith('')
      expect(probe.destroy).toHaveBeenCalledOnce()
      expect(probe.child.unref).toHaveBeenCalledOnce()
      if (process.platform === 'win32') {
        expect(spawnMock).toHaveBeenCalledOnce()
      } else {
        expect(processKill).toHaveBeenCalledWith(-PROBE_PID, 'SIGKILL')
      }
    } finally {
      probe.child.emit('close', 0, null)
      treeKill.child.emit('close', 0, null)
      await result
    }
  })

  it('starts probes in their own POSIX process group', () => {
    const probe = fakeChild(PROBE_PID)
    spawnMock.mockReturnValue(probe.child)

    const result = runBoundedShellEnvironmentCommand({
      probe: 'login-shell',
      command: '/bin/example-shell',
      args: [],
      timeoutMs: PROBE_TIMEOUT_MS,
    })
    probe.child.emit('close', 0, null)

    expect(spawnMock).toHaveBeenCalledWith(
      '/bin/example-shell',
      [],
      expect.objectContaining({ detached: process.platform !== 'win32' }),
    )
    return result
  })

  it.runIf(process.platform === 'win32')(
    'uses bounded taskkill tree termination for a live Windows root',
    async () => {
      const probe = fakeChild(PROBE_PID)
      const treeKill = fakeChild(PROBE_PID + 1)
      spawnMock.mockReturnValueOnce(probe.child).mockReturnValueOnce(treeKill.child)

      const result = runBoundedShellEnvironmentCommand({
        probe: 'powershell-profile',
        command: 'pwsh.exe',
        args: [],
        timeoutMs: PROBE_TIMEOUT_MS,
      })
      await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS)
      treeKill.child.emit('close', 0, null)

      expect(spawnMock).toHaveBeenNthCalledWith(
        2,
        'taskkill.exe',
        ['/pid', String(PROBE_PID), '/t', '/f'],
        expect.objectContaining({ stdio: 'ignore', windowsHide: true }),
      )
      expect(treeKill.child.unref).toHaveBeenCalledOnce()
      await result
    },
  )
})
