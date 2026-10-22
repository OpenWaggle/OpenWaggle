import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  registerProjects,
  run,
  runSql,
  setUpPiDiscoveryFixture,
} from '../../adapters/pi/__tests__/pi-session-discovery.test-support'
import {
  createIdleSession,
  heartbeatInput,
  scheduledTasks,
  setTaskDue,
} from './scheduled-tasks.test-support'

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
}))

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

const fixture = setUpPiDiscoveryFixture(state)
const MINUTE = 60_000
const CALLER_ID = 'gui:local-user'

async function dueHeartbeat(nominalAt: number) {
  await registerProjects([fixture.project])
  const sessionId = await createIdleSession(fixture.project)
  const outcome = await scheduledTasks({ operation: 'create', input: heartbeatInput(sessionId) })
  if (outcome.effect !== 'created') throw new Error(JSON.stringify(outcome))
  await setTaskDue(outcome.task.id, nominalAt)
  return { sessionId, taskId: outcome.task.id }
}

/** A run row a Host left mid-send, and optionally what Session Control recorded for it. */
function interruptedRun(input: {
  readonly taskId: string
  readonly nominalAt: number
  readonly key: string
  readonly operationOutcome?: Record<string, unknown>
}) {
  return runSql((sql) =>
    Effect.gen(function* () {
      yield* sql`INSERT INTO scheduled_task_runs (
          id, task_id, task_name, trigger, nominal_at, fired_at, missed_count, status,
          idempotency_key, caller_id
        ) VALUES (
          ${`run-${input.key}`}, ${input.taskId}, 'Watch CI', 'schedule', ${input.nominalAt},
          ${input.nominalAt}, 0, 'dispatching', ${input.key}, ${CALLER_ID}
        )`
      if (!input.operationOutcome) return
      yield* sql`INSERT INTO session_operations (
          caller_id, operation, target_scope, idempotency_key, request_json, status,
          outcome_json, created_at, updated_at
        ) VALUES (
          ${CALLER_ID}, 'start', 'scope', ${input.key}, '{}', 'completed',
          ${JSON.stringify(input.operationOutcome)}, 0, 0
        )`
    }),
  )
}

async function settle() {
  const { settleInterruptedFirings } = await import('../scheduled-task-interrupted-runs')
  await run(settleInterruptedFirings)
}

async function readTask(taskId: string) {
  const outcome = await scheduledTasks({ operation: 'read', taskId })
  if (outcome.effect !== 'read') throw new Error(JSON.stringify(outcome))
  return outcome
}

describe('Scheduled task runs a stopped Host left mid-send', () => {
  it('settles a run Session Control started and moves its task past that firing', async () => {
    const nominalAt = Date.now() - MINUTE
    const { sessionId, taskId } = await dueHeartbeat(nominalAt)
    await interruptedRun({
      taskId,
      nominalAt,
      key: 'sent',
      operationOutcome: { operation: 'start', effect: 'started-run', sessionId, runId: 'run-1' },
    })
    await settle()
    const read = await readTask(taskId)
    expect(read.runs[0]).toMatchObject({ status: 'started', sessionId, runId: 'run-1' })
    expect(read.task.runCount).toBe(1)
    expect(read.task.nextNominalAt).toBeGreaterThan(nominalAt)
    expect(read.task.nextRunAt).toBeGreaterThan(Date.now())
  })

  it('fails a run Session Control refused and still moves its task on', async () => {
    const nominalAt = Date.now() - MINUTE
    const { sessionId, taskId } = await dueHeartbeat(nominalAt)
    await interruptedRun({
      taskId,
      nominalAt,
      key: 'refused',
      operationOutcome: { operation: 'start', effect: 'rejected', sessionId, code: 'busy' },
    })
    await settle()
    const read = await readTask(taskId)
    expect(read.runs[0]).toMatchObject({ status: 'failed', reason: 'interrupted-by-host-stop' })
    expect(read.task.runCount).toBe(0)
    expect(read.task.nextNominalAt).toBeGreaterThan(nominalAt)
  })

  it('fails a run that never reached Session Control and leaves its task due', async () => {
    const nominalAt = Date.now() - MINUTE
    const { taskId } = await dueHeartbeat(nominalAt)
    await interruptedRun({ taskId, nominalAt, key: 'unsent' })
    await settle()
    const read = await readTask(taskId)
    expect(read.runs[0]).toMatchObject({
      status: 'failed',
      reason: 'interrupted-by-host-stop',
      message: expect.stringContaining('before this run was sent'),
    })
    expect(read.task.nextNominalAt).toBe(nominalAt)
  })
})
