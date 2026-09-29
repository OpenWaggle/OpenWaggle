import type { LocalSessionCommandResult } from '@shared/types/local-session-protocol'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.0.0-test' } }))
vi.mock('../cli-stdout', () => ({
  cliStdoutIsTerminal: () => false,
  writeCliStdout: async () => undefined,
}))
vi.mock('../local-session-cli-client', () => ({ createLocalSessionCliClientInput: vi.fn() }))
vi.mock('../session-host/local-session-client', () => ({
  executeLocalSessionCommand: vi.fn(),
  watchLocalSessionEvents: vi.fn(),
}))

const { runRunCli, RUN_CLI_INTERRUPTED_EXIT } = await import('../run-cli')
const { harness, launchedResult, resetSequence, RUN, settled, textDelta, transport } = await import(
  './run-cli-harness'
)

beforeEach(() => resetSequence())

const missingSession = fromPartial<LocalSessionCommandResult>({
  contract: 'session-query-v2',
  response: { outcome: { operation: 'turns', error: { code: 'session_not_found' } } },
})

describe('openwaggle run reconciliation', () => {
  it('cancels while the prompt is still being read from stdin', async () => {
    const test = harness()
    const dependencies = {
      ...test.dependencies,
      resolveMessageInput: () => new Promise<never>(() => undefined),
    }
    const running = runRunCli(['--stdin'], dependencies)
    await vi.waitFor(() => test.interrupt())

    expect(await running).toBe(RUN_CLI_INTERRUPTED_EXIT)
    expect(test.commands).toEqual([])
    expect(test.stderr.join('')).toContain('interrupted before the Run started')
  })

  it('cancels while the event subscription is still being set up', async () => {
    const test = harness()
    const dependencies = {
      ...test.dependencies,
      watch: () => new Promise<never>(() => undefined),
    }
    const running = runRunCli(['task'], dependencies)
    await vi.waitFor(() => expect(test.stderr).not.toBeUndefined())
    await new Promise((resolve) => setTimeout(resolve, 0))
    test.interrupt()

    expect(await running).toBe(RUN_CLI_INTERRUPTED_EXIT)
    expect(test.commands).toEqual([])
    expect(test.stderr.join('')).toContain('nothing was launched')
  })

  it('does not show the output of a Run that replaced this one', async () => {
    const test = harness({
      afterLaunch: [
        textDelta('mine '),
        transport({ type: 'agent_start', timestamp: 2, runId: 'r-2' }),
        textDelta('theirs'),
        transport({ type: 'agent_end', timestamp: 3, runId: 'r-2', reason: 'stop' }),
      ],
    })
    const running = runRunCli(['task'], test.dependencies)
    await vi.waitFor(() => expect(test.stderr.join('')).toContain('started Session'))
    await test.emit(settled('completed'))

    expect(await running).toBe(0)
    expect(test.stdout.join('')).toContain('mine')
    expect(test.stdout.join('')).not.toContain('theirs')
  })

  it('settles a replayed launch it is not allowed to look up instead of waiting', async () => {
    const test = harness({ launchResult: launchedResult(true) })
    const dependencies = {
      ...test.dependencies,
      execute: async (input: Parameters<typeof test.dependencies.execute>[0]) => {
        if (input.payload.contract !== 'session-query-v2') return test.dependencies.execute(input)
        throw new Error('LocalSessionCommandAuthorizationError: capability_denied')
      },
    }

    expect(await runRunCli(['task'], dependencies)).toBe(4)
    expect(test.stderr.join('')).toContain("could not read the Run's status (authorization)")
  })

  it('settles when the Session is gone', async () => {
    const test = harness({ launchResult: launchedResult(true) })
    const dependencies = {
      ...test.dependencies,
      execute: async (input: Parameters<typeof test.dependencies.execute>[0]) =>
        input.payload.contract === 'session-query-v2'
          ? missingSession
          : test.dependencies.execute(input),
    }

    expect(await runRunCli(['task'], dependencies)).toBe(5)
  })

  it('finds a replayed Run on a later page of recent Runs', async () => {
    const test = harness({ launchResult: launchedResult(true) })
    const pages = [
      fromPartial<LocalSessionCommandResult>({
        contract: 'session-query-v2',
        response: {
          outcome: {
            operation: 'turns',
            turns: [{ runId: 'newer', status: 'completed' }],
            nextCursor: 'c-2',
          },
        },
      }),
      fromPartial<LocalSessionCommandResult>({
        contract: 'session-query-v2',
        response: { outcome: { operation: 'turns', turns: [{ runId: RUN, status: 'completed' }] } },
      }),
    ]
    const dependencies = {
      ...test.dependencies,
      execute: async (input: Parameters<typeof test.dependencies.execute>[0]) =>
        input.payload.contract === 'session-query-v2'
          ? (pages.shift() ?? missingSession)
          : test.dependencies.execute(input),
    }

    expect(await runRunCli(['task'], dependencies)).toBe(0)
  })
})
