import fs from 'node:fs/promises'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import {
  registerProjects,
  runSql,
  setUpPiDiscoveryFixture,
} from '../../adapters/pi/__tests__/pi-session-discovery.test-support'
import {
  HEARTBEAT_AGENT_REMEDY,
  HEARTBEAT_OWNER_REMEDY,
} from '../../application/scheduled-task-authority'
import {
  agentTaskFixture,
  dispatched,
  launchInput,
  readTask,
  setCeiling,
  storedRunsAs,
} from './scheduled-task-agent-created.test-support'
import {
  createIdleSession,
  fire,
  heartbeatInput,
  scheduledTasks,
  setSessionModel,
} from './scheduled-tasks.test-support'

const { state } = vi.hoisted(() => ({
  state: { userDataDir: '' },
}))

// Each test keeps its files under its own `userData`.
vi.mock('../../desktop-shell/app-paths', async () => {
  const { fakeAppPaths } = await import('../../test-support/fake-desktop-shell')
  return { appPaths: { ...fakeAppPaths(), userData: () => state.userDataDir } }
})

vi.mock('../scheduled-task-dispatch', async () =>
  (await import('./scheduled-task-agent-created.test-support')).fakeScheduledTaskDispatch(),
)

const fixture = setUpPiDiscoveryFixture(state)
const { agentSession, createLaunch, limitToProject } = agentTaskFixture(fixture)

describe('what an agent may schedule within its own access', () => {
  it('holds your task to an agent’s access once that agent rewrites its prompt', async () => {
    await registerProjects([fixture.project])
    const created = await scheduledTasks({
      operation: 'create',
      input: launchInput(fixture.project),
    })
    if (created.effect !== 'created') throw new Error(JSON.stringify(created))
    const { caller } = await agentSession('ask-for-approval')
    const updated = await scheduledTasks(
      { operation: 'update', taskId: created.task.id, patch: { prompt: 'Do something else.' } },
      caller,
    )
    expect(updated).toMatchObject({ effect: 'updated' })
    const stored = await storedRunsAs(created.task.id)
    expect(stored?.creator_caller_id).toBe('gui:local-user')
    expect(JSON.parse(stored?.authority_limits_json ?? 'null')).toMatchObject({
      authorizationCeiling: 'ask-for-approval',
    })
  })

  it('refuses a launch into a project OpenWaggle does not know, when created and when run', async () => {
    await registerProjects([fixture.project])
    const { caller } = await agentSession('yolo')
    const unknown = path.join(fixture.root, 'downloads', 'untrusted')
    await fs.mkdir(unknown, { recursive: true })
    expect(
      await scheduledTasks({ operation: 'create', input: launchInput(unknown) }, caller),
    ).toMatchObject({ effect: 'rejected', code: 'target_not_found', kind: 'not_found' })

    const task = await createLaunch(caller)
    await runSql((sql) =>
      sql`UPDATE scheduled_tasks SET target_json = ${JSON.stringify({
        ...launchInput(unknown).target,
      })}, project_path = ${unknown} WHERE id = ${task.id}`.pipe(Effect.asVoid),
    )
    const before = dispatched.length
    await fire(task.id, Date.now(), 'run-now')
    expect(dispatched).toHaveLength(before)
    expect((await readTask(task.id)).runs[0]).toMatchObject({ status: 'failed' })
  })

  it('refuses a Heartbeat into a Session reaching every project for an agent limited to one', async () => {
    await registerProjects([fixture.project])
    const { caller } = await agentSession('yolo', { projectLimited: true })
    const target = await createIdleSession(fixture.project)
    await setSessionModel(target)
    expect(
      await scheduledTasks({ operation: 'create', input: heartbeatInput(target) }, caller),
    ).toMatchObject({ effect: 'rejected', code: 'target_scope_denied', kind: 'authorization' })
    await limitToProject(target)
    expect(
      await scheduledTasks({ operation: 'create', input: heartbeatInput(target) }, caller),
    ).toMatchObject({ effect: 'created' })
  })

  it('refuses an agent’s edit that would run your Heartbeat beyond that agent’s access', async () => {
    await registerProjects([fixture.project])
    const target = await createIdleSession(fixture.project)
    await setSessionModel(target)
    await setCeiling(target, 'yolo')
    const created = await scheduledTasks({ operation: 'create', input: heartbeatInput(target) })
    if (created.effect !== 'created') throw new Error(JSON.stringify(created))
    const { caller } = await agentSession('ask-for-approval')
    for (const patch of [{ prompt: 'Do something else.' }, { heartbeat: { stopWhen: 'Never.' } }]) {
      const refused = await scheduledTasks(
        { operation: 'update', taskId: created.task.id, patch },
        caller,
      )
      expect(refused).toMatchObject({
        effect: 'rejected',
        code: 'target_scope_denied',
        kind: 'authorization',
      })
      expect(refused.effect === 'rejected' && refused.message).toContain(HEARTBEAT_AGENT_REMEDY)
    }
    expect((await storedRunsAs(created.task.id))?.authority_limits_json).toBeNull()
  })

  it('refuses a Heartbeat whose Session would run with more than its agent could', async () => {
    await registerProjects([fixture.project])
    const { caller } = await agentSession('ask-for-approval')
    const target = await createIdleSession(fixture.project)
    await setCeiling(target, 'yolo')
    const refused = await scheduledTasks(
      { operation: 'create', input: heartbeatInput(target) },
      caller,
    )
    expect(refused).toMatchObject({
      effect: 'rejected',
      code: 'target_scope_denied',
      kind: 'authorization',
    })
    // No task exists yet, so the agent is told who can set it up, not what to edit.
    expect(refused.effect === 'rejected' && refused.message).toContain(HEARTBEAT_AGENT_REMEDY)

    await setCeiling(target, 'ask-for-approval')
    const created = await scheduledTasks(
      { operation: 'create', input: heartbeatInput(target) },
      caller,
    )
    if (created.effect !== 'created') throw new Error(JSON.stringify(created))
    await setCeiling(target, 'yolo')
    await fire(created.task.id, Date.now(), 'run-now')
    const stopped = (await readTask(created.task.id)).task
    expect(stopped).toMatchObject({
      enabled: false,
      attention: { reason: 'creator-authority-revoked' },
    })
    expect(stopped.attention?.message).toContain(HEARTBEAT_OWNER_REMEDY)
  })
})
