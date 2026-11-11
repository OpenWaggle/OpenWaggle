import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type {
  LocalScheduledTasksCommandResult,
  ScheduledTask,
  ScheduledTasksOutcome,
} from '@shared/types/scheduled-task'
import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const stdout: string[] = []
  const stderr: string[] = []
  return { execute: vi.fn(), stdout, stderr }
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

const LAUNCH = fromPartial<ScheduledTask>({
  id: 'task-launch',
  name: 'Morning triage',
  prompt: 'Triage new issues.',
  enabled: true,
  schedule: { kind: 'daily', at: '09:00', weekdays: [1, 2, 3, 4, 5] },
  timeZone: 'Europe/Madrid',
  endsAt: null,
  maxRuns: null,
  target: {
    kind: 'launch',
    projectPath: '/repo',
    workspace: 'new-worktree',
    archiveFinishedSessions: false,
  },
  notificationPolicy: 'failures-only',
  heartbeat: null,
})

const HEARTBEAT = fromPartial<ScheduledTask>({
  id: 'task-heartbeat',
  name: 'Watch CI',
  prompt: 'Check the CI run and fix what fails.',
  enabled: true,
  schedule: { kind: 'interval', everyMinutes: 30 },
  timeZone: 'Europe/Madrid',
  endsAt: null,
  maxRuns: 12,
  target: { kind: 'heartbeat', sessionId: 'session-1' },
  notificationPolicy: 'every-run',
  heartbeat: {
    stopWhen: 'CI is green.',
    indefinite: false,
    idlePauseAfter: 3,
    wakeCheck: { command: 'gh pr checks 42 | grep -i fail || true', onFailure: 'wake' },
  },
})

function answer(outcome: ScheduledTasksOutcome): LocalScheduledTasksCommandResult {
  return {
    contract: 'scheduled-tasks-v1',
    response: { contractVersion: 1, requestId: 'request', operation: 'list', outcome },
  }
}

/** The create inputs the CLI sent, in order. */
function createdInputs() {
  return mocks.execute.mock.calls.map((call: readonly unknown[]) => {
    const payload: unknown = Reflect.get(Object(call[0]), 'payload')
    const command: unknown = Reflect.get(Object(Reflect.get(Object(payload), 'request')), 'command')
    if (Reflect.get(Object(command), 'operation') !== 'create') {
      throw new Error('Expected a create.')
    }
    return Reflect.get(Object(command), 'input')
  })
}

const importDirectories: string[] = []

function importFile(contents: unknown) {
  const directory = mkdtempSync(path.join(tmpdir(), 'ow-schedules-import-'))
  importDirectories.push(directory)
  const file = path.join(directory, 'tasks.json')
  writeFileSync(file, JSON.stringify(contents))
  return file
}

