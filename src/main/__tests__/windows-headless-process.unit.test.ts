import type * as ChildProcessModule from 'node:child_process'
import { ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof ChildProcessModule>()),
  spawn: mocks.spawn,
}))
vi.mock('electron', () => ({}))
vi.mock('../env', () => ({ env: {}, getSafeChildEnv: () => ({}) }))

import { launchHeadlessBackgroundProcess } from '../desktop-ui'
import { windowsHeadlessCommandLine } from '../windows-headless-process'
import { WINDOWS_HEADLESS_PROCESS_SCRIPT } from '../windows-headless-process-source'

const launch = {
  command: 'C:\\Program Files\\OpenWaggle\\OpenWaggle.exe',
  args: ['session-host-internal'],
  environment: { PATH: 'C:\\Windows', PROVIDER_API_KEY: 'private-provider-fixture' },
}

function childProcess() {
  const child = Object.assign(new ChildProcess(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  })
  vi.spyOn(child, 'kill').mockImplementation(() => true)
  vi.spyOn(child, 'unref').mockImplementation(() => undefined)
  mocks.spawn.mockImplementation(() => {
    queueMicrotask(() => child.emit('spawn'))
    return child
  })
  const input: Buffer[] = []
  child.stdin.on('data', (chunk: Buffer) => input.push(chunk))
  return { child, inputText: () => Buffer.concat(input).toString('utf8') }
}

