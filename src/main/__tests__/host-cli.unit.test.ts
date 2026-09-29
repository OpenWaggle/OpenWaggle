import type { LocalSessionCommandResult } from '@shared/types/local-session-protocol'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '1.2.3' } }))
vi.mock('../local-session-cli-client', () => ({ prepareLocalSessionCliClientInput: vi.fn() }))
vi.mock('../session-host/local-session-client', async () => ({
  executeLocalSessionCommand: vi.fn(),
  LocalSessionHostUpgradePendingError: (
    await import('../session-host/local-session-client-connection')
  ).LocalSessionHostUpgradePendingError,
  probeLocalSessionHost: vi.fn(),
  watchLocalSessionEvents: vi.fn(),
}))

const { formatHostStopReport, runHostCli, stopHost } = await import('../host-cli')
const { LocalSessionHostUpgradePendingError } = await import(
  '../session-host/local-session-client-connection'
)
const { parseMcpCliArguments } = await import('../mcp-cli-arguments')
type HostCliDependencies = NonNullable<Parameters<typeof runHostCli>[1]>

const unavailable = () => Object.assign(new Error('gone'), { code: 'ECONNREFUSED' })

function dependencies(input: {
  readonly probes: readonly ('running' | 'replaced' | 'gone' | 'old' | 'refusing')[]
  readonly blockingRuns?: number
  readonly blockingActions?: number
  readonly output?: string[]
}) {
  const probes = [...input.probes]
  const execute = vi.fn(
    async (): Promise<LocalSessionCommandResult> =>
      fromPartial({
        contract: 'local-host-v1',
        response: {
          contractVersion: 1,
          operation: 'stop',
          hostInstanceId: 'host-1',
          blockingRuns: input.blockingRuns ?? 0,
          blockingActions: input.blockingActions ?? 0,
        },
      }),
  )
  let time = 0
  const value: HostCliDependencies = {
    status: {
      version: () => '1.2.3',
      now: () => time,
      prepareClientInput: async () => fromPartial({ clientVersion: 'test' }),
      probe: async () => {
        const next = probes.length > 1 ? probes.shift() : probes[0]
        if (next === 'gone') throw unavailable()
        if (next === 'refusing') throw new Error('The Session Host is stopping.')
        if (next === 'old') throw new LocalSessionHostUpgradePendingError('old', [], [])
        return { hostInstanceId: next === 'replaced' ? 'host-2' : 'host-1', revision: 19 }
      },
      snapshotActiveRuns: async () => [],
      query: async () => fromPartial({}),
      writeStdout: async () => undefined,
    },
    execute,
    now: () => time,
    wait: async (milliseconds) => {
      time += milliseconds
    },
    writeStdout: async (text) => {
      input.output?.push(text)
    },
  }
  return { value, execute }
}

const args = (...values: string[]) => parseMcpCliArguments(values)

beforeEach(() => vi.clearAllMocks())

