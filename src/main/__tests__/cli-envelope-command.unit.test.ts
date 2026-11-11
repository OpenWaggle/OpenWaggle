import type { LocalSessionCommandResult } from '@shared/types/local-session-protocol'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const stdout: string[] = []
  return { execute: vi.fn(), stdout }
})

vi.mock('../local-session-cli-client', () => ({
  createLocalSessionCliClientInput: async () => ({ clientVersion: 'test' }),
  prepareLocalSessionCliClientInput: async () => ({ clientVersion: 'test' }),
}))
vi.mock('../session-host/local-session-client', async () => ({
  executeLocalSessionCommand: mocks.execute,
  LocalSessionHostUpgradePendingError: (
    await import('../session-host/local-session-client-connection')
  ).LocalSessionHostUpgradePendingError,
  probeLocalSessionHost: vi.fn(),
  watchLocalSessionEvents: vi.fn(),
}))
vi.mock('../cli-stdout', () => ({
  writeCliStdout: async (value: string) => {
    mocks.stdout.push(value)
  },
}))

const { runSessionsCli } = await import('../sessions-cli')
const { runSchedulesCli } = await import('../schedules-cli')
const { runHostStart } = await import('../host-start-cli')
const { runHostCli } = await import('../host-cli')
const { runStatusCli } = await import('../status-cli')
const { accessCliResponseText } = await import('../access-cli-output')
const { writeAgentsCliResult } = await import('../agents-cli-output')
const { mcpCliJsonResponse } = await import('../mcp-cli-io')
const { recoveryCliResultText } = await import('../recovery-cli-output')
const { writeUpdateCheckResult } = await import('../update-cli-check-output')

type StatusDependencies = NonNullable<Parameters<typeof runStatusCli>[1]>

function envelopeCommand(text: string | undefined) {
  const envelope: unknown = JSON.parse(text ?? 'null')
  return typeof envelope === 'object' && envelope !== null && 'command' in envelope
    ? envelope.command
    : undefined
}

function statusDependencies(output: string[]) {
  return {
    version: () => '1.2.3',
    now: () => 0,
    prepareClientInput: async () => fromPartial({ clientVersion: 'test' }),
    probe: async () => ({ hostInstanceId: 'host-1', revision: 32 }),
    snapshotActiveRuns: async () => [],
    query: async () => fromPartial({}),
    writeStdout: async (text) => {
      output.push(text)
    },
  } satisfies StatusDependencies
}

beforeEach(() => {
  mocks.stdout.length = 0
  mocks.execute.mockReset()
})

/**
 * Every `openwaggle` CLI's `--json` envelope names its command by the full path after
 * `openwaggle`, space-separated (ADR 0063). These are covered from 1.0.
 */
describe('CLI envelope command names (ADR 0063)', () => {
  it('names hive commands with their group', async () => {
    mocks.execute.mockResolvedValue(
      fromPartial<LocalSessionCommandResult>({
        contract: 'session-query-v2',
        response: {
          contractVersion: 2,
          requestId: 'r',
          outcome: { operation: 'list', sessions: [] },
        },
      }),
    )
    await expect(runSessionsCli(['list', '--all', '--json'])).resolves.toBe(0)
    mocks.execute.mockResolvedValue(
      fromPartial<LocalSessionCommandResult>({
        contract: 'session-control-v2',
        response: {
          outcome: {
            operation: 'delegation-accept',
            effect: 'rejected',
            sessionId: 'queen',
            code: 'submission_revision_stale',
            kind: 'conflict',
          },
        },
      }),
    )
    await expect(
      runSessionsCli(['delegation-accept', 'queen', 'delegation-1', '2', '--json']),
    ).resolves.toBe(6)

    expect(mocks.stdout.map(envelopeCommand)).toEqual(['hive list', 'hive delegation-accept'])
  })

  it('names schedules commands with their group', async () => {
    mocks.execute.mockResolvedValue({
      contract: 'scheduled-tasks-v1',
      response: {
        contractVersion: 1,
        requestId: 'r',
        operation: 'list',
        outcome: { effect: 'listed', tasks: [] },
      },
    })
    await expect(runSchedulesCli(['list', '--json'])).resolves.toBe(0)

    expect(mocks.stdout.map(envelopeCommand)).toEqual(['schedules list'])
  })

  it('names host start, host stop and host status', async () => {
    const output: string[] = []
    await expect(
      runHostStart(['--json'], {
        start: async () => fromPartial({ clientVersion: 'test' }),
        status: { probe: async () => ({ hostInstanceId: 'host-1', revision: 32 }) },
        writeStdout: async (text: string) => {
          output.push(text)
        },
      }),
    ).resolves.toBe(0)
    await expect(
      runHostCli(['stop', '--json'], {
        status: {
          ...statusDependencies(output),
          probe: async () => {
            throw Object.assign(new Error('gone'), { code: 'ECONNREFUSED' })
          },
        },
        updateStop: () => fromPartial({}),
        execute: async () => fromPartial({}),
        now: () => 0,
        wait: async () => undefined,
        writeStdout: async (text) => {
          output.push(text)
        },
      }),
    ).resolves.toBe(0)
    const statusOutput: string[] = []
    await expect(
      runHostCli(['status', '--json'], {
        status: statusDependencies(statusOutput),
        updateStop: () => fromPartial({}),
        execute: async () => fromPartial({}),
        now: () => 0,
        wait: async () => undefined,
        writeStdout: async () => undefined,
      }),
    ).resolves.toBe(0)

    expect([...output, ...statusOutput].map(envelopeCommand)).toEqual([
      'host start',
      'host stop',
      'host status',
    ])
  })

  it('names status and update whole, and access, agents, mcp and recovery commands with their group', async () => {
    const status: string[] = []
    await expect(runStatusCli(['--json'], statusDependencies(status))).resolves.toBe(0)
    const agents: string[] = []
    await writeAgentsCliResult('validate', { valid: true }, true, (text) => {
      agents.push(text)
    })
    await writeUpdateCheckResult({ savedChannel: 'beta', channel: 'beta', status: 'up-to-date' })

    expect(
      [
        status[0],
        accessCliResponseText({
          operation: 'list',
          response: fromPartial({
            outcome: { operation: 'list', effect: 'profiles-listed', profiles: [] },
          }),
          json: true,
          includeRevoked: false,
        }),
        agents[0],
        mcpCliJsonResponse('list', { servers: [] }),
        mcpCliJsonResponse('registry search', { servers: [] }),
        recoveryCliResultText('status', { ready: true }, true),
        // `update --check --json`, which install.sh reads to keep the update channel.
        mocks.stdout[0],
      ].map(envelopeCommand),
    ).toEqual([
      'status',
      'access profiles list',
      'agents validate',
      'mcp list',
      'mcp registry search',
      'recovery status',
      'update',
    ])
  })
})