describe('Windows headless process launch boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.stubGlobal('process', { ...process, platform: 'win32' })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('rejects embedded NUL arguments before any process is started', async () => {
    childProcess()
    await expect(
      launchHeadlessBackgroundProcess({ ...launch, args: ['session-host-internal\0ignored'] }),
    ).rejects.toThrow('NUL')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it.each([
    { PROVIDER_API_KEY: 'private-provider-fixture\0invalid' },
    { 'PROVIDER\0API_KEY': 'private-provider-fixture' },
  ])('rejects malformed environment without exposing its values', async (environment) => {
    childProcess()
    const pending = launchHeadlessBackgroundProcess({ ...launch, environment })
    await expect(pending).rejects.toThrow('environment must not contain NUL')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('isolates the native launch while preserving authorized environment without exposing it in argv or input', async () => {
    const { child, inputText } = childProcess()
    const pending = launchHeadlessBackgroundProcess(launch)
    const encodedScript = Buffer.from(WINDOWS_HEADLESS_PROCESS_SCRIPT, 'utf16le').toString('base64')

    expect(mocks.spawn).toHaveBeenCalledExactlyOnceWith(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encodedScript],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: launch.environment,
      },
    )
    expect(encodedScript).not.toContain(launch.environment.PROVIDER_API_KEY)
    expect(WINDOWS_HEADLESS_PROCESS_SCRIPT).not.toContain('ExecutionPolicy')
    expect(inputText()).toBe(
      JSON.stringify({
        command: launch.command,
        commandLine: '"C:\\Program Files\\OpenWaggle\\OpenWaggle.exe" "session-host-internal"',
      }),
    )
    child.stdout.write('OW_HEADLESS_LAUNCHED')
    child.emit('close', 0)

    await expect(pending).resolves.toBeUndefined()
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('does not accept helper spawn or acknowledgement before successful helper exit', async () => {
    const { child } = childProcess()
    let settled = false
    const pending = launchHeadlessBackgroundProcess(launch).then(() => {
      settled = true
    })
    child.stdout.write('OW_HEADLESS_LAUNCHED')
    await Promise.resolve()
    expect(settled).toBe(false)
    child.emit('close', 0)
    await pending
    expect(settled).toBe(true)
  })

  it.each(['', 'electron.exe', 'C:relative.exe', 'C:\\tools\\launch.cmd'])(
    'rejects invalid executable %j before spawning',
    async (command) => {
      await expect(launchHeadlessBackgroundProcess({ ...launch, command })).rejects.toThrow(
        'absolute .exe',
      )
      expect(mocks.spawn).not.toHaveBeenCalled()
    },
  )

  it('rejects an oversized quoted command line before spawning', async () => {
    await expect(
      launchHeadlessBackgroundProcess({ ...launch, args: ['x'.repeat(32_766)] }),
    ).rejects.toThrow('command-line limit')
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('quotes spaces, empty arguments, Unicode, quotes, and backslashes according to Windows CRT parsing', () => {
    expect(
      windowsHeadlessCommandLine(launch.command, [
        '',
        'worker hive',
        '蜂の女王 🐝',
        'say "yes"',
        'C:\\trailing\\',
        'a\\"b',
      ]),
    ).toBe(
      String.raw`"C:\Program Files\OpenWaggle\OpenWaggle.exe" "" "worker hive" "蜂の女王 🐝" "say \"yes\"" "C:\trailing\\" "a\\\"b"`,
    )
  })

  it('reports only controlled Win32 diagnostics, never unrestricted helper stderr', async () => {
    const { child } = childProcess()
    const pending = launchHeadlessBackgroundProcess(launch)
    child.stderr.write(`unexpected private-provider-fixture\nOW_HEADLESS_ERROR:create-process:2\n`)
    child.emit('close', 1)
    await expect(pending).rejects.toThrow(
      'Windows headless process launch failed at create-process (Win32 code 2).',
    )
  })

  it.each([
    [0, ''],
    [0, 'unexpected'],
    [1, 'OW_HEADLESS_LAUNCHED'],
    [null, 'OW_HEADLESS_LAUNCHED'],
  ])('rejects unconfirmed helper completion %j/%j', async (code, output) => {
    const { child } = childProcess()
    const pending = launchHeadlessBackgroundProcess(launch)
    child.stdout.write(output)
    child.emit('close', code)
    await expect(pending).rejects.toThrow('did not confirm')
  })

  it('propagates a spawn error without an insecure direct-launch fallback', async () => {
    const { child } = childProcess()
    const pending = launchHeadlessBackgroundProcess(launch)
    child.emit('error', new Error('ENOENT'))
    await expect(pending).rejects.toThrow('helper could not start')
    expect(mocks.spawn).toHaveBeenCalledOnce()
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('fails and stops only its helper if the input pipe errors', async () => {
    const { child } = childProcess()
    const pending = launchHeadlessBackgroundProcess(launch)
    child.stdin.emit('error', new Error('EPIPE'))
    await expect(pending).rejects.toThrow('input could not be delivered')
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('cleans up its helper when delivering input throws synchronously', async () => {
    const { child } = childProcess()
    vi.spyOn(child.stdin, 'end').mockImplementation(() => {
      throw new Error('EPIPE')
    })
    await expect(launchHeadlessBackgroundProcess(launch)).rejects.toThrow(
      'input could not be delivered',
    )
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it.each(['stdout', 'stderr'] as const)(
    'handles %s pipe errors without an uncaught stream error',
    async (stream) => {
      const { child } = childProcess()
      const pending = launchHeadlessBackgroundProcess(launch)
      child[stream].emit('error', new Error('EIO'))
      await expect(pending).rejects.toThrow('output could not be read')
      expect(child.kill).toHaveBeenCalledOnce()
    },
  )

  it('bounds helper output and ignores subsequent completion after failure', async () => {
    const { child } = childProcess()
    const pending = launchHeadlessBackgroundProcess(launch)
    child.stderr.write(Buffer.alloc(64 * 1024 + 1))
    child.emit('close', 0)
    await expect(pending).rejects.toThrow('output limit')
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('bounds a stuck helper and never kills an authority using a remembered PID', async () => {
    vi.useFakeTimers()
    const { child } = childProcess()
    const pending = launchHeadlessBackgroundProcess(launch)
    const rejection = expect(pending).rejects.toThrow('Timed out')
    await vi.advanceTimersByTimeAsync(20_000)
    await rejection
    expect(child.kill).toHaveBeenCalledOnce()
    expect(mocks.spawn).toHaveBeenCalledOnce()
  })
})
