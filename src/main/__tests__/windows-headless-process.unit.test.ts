import { describe, expect, it, vi } from 'vitest'
import {
  createWindowsHeadlessProcess,
  launchWindowsHeadlessProcess,
  WINDOWS_HEADLESS_CREATION_FLAGS,
  windowsEnvironmentBlock,
  windowsHeadlessCommandLine,
  type WindowsProcessKernel,
} from '../windows-headless-process'

// Electrobun's bundled Bun runs the app directory's entry.
const launch = {
  command: 'C:\\Program Files\\OpenWaggle\\bin\\bun.exe',
  args: ['C:\\Program Files\\OpenWaggle\\Resources\\app', 'session-host-internal'],
  environment: { PATH: 'C:\\Windows', PROVIDER_API_KEY: 'private-provider-fixture' },
  inherited: { SystemRoot: 'C:\\Windows' },
}

const PROCESS_HANDLE = 0x1234n
const THREAD_HANDLE = 0x5678n

type CreateProcessCall = Parameters<WindowsProcessKernel['createProcess']>[0]

function fakeKernel(options: { created?: boolean; closes?: boolean; lastError?: number } = {}) {
  const calls: CreateProcessCall[] = []
  const closed: bigint[] = []
  const kernel: WindowsProcessKernel = {
    createProcess: (call) => {
      calls.push(call)
      if (options.created === false) return false
      const information = Buffer.from(call.processInformation.buffer)
      information.writeBigUInt64LE(PROCESS_HANDLE, 0)
      information.writeBigUInt64LE(THREAD_HANDLE, 8)
      return true
    },
    lastError: () => options.lastError ?? 0,
    closeHandle: (handle) => {
      closed.push(handle)
      return options.closes !== false
    },
  }
  return { kernel, calls, closed }
}

function wide(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('utf16le')
}

describe('Windows headless process launch', () => {
  it('starts the process detached, hidden, without inherited handles, and closes its handles', () => {
    const { kernel, calls, closed } = fakeKernel()
    createWindowsHeadlessProcess(kernel, launch)

    const [call] = calls
    if (call === undefined) throw new Error('CreateProcessW was not called')
    expect(call.inheritHandles).toBe(0)
    // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_UNICODE_ENVIRONMENT
    expect(call.creationFlags).toBe(0x608)
    expect(WINDOWS_HEADLESS_CREATION_FLAGS).toBe(0x608)
    expect(wide(call.application)).toBe(`${launch.command}\0`)
    expect(wide(call.commandLine)).toBe(
      '"C:\\Program Files\\OpenWaggle\\bin\\bun.exe" "C:\\Program Files\\OpenWaggle\\Resources\\app" "session-host-internal"\0',
    )
    const startup = Buffer.from(call.startupInfo)
    expect(startup.byteLength).toBe(104)
    expect(startup.readUInt32LE(0)).toBe(104)
    // STARTF_USESHOWWINDOW with SW_HIDE; no STARTF_USESTDHANDLES, so no standard handle passes.
    expect(startup.readUInt32LE(60)).toBe(1)
    expect(startup.readUInt16LE(64)).toBe(0)
    expect(startup.subarray(80, 104).every((byte) => byte === 0)).toBe(true)
    expect(call.processInformation.byteLength).toBe(24)
    expect(new Set(closed)).toEqual(new Set([PROCESS_HANDLE, THREAD_HANDLE]))
  })

  it('passes exactly the given environment as a sorted Unicode block', () => {
    const block = wide(
      windowsEnvironmentBlock(
        { zeta: '1', Alpha: '蜂', SKIPPED: undefined, '=C:': 'C:\\work', beta: '' },
        {},
      ),
    )
    expect(block).toBe('=C:=C:\\work\0Alpha=蜂\0beta=\0zeta=1\0\0')
  })

  it("adds the variables libuv gives every child from the parent, unless they're set", () => {
    const block = wide(
      windowsEnvironmentBlock(
        { Path: 'C:\\own', PROVIDER_API_KEY: 'private-provider-fixture' },
        { SystemRoot: 'C:\\Windows', PATH: 'C:\\parent', UNRELATED: 'parent-only', TEMP: 'C:\\t' },
      ),
    )
    expect(block.split('\0').filter(Boolean)).toEqual([
      'Path=C:\\own',
      'PROVIDER_API_KEY=private-provider-fixture',
      'SystemRoot=C:\\Windows',
      'TEMP=C:\\t',
    ])
  })

  it.each([
    [{ PROVIDER_API_KEY: 'private-provider-fixture\0invalid' }, 'must not contain NUL'],
    [{ 'PROVIDER\0API_KEY': 'private-provider-fixture' }, 'must not contain NUL'],
    [{ 'A=B': 'value' }, 'invalid variable name'],
    [{ '': 'value' }, 'invalid variable name'],
  ])('rejects a malformed environment without exposing it: %j', async (environment, message) => {
    const loadKernel = vi.fn(async () => fakeKernel().kernel)
    const pending = launchWindowsHeadlessProcess({ ...launch, environment }, loadKernel)
    await expect(pending).rejects.toThrow(message)
    await expect(pending).rejects.not.toThrow('private-provider-fixture')
    expect(loadKernel).not.toHaveBeenCalled()
  })

  it('rejects embedded NUL arguments before the kernel loads', async () => {
    const loadKernel = vi.fn(async () => fakeKernel().kernel)
    await expect(
      launchWindowsHeadlessProcess(
        { ...launch, args: ['session-host-internal\0ignored'] },
        loadKernel,
      ),
    ).rejects.toThrow('NUL')
    expect(loadKernel).not.toHaveBeenCalled()
  })

  it.each(['', 'bun.exe', 'C:relative.exe', 'C:\\tools\\launch.cmd'])(
    'rejects invalid executable %j before the kernel loads',
    async (command) => {
      const loadKernel = vi.fn(async () => fakeKernel().kernel)
      await expect(
        launchWindowsHeadlessProcess({ ...launch, command }, loadKernel),
      ).rejects.toThrow('absolute .exe')
      expect(loadKernel).not.toHaveBeenCalled()
    },
  )

  it('rejects an oversized quoted command line before the kernel loads', async () => {
    const loadKernel = vi.fn(async () => fakeKernel().kernel)
    await expect(
      launchWindowsHeadlessProcess({ ...launch, args: ['x'.repeat(32_766)] }, loadKernel),
    ).rejects.toThrow('command-line limit')
    expect(loadKernel).not.toHaveBeenCalled()
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
      String.raw`"C:\Program Files\OpenWaggle\bin\bun.exe" "" "worker hive" "蜂の女王 🐝" "say \"yes\"" "C:\trailing\\" "a\\\"b"`,
    )
  })

  it('reports only the Win32 code when the process cannot start', async () => {
    const { kernel, closed } = fakeKernel({ created: false, lastError: 2 })
    await expect(launchWindowsHeadlessProcess(launch, async () => kernel)).rejects.toThrow(
      'Windows headless process launch failed at create-process (Win32 code 2).',
    )
    expect(closed).toEqual([])
  })

  it('fails when a handle of the started process cannot be closed', () => {
    const { kernel } = fakeKernel({ closes: false, lastError: 6 })
    expect(() => createWindowsHeadlessProcess(kernel, launch)).toThrow(
      'failed at close-handle (Win32 code 6)',
    )
  })
})
