import type * as ChildProcessModule from 'node:child_process'
import { ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  secureWindowsUserOnly,
  WindowsUserOnlySecurityTimeoutError,
  windowsUserOnlySecurityCommandForTests,
} from '../windows-user-only-security'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcessModule>()),
  spawn: mocks.spawn,
}))
vi.mock('../../env', () => ({ getWindowsSecurityChildEnv: () => ({ SystemRoot: 'C:\\Windows' }) }))

function childProcess() {
  const child = new ChildProcess()
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  const kill = vi.spyOn(child, 'kill').mockReturnValue(true)
  mocks.spawn.mockReturnValue(child)
  return { child, kill }
}

describe('Windows user-only security helper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })
  afterEach(() => vi.useRealTimers())

  it('retains the exact helper stage when the existing 20-second budget expires', async () => {
    const { child, kill } = childProcess()
    const result = secureWindowsUserOnly([{ kind: 'pipe', path: '\\\\.\\pipe\\owned' }])
    const outcome = result.catch((error: unknown) => error)
    child.stderr?.emit('data', Buffer.from('OW_SECURITY_STAGE:compile\nOW_SECURITY_STA'))
    child.stderr?.emit('data', Buffer.from('GE:pipe-readback\n'))

    await vi.advanceTimersByTimeAsync(19_999)
    expect(kill).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(await outcome).toMatchObject({
      stage: 'pipe-readback',
      exitCode: null,
      signalCode: null,
    })
    expect(kill).toHaveBeenCalledTimes(1)
  })

  it('bounds timeout evidence and preserves command-resolution versus compile failures', () => {
    const failure = new WindowsUserOnlySecurityTimeoutError(
      'resolve-compiler-command',
      1,
      null,
      `${'old-output'.repeat(1_000)}latest compiler error`,
    )

    expect(failure.message).toContain('Last stage: resolve-compiler-command.')
    expect(failure.message).toContain('Exit code: 1; signal: null.')
    expect(failure.message).toContain('latest compiler error')
    expect(failure.message.length).toBeLessThan(4_300)
  })

  it('closes input and admits only the verified SID after a successful helper exit', async () => {
    const { child, kill } = childProcess()
    const result = secureWindowsUserOnly([{ kind: 'directory', path: 'C:\\User data\\é' }])
    expect(child.stdin?.writableEnded).toBe(true)
    expect(mocks.spawn).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'],
      {
        env: { SystemRoot: 'C:\\Windows' },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    child.stdout?.emit('data', Buffer.from('\u001b[?1h\u001b[?1lS-1-5-21-1234\r\n'))
    child.emit('close', 0)

    await expect(result).resolves.toEqual({ userSid: 'S-1-5-21-1234' })
    expect(kill).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('fails closed when helper output exceeds the existing 64-KiB bound', async () => {
    const { child, kill } = childProcess()
    const result = secureWindowsUserOnly([{ kind: 'pipe', path: '\\\\.\\pipe\\owned' }])
    const rejected = expect(result).rejects.toThrow('exceeded its output limit')
    child.stderr?.emit('data', Buffer.alloc(64 * 1024 + 1, 'x'))
    child.stdout?.emit('data', Buffer.from('S-1-5-21-1234'))
    child.emit('close', 0)

    await rejected
    expect(kill).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps its script and targets off the command line and delivers them as one stdin line', () => {
    const input: Buffer[] = []
    const { child } = childProcess()
    child.stdin?.on('data', (chunk: Buffer) => input.push(chunk))
    void secureWindowsUserOnly([{ kind: 'directory', path: 'C:\\Users\\Jürgen\\AppData' }]).catch(
      () => undefined,
    )

    const [, argumentsList] = mocks.spawn.mock.calls[0] ?? []
    expect(argumentsList).not.toContain('-EncodedCommand')
    expect(argumentsList).not.toContain('-ExecutionPolicy')
    expect(JSON.stringify(argumentsList)).not.toContain('AppData')
    const text = Buffer.concat(input).toString('utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(text.trimEnd()).not.toContain('\n')
    expect(text).toContain('J\\u00fcrgen')
    expect(text).toContain("'param([string]$RequestJson)'")
    child.emit('close', 1)
  })

  it('names the last stage, exit code and signal when the helper is stopped', async () => {
    const { child } = childProcess()
    const result = secureWindowsUserOnly([{ kind: 'pipe', path: '\\\\.\\pipe\\owned' }])
    child.stderr?.emit('data', Buffer.from('OW_SECURITY_STAGE:compile\n'))
    child.emit('close', null, 'SIGTERM')

    await expect(result).rejects.toMatchObject({
      name: 'WindowsUserOnlySecurityError',
      stage: 'compile',
      exitCode: null,
      signalCode: 'SIGTERM',
    })
  })

  it('requires a successful exit and a verified SID even after all stages are reported', async () => {
    const { child } = childProcess()
    const result = secureWindowsUserOnly([{ kind: 'pipe', path: '\\\\.\\pipe\\owned' }])
    const rejected = expect(result).rejects.toThrow(
      'Windows user-only security verification failed',
    )
    child.stderr?.emit('data', Buffer.from('OW_SECURITY_STAGE:complete\n'))
    child.stdout?.emit('data', Buffer.from('S-1-5-21-1234'))
    child.emit('close', 1)
    await rejected
  })

  it('uses handle-based pipe security with metadata-only rights and closes the handle', () => {
    const { script } = windowsUserOnlySecurityCommandForTests()
    expect(script.indexOf("Write-SecurityStage 'resolve-compiler-command'")).toBeLessThan(
      script.indexOf("Write-SecurityStage 'compile'"),
    )
    expect(script).not.toContain('SetNamedSecurityInfo')
    expect(script).not.toContain('GetNamedSecurityInfo')
    expect(script).toContain('READ_CONTROL | WRITE_DAC | WRITE_OWNER')
    expect(script).toContain('using (SafeFileHandle pipe = CreateFile(')
    expect(script).toContain('SetSecurityInfo(')
    expect(script).toContain('GetSecurityInfo(')
    expect(script).toContain('descriptor.ControlFlags & ControlFlags.DiscretionaryAclProtected')
    expect(script).toContain('acl.Count != 1')
    expect(script).toContain('!expectedUser.Equals(ace.SecurityIdentifier)')
  })

  it('sets and verifies the explicit Windows pipe full-control mask instead of a generic bit', () => {
    const { script } = windowsUserOnlySecurityCommandForTests()
    // System.IO.Pipes.PipeAccessRights.FullControl = 2032031, not GENERIC_ALL.
    expect(script).toContain('private const int PIPE_FULL_CONTROL = 0x001F019F;')
    expect(script).toContain('PIPE_FULL_CONTROL.ToString("x")')
    expect(script).toContain('ace.AccessMask != PIPE_FULL_CONTROL')
    expect(script).not.toContain('ace.AccessMask != GENERIC_ALL')
    expect(script).toContain('VerifyDescriptor(new RawSecurityDescriptor(binary, 0), expectedUser)')
  })
})
