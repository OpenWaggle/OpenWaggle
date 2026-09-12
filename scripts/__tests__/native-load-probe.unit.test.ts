import { describe, expect, it, vi } from 'vitest'
import { assertNativeModulesLoad } from '../native-load-probe'

vi.mock('../native-windows-telemetry-probe', () => ({ probeWindowsTerminalTelemetry: vi.fn() }))

const FINAL_CHARACTER = '~'
const FINAL_PAYLOAD_BYTES = 256 * 1024
const FINAL_PREFIX = 'OPENWAGGLE_PTY_FINAL_START:'
const FINAL_SUFFIX = ':OPENWAGGLE_PTY_FINAL_END'
const IDENTITY_PREFIX = 'OPENWAGGLE_PTY_IDENTITY:'
const IDENTITY_SUFFIX = ':OPENWAGGLE_PTY_IDENTITY_END'
const PROMPT_OUTPUT = 'OPENWAGGLE_PTY_PROMPT_OK'

type ExitEvent = { readonly exitCode: number; readonly signal?: number }
type Listener<T> = (event: T) => void

class FakeDatabase {
  public readonly close = vi.fn()
}

class FakePty {
  public readonly spawnProcessIdentity = 'test:process'
  public readonly ttyIdentity = 'test:tty'
  public readonly fd = 42
  public readonly pid: number
  public readonly resize = vi.fn()
  public readonly write = vi.fn(() => queueMicrotask(() => this.emitData(PROMPT_OUTPUT)))
  public readonly closeDescriptor = vi.fn(() => this.finish(1))
  public readonly waitForResourceDrain = vi.fn(() => this.resourceDrain)
  private readonly dataListeners = new Set<Listener<string>>()
  private readonly exitListeners = new Set<Listener<ExitEvent>>()
  private readonly treeListeners = new Set<Listener<ExitEvent>>()
  private treeExit: ExitEvent | undefined
  private resolveResourceDrain!: () => void
  private readonly resourceDrain = new Promise<void>((resolve) => {
    this.resolveResourceDrain = resolve
  })

  public constructor(pid: number, naturalExit: boolean) {
    this.pid = pid
    queueMicrotask(() => {
      if (naturalExit) {
        this.emitData(
          `${FINAL_PREFIX}${FINAL_CHARACTER.repeat(FINAL_PAYLOAD_BYTES)}${FINAL_SUFFIX}`,
        )
        this.finish(0)
        return
      }
      this.emitData(
        `${IDENTITY_PREFIX}${pid},${pid + 1_000},1,1${IDENTITY_SUFFIX}\n`,
      )
    })
  }

  public readonly onData = (listener: Listener<string>) => this.subscribe(this.dataListeners, listener)
  public readonly onExit = (listener: Listener<ExitEvent>) =>
    this.subscribe(this.exitListeners, listener)
  public readonly onProcessTreeExit = (listener: Listener<ExitEvent>) => {
    if (this.treeExit) listener(this.treeExit)
    return this.subscribe(this.treeListeners, listener)
  }

  private subscribe<T>(listeners: Set<Listener<T>>, listener: Listener<T>) {
    listeners.add(listener)
    return { dispose: () => listeners.delete(listener) }
  }

  private emitData(data: string) {
    this.dataListeners.forEach((listener) => listener(data))
  }

  private finish(exitCode: number) {
    if (this.treeExit) return
    this.treeExit = { exitCode }
    queueMicrotask(() => {
      const event = this.treeExit ?? { exitCode }
      this.treeListeners.forEach((listener) => listener(event))
      this.resolveResourceDrain()
      this.exitListeners.forEach((listener) => listener(event))
    })
  }
}