afterEach(() => {
  for (const directory of importDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function lastJson() {
  return JSON.parse(mocks.stdout.at(-1) ?? 'null')
}

beforeEach(() => {
  mocks.stdout.length = 0
  mocks.stderr.length = 0
  mocks.execute.mockReset()
  vi.spyOn(process.stderr, 'write').mockImplementation((value) => {
    mocks.stderr.push(String(value))
    return true
  })
})

describe('openwaggle schedules machine output (ADR 0063)', () => {
  it('exports a versioned scheduled-tasks envelope, with or without --json', async () => {
    mocks.execute.mockResolvedValue(answer({ effect: 'listed', tasks: [LAUNCH, HEARTBEAT] }))

    expect(await runSchedulesCli(['export'])).toBe(0)
    const plain = lastJson()
    expect(await runSchedulesCli(['export', '--json'])).toBe(0)

    expect(lastJson()).toEqual(plain)
    expect(plain).toMatchObject({ schemaVersion: 1, type: 'scheduled-tasks' })
    expect(Object.keys(plain)).toEqual(['schemaVersion', 'type', 'tasks'])
    expect(plain.tasks.map((task: { name: string }) => task.name)).toEqual([
      'Morning triage',
      'Watch CI',
    ])
    expect(plain.tasks[0]).not.toHaveProperty('id')
  })

  it('prints the refusal instead of an empty export when the list is refused', async () => {
    mocks.execute.mockResolvedValue(
      answer({
        effect: 'rejected',
        code: 'capability_denied',
        kind: 'authorization',
        message: 'schedules:read is required.',
      }),
    )

    expect(await runSchedulesCli(['export', '--json'])).toBe(4)
    expect(lastJson()).toMatchObject({
      type: 'response',
      command: 'schedules export',
      result: { outcome: { effect: 'rejected', code: 'capability_denied' } },
    })
    expect(await runSchedulesCli(['export'])).toBe(4)
    expect(mocks.stdout.at(-1)).not.toContain('scheduled-tasks')
  })

  it('imports what it exported and creates the same tasks again', async () => {
    mocks.execute.mockResolvedValue(answer({ effect: 'listed', tasks: [LAUNCH, HEARTBEAT] }))
    await runSchedulesCli(['export'])
    const exported = lastJson()
    mocks.execute.mockReset()
    mocks.execute.mockImplementation(async () => answer({ effect: 'created', task: LAUNCH }))

    expect(await runSchedulesCli(['import', importFile(exported), '--json'])).toBe(0)

    expect(createdInputs()).toEqual(exported.tasks)
  })

  it('still imports the bare task array that betas before 1.0 exported', async () => {
    mocks.execute.mockResolvedValue(answer({ effect: 'listed', tasks: [LAUNCH] }))
    await runSchedulesCli(['export'])
    const { tasks } = lastJson()
    mocks.execute.mockReset()
    mocks.execute.mockImplementation(async () => answer({ effect: 'created', task: LAUNCH }))

    expect(await runSchedulesCli(['import', importFile(tasks), '--json'])).toBe(0)

    expect(createdInputs()).toEqual(tasks)
  })

  it('imports a schemaVersion 1 file for good', async () => {
    mocks.execute.mockImplementation(async () => answer({ effect: 'created', task: LAUNCH }))
    // Written out by hand, as 1.0 exports it: later releases must keep importing it.
    const task = {
      name: 'Morning triage',
      prompt: 'Triage new issues.',
      enabled: true,
      schedule: { kind: 'daily', at: '09:00', weekdays: [1, 2, 3, 4, 5] },
      timeZone: 'Europe/Madrid',
      endsAt: null,
      maxRuns: null,
      target: {
        kind: 'launch',
        projectPath: '/repo',
        workspace: 'new-worktree',
        archiveFinishedSessions: false,
      },
      notificationPolicy: 'failures-only',
    }
    const file = importFile({ schemaVersion: 1, type: 'scheduled-tasks', tasks: [task] })

    expect(await runSchedulesCli(['import', file, '--json'])).toBe(0)
    expect(createdInputs()).toEqual([task])
  })

  it('refuses an export from a newer schema version without creating anything', async () => {
    const file = importFile({ schemaVersion: 2, type: 'scheduled-tasks', tasks: [] })

    expect(await runSchedulesCli(['import', file, '--json'])).toBe(2)

    expect(mocks.execute).not.toHaveBeenCalled()
    expect(JSON.parse(mocks.stderr.join(''))).toEqual({
      schemaVersion: 1,
      type: 'error',
      error: {
        kind: 'usage',
        message:
          'This export has schemaVersion 2, written by a newer OpenWaggle. This version imports schemaVersion 1 and earlier. Update OpenWaggle, then import the file again.',
      },
    })
  })

  it('answers import --json with an array of responses, also for one task', async () => {
    mocks.execute.mockResolvedValue(answer({ effect: 'listed', tasks: [LAUNCH] }))
    await runSchedulesCli(['export'])
    const exported = lastJson()
    mocks.execute.mockReset()
    mocks.execute.mockImplementation(async () => answer({ effect: 'created', task: LAUNCH }))

    expect(await runSchedulesCli(['import', importFile(exported), '--json'])).toBe(0)

    const envelope = lastJson()
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      type: 'response',
      command: 'schedules import',
    })
    expect(Array.isArray(envelope.result)).toBe(true)
    expect(envelope.result).toHaveLength(1)
  })

  it('answers a one-response command with that response, and a refusal with its kind', async () => {
    mocks.execute.mockResolvedValue(
      answer({
        effect: 'rejected',
        code: 'task_not_found',
        kind: 'not_found',
        message: 'No task.',
      }),
    )

    expect(await runSchedulesCli(['show', 'task-missing', '--json'])).toBe(5)

    expect(lastJson()).toMatchObject({
      command: 'schedules show',
      result: { outcome: { effect: 'rejected', code: 'task_not_found', kind: 'not_found' } },
    })
  })
})
