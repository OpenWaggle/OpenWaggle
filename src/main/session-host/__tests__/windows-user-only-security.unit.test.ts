import type * as ChildProcessModule from 'node:child_process'
import { ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  secureWindowsUserOnly,
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
      message: 'Timed out applying Windows user-only security. Last stage: pipe-readback.',
    })
    expect(kill).toHaveBeenCalledTimes(1)
  })

  it('closes input and admits only the verified SID after a successful helper exit', async () => {
    const { child, kill } = childProcess()
    const result = secureWindowsUserOnly([{ kind: 'directory', path: 'C:\\User data\\é' }])
    expect(child.stdin?.writableEnded).toBe(true)
    expect(mocks.spawn).toHaveBeenCalledWith('powershell.exe', expect.any(Array), {
      env: { SystemRoot: 'C:\\Windows' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    child.stdout?.emit('data', Buffer.from('S-1-5-21-1234'))
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
    const command = windowsUserOnlySecurityCommandForTests()
    const script = Buffer.from(command.arguments.at(-1) ?? '', 'base64').toString('utf16le')
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
})
