import type * as ChildProcessModule from 'node:child_process'
import { once } from 'node:events'
import type { ElectronApplication } from '@playwright/test'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const execFileAsyncMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>()
  const execFile = vi.fn()
  Object.defineProperty(execFile, Symbol.for('nodejs.util.promisify.custom'), {
    value: execFileAsyncMock,
  })
  return { ...actual, execFile }
})

describe('Windows Electron process-tree teardown', () => {
  const originalPlatform = process.platform
  const children: ChildProcessModule.ChildProcess[] = []

  beforeAll(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
  })

  afterAll(() => {
    Object.defineProperty(process, 'platform', { configurable: true, value: originalPlatform })
  })

  beforeEach(() => {
    execFileAsyncMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    for (const child of children.splice(0)) {
      if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) continue
      try {
        process.kill(child.pid, 'SIGKILL')
      } catch {
        // The teardown helper already terminated the fixture.
      }
    }
  })

  it('settles Playwright closure and hides commands when taskkill times out', async () => {
    const childProcess = await import('node:child_process')
    const child = childProcess.spawn(
      process.execPath,
      ['-e', 'setInterval(() => undefined, 1_000)'],
      { stdio: 'ignore' },
    )
    children.push(child)
    await once(child, 'spawn')
    const rootPid = child.pid
    expect(rootPid).toBeDefined()
    let playwrightObservedClose = false
    child.once('close', () => {
      playwrightObservedClose = true
    })

    execFileAsyncMock.mockImplementation(
      async (command: string, _arguments: readonly string[], options: { windowsHide?: boolean }) => {
        expect(options.windowsHide).toBe(true)
        if (command === 'powershell.exe') {
          return {
            stderr: '',
            stdout: JSON.stringify({
              Name: 'node',
              ParentProcessId: process.pid,
              ProcessId: rootPid,
            }),
          }
        }
        expect(command).toBe('taskkill')
        child.kill('SIGKILL')
        throw new Error('taskkill timed out')
      },
    )

    const { forceCloseElectronApplication } = await import('./electron-process-tree')
    const processHandle = vi
      .fn()
      .mockReturnValueOnce(child)
      .mockImplementation(() => {
        throw new Error('Playwright application handle is already detached')
      })
    await forceCloseElectronApplication(
      fromPartial<ElectronApplication>({
        process: processHandle,
      }),
    )

    expect(playwrightObservedClose).toBe(true)
    expect(processHandle).toHaveBeenCalledOnce()
    expect(execFileAsyncMock).toHaveBeenCalledTimes(2)
  })

  it('releases Playwright bookkeeping before reporting a surviving tree', async () => {
    vi.useFakeTimers()
    const childProcess = await import('node:child_process')
    const child = childProcess.spawn(
      process.execPath,
      ['-e', 'setInterval(() => undefined, 1_000)'],
      { stdio: 'ignore' },
    )
    children.push(child)
    await once(child, 'spawn')
    const rootPid = child.pid
    expect(rootPid).toBeDefined()
    let playwrightObservedClose = false
    child.once('close', () => {
      playwrightObservedClose = true
    })
    vi.spyOn(child, 'kill').mockReturnValue(true)

    execFileAsyncMock.mockImplementation(
      async (command: string, _arguments: readonly string[], options: { windowsHide?: boolean }) => {
        expect(options.windowsHide).toBe(true)
        if (command === 'powershell.exe') {
          return {
            stderr: '',
            stdout: JSON.stringify({
              Name: 'node',
              ParentProcessId: process.pid,
              ProcessId: rootPid,
            }),
          }
        }
        expect(command).toBe('taskkill')
        throw new Error('taskkill timed out')
      },
    )

    const { forceCloseElectronApplication } = await import('./electron-process-tree')
    const cleanup = forceCloseElectronApplication(
      fromPartial<ElectronApplication>({
        process: () => child,
      }),
    )
    const cleanupResult = expect(cleanup).rejects.toThrow('process tree still alive')
    await vi.advanceTimersByTimeAsync(11_000)

    await cleanupResult
    expect(playwrightObservedClose).toBe(true)
  })
})
