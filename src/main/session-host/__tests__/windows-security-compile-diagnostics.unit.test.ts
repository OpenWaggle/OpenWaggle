import type * as ChildProcessModule from 'node:child_process'
import { ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WINDOWS_PIPE_SECURITY_SOURCE } from '../windows-pipe-security-source'
import { WindowsUserOnlySecurityTimeoutError } from '../windows-user-only-security'
import {
  windowsCompileProbeScript,
  withWindowsCompileDiagnostics,
} from './windows-security-compile-diagnostics'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), stopProcessTree: vi.fn() }))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcessModule>()),
  spawn: mocks.spawn,
}))
vi.mock('../../../../scripts/qa/child-process-lifecycle', () => ({
  stopProcessTree: mocks.stopProcessTree,
}))
vi.mock('../../env', () => ({ getWindowsSecurityChildEnv: () => ({ SystemRoot: 'C:\\Windows' }) }))

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
  vi.useRealTimers()
})

function probeChild() {
  const child = new ChildProcess()
  child.stdin = new PassThrough()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  vi.spyOn(child, 'kill').mockReturnValue(true)
  mocks.spawn.mockReturnValueOnce(child)
  return child
}

describe('Windows security failure diagnostics', () => {
  it.each(['compile', 'resolve-compiler-command'])(
    'keeps the original %s timeout even if diagnostic collection fails',
    async (stage) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const original = new WindowsUserOnlySecurityTimeoutError(stage, null, null, '')
      const collect = vi.fn(async () => {
        throw new Error('diagnostic probe failed')
      })

      await expect(
        withWindowsCompileDiagnostics(async () => Promise.reject(original), collect),
      ).rejects.toBe(original)
      expect(collect).toHaveBeenCalledOnce()
    },
  )

  it('does not run compile probes for a pipe security failure or a successful operation', async () => {
    const collect = vi.fn(async () => [])
    const failure = new WindowsUserOnlySecurityTimeoutError('pipe-set', null, null, '')

    await expect(
      withWindowsCompileDiagnostics(async () => Promise.reject(failure), collect),
    ).rejects.toBe(failure)
    await expect(withWindowsCompileDiagnostics(async () => 'verified', collect)).resolves.toBe(
      'verified',
    )
    expect(collect).not.toHaveBeenCalled()
  })

  it('compiles the exact helper source without invoking any ACL operation', () => {
    const script = windowsCompileProbeScript(WINDOWS_PIPE_SECURITY_SOURCE)

    expect(script).toContain(WINDOWS_PIPE_SECURITY_SOURCE)
    expect(script).toContain('& $compiler -TypeDefinition $source -Language CSharp')
    expect(script).not.toContain('[OpenWagglePipeSecurity]::ProtectAndVerify')
    expect(script).not.toContain('[System.IO.File]::SetAccessControl')
    expect(script).not.toContain('[System.IO.Directory]::SetAccessControl')
  })

  it('bounds both sanitized probes and waits for owned-tree cleanup without replacing the timeout', async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const children = [probeChild(), probeChild()]
    const cleanup = Promise.withResolvers<void>()
    mocks.stopProcessTree.mockReturnValue(cleanup.promise)
    const original = new WindowsUserOnlySecurityTimeoutError(
      'compile',
      null,
      null,
      'stage evidence',
    )
    const result = withWindowsCompileDiagnostics(async () => Promise.reject(original))
    const outcome = result.catch((error: unknown) => error)
    await vi.advanceTimersByTimeAsync(0)

    expect(log).toHaveBeenCalledWith(
      '[windows-security] original security timeout',
      original.message,
    )
    for (const child of children) {
      expect(child.stdin?.writableEnded).toBe(true)
      child.stderr?.emit('data', Buffer.from('x'.repeat(8_192)))
    }
    expect(mocks.spawn).toHaveBeenCalledTimes(2)
    expect(mocks.spawn).toHaveBeenCalledWith('powershell.exe', expect.any(Array), {
      env: { SystemRoot: 'C:\\Windows' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    await vi.advanceTimersByTimeAsync(4_999)
    expect(mocks.stopProcessTree).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    for (const child of children) expect(mocks.stopProcessTree).toHaveBeenCalledWith(child)
    expect(log).not.toHaveBeenCalledWith(
      '[windows-security] compile-only diagnostics',
      expect.anything(),
    )
    cleanup.resolve()

    expect(await outcome).toBe(original)
    expect(log).toHaveBeenCalledWith('[windows-security] compile-only diagnostics', [
      expect.objectContaining({ name: 'tiny-csharp', timedOut: true, stderr: 'x'.repeat(4_096) }),
      expect.objectContaining({
        name: 'pipe-helper-csharp',
        timedOut: true,
        stderr: 'x'.repeat(4_096),
      }),
    ])
    expect(vi.getTimerCount()).toBe(0)
  })
})
