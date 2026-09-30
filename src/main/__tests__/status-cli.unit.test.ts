import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import { SessionId, SupportedModelId } from '@shared/types/brand'
import type { LocalSessionCommandResult } from '@shared/types/local-session-protocol'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.0.0-test' } }))
vi.mock('../local-session-cli-client', () => ({ prepareLocalSessionCliClientInput: vi.fn() }))
vi.mock('../session-host/local-session-client', async () => ({
  executeLocalSessionCommand: vi.fn(),
  LocalSessionHostUpgradePendingError: (
    await import('../session-host/local-session-client-connection')
  ).LocalSessionHostUpgradePendingError,
  probeLocalSessionHost: vi.fn(),
  watchLocalSessionEvents: vi.fn(),
}))

const { formatDuration, formatStatusReport, mapWithConcurrency, readStatusReport, runStatusCli } =
  await import('../status-cli')
const { LocalSessionHostUpgradePendingError } = await import(
  '../session-host/local-session-client-connection'
)
type StatusCliDependencies = NonNullable<Parameters<typeof runStatusCli>[1]>

const NOW = 10 * 60_000
const run: BackgroundRunSnapshot = fromPartial({
  activity: 'agent-run',
  sessionId: SessionId('s-1'),
  model: SupportedModelId('openai/gpt-5'),
  mode: 'classic',
  startedAt: NOW - 3 * 60_000,
  activityEvents: [],
  parts: [],
})

function dependencies(overrides: Partial<StatusCliDependencies> = {}): StatusCliDependencies {
  return {
    version: () => '1.2.3',
    now: () => NOW,
    prepareClientInput: async () => fromPartial({ clientVersion: 'test' }),
    probe: async () => ({ hostInstanceId: 'host-1', revision: 17 }),
    snapshotActiveRuns: async () => [run],
    query: async (_input, query): Promise<LocalSessionCommandResult> => {
      if (query.operation === 'read') {
        return fromPartial({
          contract: 'session-query-v2',
          response: {
            outcome: {
              operation: 'read',
              session: { sessionId: 's-1', title: 'Fix tests', projectPath: '/work/app' },
            },
          },
        })
      }
      if (query.operation === 'status') {
        return fromPartial({
          contract: 'session-query-v2',
          response: { outcome: { operation: 'status', sessionId: 's-1', activeRunId: 'r-1' } },
        })
      }
      return fromPartial({
        contract: 'session-query-v2',
        response: {
          outcome: { operation: 'requests-list', sessionId: 's-1', requests: [{}] },
        },
      })
    },
    writeStdout: async () => undefined,
    ...overrides,
  }
}

const noArguments = { positionals: [], passthrough: [], options: new Map() }

