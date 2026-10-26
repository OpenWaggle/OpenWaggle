import type {
  LocalScheduledTasksCommandResult,
  ScheduledTask,
  ScheduledTaskRun,
  ScheduledTasksOutcome,
} from '@shared/types/scheduled-task'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const stdout: string[] = []
  return { execute: vi.fn(), stdout }
})

vi.mock('../local-session-cli-client', () => ({
  createLocalSessionCliClientInput: async () => ({ clientVersion: 'test' }),
}))
vi.mock('../session-host/local-session-client', () => ({
  executeLocalSessionCommand: mocks.execute,
}))
vi.mock('../cli-stdout', () => ({
  writeCliStdout: async (value: string) => {
    mocks.stdout.push(value)
  },
}))

const { runSchedulesCli } = await import('../schedules-cli')
const { cliWallClockTime } = await import('../cli-wall-clock-time')

// 2026-06-01 08:02:03Z is 17:02:03 in Tokyo, which is not the machine's zone here.
const RUN: ScheduledTaskRun = {
  id: 'run-1',
  taskId: 'task-1',
  trigger: 'schedule',
  nominalAt: Date.UTC(2026, 5, 1, 8, 0),
  firedAt: Date.UTC(2026, 5, 1, 8, 2, 3),
  missedCount: 0,
  status: 'started',
}

function answer(outcome: ScheduledTasksOutcome): LocalScheduledTasksCommandResult {
  return {
    contract: 'scheduled-tasks-v1',
    response: { contractVersion: 1, requestId: 'request', operation: 'runs', outcome },
  }
}

/** The Scheduled task operation a mocked Host call carried. */
function operationOf(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null || !('payload' in input)) return undefined
  const { payload } = input
  if (typeof payload !== 'object' || payload === null || !('request' in payload)) return undefined
  const { request } = payload
  if (typeof request !== 'object' || request === null || !('command' in request)) return undefined
  const { command } = request
  if (typeof command !== 'object' || command === null || !('operation' in command)) return undefined
  return typeof command.operation === 'string' ? command.operation : undefined
}

describe('openwaggle schedules runs', () => {
  beforeEach(() => {
    mocks.stdout.length = 0
    mocks.execute.mockReset()
    mocks.execute.mockImplementation(async (input: unknown) => {
      if (operationOf(input) === 'read') {
        return answer({
          effect: 'read',
          task: fromPartial<ScheduledTask>({ id: 'task-1', timeZone: 'Asia/Tokyo' }),
          runs: [],
        })
      }
      return answer({ effect: 'runs-listed', runs: [RUN] })
    })
  })

  it('shows a task’s runs on the task’s own clock, as show does', async () => {
    expect(await runSchedulesCli(['runs', 'task-1'])).toBe(0)
    expect(mocks.stdout.join('')).toBe('2026-06-01 17:02:03 +09:00 Asia/Tokyo  schedule  started\n')
  })

  it('keeps --json to the runs response alone', async () => {
    expect(await runSchedulesCli(['runs', 'task-1', '--json'])).toBe(0)
    expect(mocks.execute.mock.calls.map(([input]) => operationOf(input))).toEqual(['runs'])
  })

  it('falls back to the machine’s clock when the task cannot be read', async () => {
    mocks.execute.mockImplementation(async (input: unknown) => {
      if (operationOf(input) === 'read') throw new Error('Host went away')
      return answer({ effect: 'runs-listed', runs: [RUN] })
    })
    expect(await runSchedulesCli(['runs', 'task-1'])).toBe(0)
    // The machine's clock, whatever zone runs the test: the same formatter with no zone given.
    expect(mocks.stdout.join('')).toBe(`${cliWallClockTime(RUN.firedAt)}  schedule  started\n`)
    expect(cliWallClockTime(RUN.firedAt)).toMatch(/:03 [+-]\d\d:\d\d \S+$/)
  })
})