function fakeNativeModules(platform: NodeJS.Platform) {
  const terminals: FakePty[] = []
  const spawn = vi.fn(
    (_file: string, args: readonly string[], _options: Readonly<Record<string, unknown>>): unknown => {
      const terminal = new FakePty(
        42 + terminals.length * 2,
        args.some((argument) => argument.includes(FINAL_PREFIX)),
      )
      terminals.push(terminal)
      return terminal
    },
  )
  const native = platform === 'win32'
    ? null
    : {
        fork: vi.fn(),
        open: vi.fn(),
        resize: vi.fn(),
        process: vi.fn(),
        signalByTty: vi.fn(() => 1),
        signalProcess: vi.fn(),
        processInfos: vi.fn(),
      }
  const nodePty = {
    spawn,
    fork: vi.fn(),
    createTerminal: vi.fn(),
    open: vi.fn(),
    native,
  }
  const loadModule = vi.fn((moduleName: string): unknown => {
    if (moduleName === 'better-sqlite3') return FakeDatabase
    if (moduleName === 'node-pty') return nodePty
    if (moduleName === 'sharp') return { versions: {} }
    throw new Error(`Unexpected module ${moduleName}.`)
  })
  return { loadModule, spawn, terminals }
}

describe('native load probe', () => {
  it('checks the shipping Windows backend selection and the bundled ConPTY payload by default', async () => {
    const fixture = fakeNativeModules('win32')
    await assertNativeModulesLoad('electron', fixture.loadModule, 'win32', 'C:\\runtime\\node.exe')

    expect(fixture.spawn).toHaveBeenCalledTimes(4)
    for (const call of fixture.spawn.mock.calls.slice(0, 2)) {
      expect(call[2]).not.toHaveProperty('useConpty')
      expect(call[2]).not.toHaveProperty('useConptyDll')
    }
    for (const call of fixture.spawn.mock.calls.slice(2)) {
      expect(call[2]).toMatchObject({ useConpty: true, useConptyDll: true })
    }
  })

  it('checks Unix PTY identity, I/O, close, containment, drain, and final output', async () => {
    const fixture = fakeNativeModules('darwin')
    await assertNativeModulesLoad('node', fixture.loadModule, 'darwin', '/runtime/node')

    expect(fixture.spawn).toHaveBeenCalledTimes(2)
    expect(fixture.spawn).toHaveBeenNthCalledWith(
      1,
      '/runtime/node',
      expect.any(Array),
      expect.objectContaining({ cols: 80, rows: 24 }),
    )
    expect(fixture.terminals[0]?.resize).toHaveBeenCalledWith(81, 25)
    expect(fixture.terminals[0]?.write).toHaveBeenCalledOnce()
    expect(fixture.terminals[0]?.closeDescriptor).toHaveBeenCalledTimes(2)
    expect(fixture.terminals[0]?.waitForResourceDrain).toHaveBeenCalledOnce()
    expect(fixture.terminals[1]?.closeDescriptor).toHaveBeenCalledTimes(2)
    expect(fixture.terminals[1]?.waitForResourceDrain).toHaveBeenCalledOnce()
  })

  it('checks explicit and natural exit on every Windows backend', async () => {
    const fixture = fakeNativeModules('win32')
    await assertNativeModulesLoad('electron', fixture.loadModule, 'win32', 'C:\\runtime\\node.exe', 'all-backends')

    expect(fixture.spawn).toHaveBeenCalledTimes(6)
    expect(fixture.spawn.mock.calls.map((call) => call[2])).toEqual([
      expect.objectContaining({ useConpty: true, useConptyDll: false }),
      expect.objectContaining({ useConpty: true, useConptyDll: false }),
      expect.objectContaining({ useConpty: true, useConptyDll: true }),
      expect.objectContaining({ useConpty: true, useConptyDll: true }),
      expect.objectContaining({ useConpty: false }),
      expect.objectContaining({ useConpty: false }),
    ])
    expect(fixture.loadModule).toHaveBeenCalledWith('sharp')
    for (const index of [0, 2, 4]) {
      expect(fixture.terminals[index]?.write).toHaveBeenCalledWith('openwaggle-native-probe-input\r')
    }
  })

  it('rejects an upstream terminal that lacks the patched lifecycle API', async () => {
    const fixture = fakeNativeModules('darwin')
    fixture.spawn.mockReturnValueOnce({ pid: 42 })

    await expect(
      assertNativeModulesLoad('node', fixture.loadModule, 'darwin', '/runtime/node'),
    ).rejects.toThrow('did not expose the patched PTY lifecycle contract')
  })
})