describe('openwaggle status', () => {
  it('reports a stopped Session Host without starting it', async () => {
    const snapshotActiveRuns = vi.fn(async () => [])
    const report = await readStatusReport(
      noArguments,
      dependencies({
        probe: async () => {
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        },
        snapshotActiveRuns,
      }),
    )

    expect(report).toEqual({ version: '1.2.3', host: { state: 'not-running' } })
    expect(snapshotActiveRuns).not.toHaveBeenCalled()
    expect(formatStatusReport(report, NOW)).toBe(
      'OpenWaggle 1.2.3\nSession Host: not running (it starts automatically when needed)',
    )
  })

  it('reports an older Host that is waiting to be replaced', async () => {
    const report = await readStatusReport(
      noArguments,
      dependencies({
        probe: async () => {
          throw new LocalSessionHostUpgradePendingError(
            'old-host',
            [{ sessionId: 's-1', runId: 'r-1' }],
            [],
          )
        },
      }),
    )

    expect(report.host).toEqual({
      state: 'upgrade-pending',
      hostInstanceId: 'old-host',
      blockingRuns: 1,
    })
    expect(formatStatusReport(report, NOW)).toContain('once its active Run ends')
  })

  it('lists active Runs with their Session, age, and pending questions', async () => {
    const report = await readStatusReport(noArguments, dependencies())

    expect(report).toEqual({
      version: '1.2.3',
      host: { state: 'running', hostInstanceId: 'host-1', protocolRevision: 17 },
      activeRuns: [
        {
          sessionId: 's-1',
          runId: 'r-1',
          title: 'Fix tests',
          projectPath: '/work/app',
          model: 'openai/gpt-5',
          startedAt: NOW - 3 * 60_000,
          pendingQuestions: 1,
        },
      ],
    })
    expect(formatStatusReport(report, NOW)).toBe(
      [
        'OpenWaggle 1.2.3',
        'Session Host: running',
        'Active runs: 1',
        '  s-1  Fix tests  (openai/gpt-5, 3m, waiting for an answer)',
        '    Run r-1  in /work/app',
      ].join('\n'),
    )
  })

  it('marks details it could not read as unknown instead of guessing', async () => {
    const report = await readStatusReport(
      noArguments,
      dependencies({
        query: async () => {
          throw new Error('connection limit')
        },
      }),
    )

    expect('activeRuns' in report && report.activeRuns[0]).toMatchObject({
      title: null,
      projectPath: null,
      pendingQuestions: null,
    })
    expect(formatStatusReport(report, NOW)).toContain(
      '(Session details unavailable)  (openai/gpt-5, 3m, pending questions unknown)',
    )
  })

  it('reads Session details a few at a time', async () => {
    let inFlight = 0
    let peak = 0
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (item) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 1))
      inFlight -= 1
      return item * 2
    })

    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18])
    expect(peak).toBe(4)
  })

  it('reports no active Runs', async () => {
    const report = await readStatusReport(
      noArguments,
      dependencies({ snapshotActiveRuns: async () => [] }),
    )

    expect(formatStatusReport(report, NOW)).toContain('Active runs: none')
  })

  it('rejects unexpected arguments with a usage error', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    expect(await runStatusCli(['extra'], dependencies())).toBe(2)
    expect(await runStatusCli(['--verbose'], dependencies())).toBe(2)
    expect(
      await runStatusCli(
        ['--profile', 'p', '--credential-stdin', '--profile-credential-file', 'f'],
        dependencies(),
      ),
    ).toBe(2)
    stderr.mockRestore()
  })

  it('prints usage for --help', async () => {
    const output: string[] = []
    const exitCode = await runStatusCli(
      ['--help'],
      dependencies({
        writeStdout: async (text) => {
          output.push(text)
        },
      }),
    )

    expect(exitCode).toBe(0)
    expect(output.join('')).toContain('This command never starts the Session Host.')
  })

  it('shows control sequences and line breaks in titles and paths as text', () => {
    const text = formatStatusReport(
      {
        version: '1.2.3',
        host: { state: 'running', hostInstanceId: 'host-1', protocolRevision: 19 },
        activeRuns: [
          {
            sessionId: 's-1',
            runId: 'r-1',
            title: 'Fix \u001b]0;owned\u0007build\nActive runs: none',
            projectPath: '/repo\u001b[2J',
            model: 'test/model',
            startedAt: NOW,
            pendingQuestions: 0,
          },
        ],
      },
      NOW,
    )

    expect(text).toContain('Fix \\x1b]0;owned\\x07build Active runs: none')
    expect(text.endsWith('    Run r-1  in /repo\\x1b[2J')).toBe(true)
    expect(text).not.toContain('\u001b')
    expect(text.split('\n').filter((line) => line.startsWith('Active runs'))).toEqual([
      'Active runs: 1',
    ])
  })

  it('formats elapsed time compactly', () => {
    expect(formatDuration(42_000)).toBe('42s')
    expect(formatDuration(5 * 60_000)).toBe('5m')
    expect(formatDuration(125 * 60_000)).toBe('2h 5m')
  })
})
