import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  exit: vi.fn(),
  setActivationPolicy: vi.fn(),
  stdout: vi.fn(async (_text: string) => undefined),
  delegate: vi.fn((_argv: readonly string[]) => true),
}))

vi.mock('electron', () => ({
  app: {
    exit: mocks.exit,
    getVersion: () => '1.2.3',
    isPackaged: true,
    setActivationPolicy: mocks.setActivationPolicy,
    whenReady: async () => undefined,
  },
}))
vi.mock('../cli-output-flush', () => ({ flushCliOutput: async () => undefined }))
vi.mock('../cli-stdout', () => ({
  writeCliStdout: mocks.stdout,
  writeWritableChunk: async (output: NodeJS.WritableStream, text: string) => {
    output.write(text)
  },
}))
vi.mock('../app-cli-entry', () => ({ startAppCliIfRequested: mocks.delegate }))
vi.mock('../env', () => ({ env: {} }))
vi.mock('../session-data', () => ({ configureAppStoragePaths: vi.fn() }))

const { startTopLevelCli } = await import('../top-level-cli-entry')

const environment = {
  workingDirectory: path.resolve('/work'),
  homeDirectory: path.resolve('/home/ada'),
  pathKind: (absolutePath: string) =>
    absolutePath === path.resolve('/work/app') ? ('directory' as const) : ('missing' as const),
  isPackaged: true,
}

beforeEach(() => {
  mocks.exit.mockClear()
  mocks.setActivationPolicy.mockClear()
  mocks.stdout.mockClear()
  mocks.delegate.mockClear()
})

describe('top-level CLI entry', () => {
  it('prints help and exits without starting the desktop app', async () => {
    expect(startTopLevelCli(['--help'], environment)).toEqual({ kind: 'handled' })

    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(0))
    expect(mocks.stdout).toHaveBeenCalledWith(expect.stringContaining('OpenWaggle 1.2.3\n\nUsage:'))
  })

  it('prints the version', async () => {
    startTopLevelCli(['-v'], environment)

    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(0))
    expect(mocks.stdout).toHaveBeenCalledWith('1.2.3\n')
  })

  it('prints help for a mistyped command instead of opening the app', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(startTopLevelCli(['sesions', 'list'], environment)).toEqual({ kind: 'handled' })

    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(2))
    const written = stderr.mock.calls.map(([chunk]) => String(chunk)).join('')
    expect(written).toContain("openwaggle: unknown command 'sesions'. Did you mean 'sessions'?")
    expect(written).toContain('Commands:\n  run')
    stderr.mockRestore()
  })

  it('opens the desktop app, optionally on a project', () => {
    expect(startTopLevelCli([], environment)).toEqual({ kind: 'gui' })
    expect(startTopLevelCli(['app'], environment)).toEqual({
      kind: 'gui',
      openProjectPath: path.resolve('/work/app'),
    })
    expect(mocks.exit).not.toHaveBeenCalled()
  })

  it('hands command groups to their existing entry points', () => {
    expect(startTopLevelCli(['mcp', '--help'], environment)).toEqual({ kind: 'handled' })

    expect(mocks.delegate).toHaveBeenCalledWith(['mcp', 'help'])
  })

  it('keeps commands out of the macOS Dock but not the desktop app', () => {
    startTopLevelCli(['--version'], environment, 'darwin')
    expect(mocks.setActivationPolicy).toHaveBeenCalledWith('accessory')

    mocks.setActivationPolicy.mockClear()
    startTopLevelCli([], environment, 'darwin')
    startTopLevelCli(['app'], environment, 'darwin')
    startTopLevelCli(['--help'], environment, 'linux')
    expect(mocks.setActivationPolicy).not.toHaveBeenCalled()
  })

  it('exits quietly with the intended status when the reader closes the pipe', async () => {
    mocks.stdout.mockRejectedValueOnce(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    startTopLevelCli(['--help'], environment, 'linux')

    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledWith(0))
    expect(stderr).not.toHaveBeenCalled()
    stderr.mockRestore()
  })
})