describe('openwaggle host stop', () => {
  it('does nothing when no Session Host is running', async () => {
    const test = dependencies({ probes: ['gone'] })

    expect(await stopHost(args(), test.value)).toEqual({ state: 'not-running' })
    expect(test.execute).not.toHaveBeenCalled()
  })

  it('asks a running Host to stop and reports the Runs it waits for', async () => {
    const test = dependencies({ probes: ['running'], blockingRuns: 2, blockingActions: 1 })

    const report = await stopHost(args(), test.value)

    expect(report).toEqual({
      state: 'stopping',
      hostInstanceId: 'host-1',
      blockingRuns: 2,
      blockingActions: 1,
    })
    expect(formatHostStopReport(report)).toBe(
      "Session Host refuses new work and stops once its 2 active Runs and a running Action finish.\nTo stop it sooner, interrupt Runs with 'openwaggle sessions interrupt <session-id> --expected-run <run-id>' and stop Actions in the desktop app.",
    )
    const oneRun = {
      state: 'stopping',
      hostInstanceId: 'host-1',
      blockingRuns: 1,
      blockingActions: 0,
    } as const
    expect(formatHostStopReport(oneRun).split('\n')[0]).toBe(
      'Session Host refuses new work and stops once its active Run finishes.',
    )
    expect(test.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: {
          contract: 'local-host-v1',
          request: { contractVersion: 1, operation: 'stop' },
        },
      }),
    )
  })

  it('waits until the Host exits with --wait', async () => {
    const test = dependencies({ probes: ['running', 'running', 'running', 'gone'] })

    expect(await stopHost(args('--wait'), test.value)).toMatchObject({ state: 'stopped' })
  })

  it('keeps waiting while a shutting-down Host refuses new connections', async () => {
    const test = dependencies({ probes: ['running', 'refusing', 'refusing', 'gone'] })

    expect(await stopHost(args('--wait'), test.value)).toMatchObject({ state: 'stopped' })
  })

  it('recognizes a new Host started by the desktop app while waiting', async () => {
    const test = dependencies({ probes: ['running', 'running', 'replaced'] })

    expect(await stopHost(args('--wait'), test.value)).toMatchObject({ state: 'replaced' })
  })

  it('times out when active work outlasts --timeout-ms', async () => {
    const output: string[] = []
    const test = dependencies({ probes: ['running'], output })

    expect(await runHostCli(['stop', '--wait', '--timeout-ms', '1000'], test.value)).toBe(7)
    expect(output.join('')).toContain('still stopping')
  })

  it('leaves an older Host to its own handover instead of sending a command it cannot read', async () => {
    const test = dependencies({ probes: ['old'] })

    expect(await stopHost(args(), test.value)).toMatchObject({
      state: 'upgrade-pending',
      blockingRuns: 0,
    })
    expect(test.execute).not.toHaveBeenCalled()
  })

  it('waits for an older Host to hand over with --wait', async () => {
    const test = dependencies({ probes: ['old', 'old', 'gone'] })

    expect(await stopHost(args('--wait'), test.value)).toMatchObject({ state: 'stopped' })
    expect(test.execute).not.toHaveBeenCalled()
  })

  it('checks --timeout-ms before asking the Host to stop', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const test = dependencies({ probes: ['running'] })

    expect(await runHostCli(['stop', '--wait', '--timeout-ms', '0'], test.value)).toBe(2)
    expect(test.execute).not.toHaveBeenCalled()
    stderr.mockRestore()
  })

  it('refuses to stop the Host under an access profile', async () => {
    const test = dependencies({ probes: ['running'] })

    await expect(stopHost(args(), test.value, 'reviewer')).rejects.toThrow(
      "requires the local user's authorization",
    )
    expect(test.execute).not.toHaveBeenCalled()
  })

  it('rejects misplaced options and unknown commands', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const test = dependencies({ probes: ['running'] })

    expect(await runHostCli(['stop', '--timeout-ms', '10'], test.value)).toBe(2)
    expect(await runHostCli(['stop', 'now'], test.value)).toBe(2)
    expect(await runHostCli(['restart'], test.value)).toBe(2)
    expect(test.execute).not.toHaveBeenCalled()
    stderr.mockRestore()
  })

  it('prints usage and routes host status to the status command', async () => {
    const output: string[] = []
    const test = dependencies({ probes: ['gone'], output })

    expect(await runHostCli([], test.value)).toBe(0)
    expect(await runHostCli(['--help'], test.value)).toBe(0)
    expect(output.join('')).toContain('openwaggle host stop [--wait')
    const statusOutput: string[] = []
    const status = {
      ...test.value,
      status: {
        ...test.value.status,
        writeStdout: async (text: string) => {
          statusOutput.push(text)
        },
      },
    }
    expect(await runHostCli(['status'], status)).toBe(0)
    expect(statusOutput.join('')).toContain('Session Host: not running')
  })
})
