import { fromPartial } from '@total-typescript/shoehorn'
import type * as NodePtyModule from 'node-pty'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installTerminalWindowsTelemetry,
  readWindowsTerminalListeners,
  readWindowsTerminalProcesses,
} from '../terminal-windows-telemetry'

const shell = { pid: 42, ppid: 1, startedAt: '100', name: 'pwsh.exe' }

function install(processValue: unknown = [shell], listenerValue: unknown = []) {
  const processTable = vi.fn(() => processValue)
  const listeningPorts = vi.fn(() => listenerValue)
  installTerminalWindowsTelemetry(
    Object.assign(fromPartial<typeof NodePtyModule>({}), { processTable, listeningPorts }),
  )
  return { processTable, listeningPorts }
}

afterEach(() => {
  installTerminalWindowsTelemetry(fromPartial({}))
  vi.useRealTimers()
})

describe('native Windows terminal telemetry', () => {
  it('keeps metadata separate from kernel ownership evidence', async () => {
    install([shell, { pid: 43, ppid: 42, startedAt: '101', name: 'node.exe' }])
    const rows = await readWindowsTerminalProcesses()
    expect(rows?.get(42)).toMatchObject({
      name: 'pwsh',
      identityVerified: false,
      ttyIdentity: null,
    })
    expect(rows?.get(43)).toMatchObject({ ppid: 42, name: 'node' })
  })

  it('rejects ancestry through a parent PID reused after the child was born', async () => {
    install([shell, { pid: 43, ppid: 42, startedAt: '99', name: 'old.exe' }])
    expect((await readWindowsTerminalProcesses())?.get(43)?.ppid).toBe(0)
  })

  it.each([
    [{ ...shell, pid: -1 }],
    [{ ...shell, startedAt: 'invalid' }],
    [shell, shell],
    Array(16_385).fill(shell),
  ])('rejects malformed or over-budget process rows', async (...rows) => {
    install(rows)
    expect(await readWindowsTerminalProcesses()).toBeNull()
  })

  it('returns unavailable without loading or spawning a fallback when the API is missing', async () => {
    installTerminalWindowsTelemetry(fromPartial({}))
    expect(await readWindowsTerminalProcesses()).toBeNull()
    expect(await readWindowsTerminalListeners()).toBeNull()
  })

  it('retains a single flight after a caller deadline and can recover after native completion', async () => {
    vi.useFakeTimers()
    let finish: ((value: unknown) => void) | undefined
    const pending = new Promise<unknown>((resolve) => {
      finish = resolve
    })
    const queries = install(pending)
    const first = readWindowsTerminalProcesses({ timeoutMs: 10 })
    await vi.advanceTimersByTimeAsync(10)
    expect(await first).toBeNull()
    const second = readWindowsTerminalProcesses()
    await vi.advanceTimersByTimeAsync(0)
    expect(queries.processTable).toHaveBeenCalledOnce()
    finish?.([shell])
    expect((await second)?.has(42)).toBe(true)
    queries.processTable.mockReturnValue([shell])
    expect((await readWindowsTerminalProcesses())?.has(42)).toBe(true)
    expect(queries.processTable).toHaveBeenCalledTimes(2)
  })

  it('cancels one caller without cancelling another and never starts an expired query', async () => {
    let finish: ((value: unknown) => void) | undefined
    const queries = install(
      new Promise<unknown>((resolve) => {
        finish = resolve
      }),
    )
    const controller = new AbortController()
    const first = readWindowsTerminalProcesses({ signal: controller.signal })
    const second = readWindowsTerminalProcesses()
    controller.abort()
    expect(await first).toBeNull()
    finish?.([shell])
    expect((await second)?.has(42)).toBe(true)
    await readWindowsTerminalProcesses({ signal: controller.signal })
    await readWindowsTerminalProcesses({ timeoutMs: 0 })
    expect(queries.processTable).toHaveBeenCalledOnce()
  })

  it('handles native rejection and validates IPv4 and IPv6 listeners', async () => {
    const queries = install(
      [shell],
      [
        { pid: 42, port: 3000, host: '127.0.0.1' },
        { pid: 43, port: 4000, host: '::1' },
      ],
    )
    expect(await readWindowsTerminalListeners()).toHaveLength(2)
    queries.processTable.mockImplementation(() => {
      throw new Error('native failure')
    })
    expect(await readWindowsTerminalProcesses()).toBeNull()
    queries.listeningPorts.mockReturnValue([{ pid: 42, port: 65_536, host: '::1' }])
    expect(await readWindowsTerminalListeners()).toBeNull()
  })
})
