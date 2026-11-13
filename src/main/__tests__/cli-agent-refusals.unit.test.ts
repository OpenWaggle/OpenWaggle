import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  SCHEDULES_CLI_AGENT_REFUSAL,
  STATUS_CLI_AGENT_REFUSAL,
  WAKE_CHECK_APPROVAL_AGENT_REFUSAL,
} from '../cli-agent-refusals'
import { CliError } from '../cli-error'

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getVersion: () => '0.0.0-test' } }))
vi.mock('../local-session-cli-client', () => ({
  createLocalSessionCliClientInput: mocks.createClient,
  prepareLocalSessionCliClientInput: vi.fn(),
}))

const { runSchedulesCli } = await import('../schedules-cli')
const { readStatusReport } = await import('../status-cli')

/** Refuses as the real client does for an agent Run without a named profile. */
function refuseAgentRun() {
  mocks.createClient.mockImplementation(
    async (_arguments: unknown, options?: { readonly agentRefusal?: string }) => {
      throw new CliError('authorization', options?.agentRefusal ?? 'generic refusal')
    },
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  mocks.createClient.mockReset()
})

describe('the CLI refusal an agent Run gets for the user authority', () => {
  it('points openwaggle schedules at the hive tool and its help, not only at a native path', async () => {
    refuseAgentRun()
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    const exitCode = await runSchedulesCli(['list', '--json'])

    expect(exitCode).not.toBe(0)
    expect(mocks.createClient).toHaveBeenCalledWith(expect.anything(), {
      agentRefusal: SCHEDULES_CLI_AGENT_REFUSAL,
    })
    expect(JSON.parse(String(stderr.mock.calls[0]?.[0]))).toMatchObject({
      type: 'error',
      error: { kind: 'authorization', message: SCHEDULES_CLI_AGENT_REFUSAL },
    })
    expect(SCHEDULES_CLI_AGENT_REFUSAL).toMatch(/hive\(\{ action: "help" \}\)/)
    expect(SCHEDULES_CLI_AGENT_REFUSAL).toMatch(/--profile/)
  })

  it('tells an agent Run that only the user approves a wake check', async () => {
    refuseAgentRun()
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    await runSchedulesCli(['approve-wake-check', 'task-1'])

    expect(mocks.createClient).toHaveBeenCalledWith(expect.anything(), {
      agentRefusal: WAKE_CHECK_APPROVAL_AGENT_REFUSAL,
    })
  })

  it('points openwaggle status at the hive tool actions that answer the same question', async () => {
    const prepareClientInput = vi.fn(async () => {
      throw new CliError('authorization', STATUS_CLI_AGENT_REFUSAL)
    })

    await expect(
      readStatusReport(
        fromPartial({ positionals: [], options: new Map() }),
        fromPartial({ version: () => '1.2.3', prepareClientInput }),
      ),
    ).rejects.toMatchObject({ kind: 'authorization', message: STATUS_CLI_AGENT_REFUSAL })
    expect(prepareClientInput).toHaveBeenCalledWith(expect.anything(), {
      agentRefusal: STATUS_CLI_AGENT_REFUSAL,
    })
  })
})
