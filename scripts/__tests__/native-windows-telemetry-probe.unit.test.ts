import net, { createServer } from 'node:net'
import type * as Net from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeWindowsTerminalTelemetry } from '../native-windows-telemetry-probe'

vi.mock('node:net', async (importOriginal) => {
  const actual = await importOriginal<typeof Net>()
  return { ...actual, createServer: vi.fn(actual.createServer) }
})

afterEach(() => vi.restoreAllMocks())

function fixture() {
  const server = net.createServer()
  vi.mocked(createServer).mockReturnValue(server)
  const processTable = vi.fn(async () => [{ pid: process.pid, ppid: process.ppid, startedAt: '100', name: 'node.exe' }])
  const listeningPorts = vi.fn(async () => {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Probe server is not listening')
    return [{ pid: process.pid, port: address.port, host: '127.0.0.1' }]
  })
  return { server, processTable, listeningPorts }
}

describe('packaged Windows telemetry contract probe', () => {
  it('requires both native metadata methods', async () => {
    await expect(probeWindowsTerminalTelemetry({})).rejects.toThrow()
  })

  it('checks a real owned listener and releases it after success', async () => {
    const subject = fixture()
    await probeWindowsTerminalTelemetry(subject)
    expect(subject.processTable).toHaveBeenCalledOnce()
    expect(subject.listeningPorts).toHaveBeenCalledOnce()
    expect(subject.server.listening).toBe(false)
  })

  it('rejects a snapshot which omits its own process and still closes the listener', async () => {
    const subject = fixture()
    subject.processTable.mockResolvedValue([])
    await expect(probeWindowsTerminalTelemetry(subject)).rejects.toThrow('own process')
    expect(subject.server.listening).toBe(false)
  })

  it('rejects an empty listener snapshot and still closes the listener', async () => {
    const subject = fixture()
    subject.listeningPorts.mockResolvedValue([])
    await expect(probeWindowsTerminalTelemetry(subject)).rejects.toThrow('own TCP listener')
    expect(subject.server.listening).toBe(false)
  })
})
