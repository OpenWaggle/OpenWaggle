import { afterEach, beforeEach, expect, it } from 'vitest'
import { createManagedActionFixture } from './managed-action-runs.test-harness'

let fixture: Awaited<ReturnType<typeof createManagedActionFixture>>
beforeEach(async () => {
  fixture = await createManagedActionFixture()
})
afterEach(async () => {
  await fixture.dispose()
})
const input = (requestId: string) => ({ workspace: fixture.workspace, actionId: 'test', requestId })

it('serializes GUI and agent starts into one execution and deduplicates retried requests after completion', async () => {
  const [gui, agent] = await Promise.all([
    fixture.runs.start(input('gui')),
    fixture.runs.start(input('agent')),
  ])
  expect(agent.id).toBe(gui.id)
  expect(fixture.processes).toHaveLength(1)
  expect(fixture.owners()).toBe(1)
  await fixture.runs.stop(fixture.workspace.workspaceId, gui.id)
  const retry = await fixture.runs.start(input('agent'))
  expect(retry.id).toBe(gui.id)
  expect(retry.status).toBe('stopped')
  expect(fixture.processes).toHaveLength(1)
  expect(fixture.owners()).toBe(0)
  expect((await fixture.runs.start(input('new-request'))).id).not.toBe(gui.id)
})

it('opens an existing execution after definition removal and validates Restart before stopping it', async () => {
  const first = await fixture.runs.start(input('first'))
  fixture.edit([])
  expect((await fixture.runs.start(input('open-existing'))).id).toBe(first.id)
  await expect(fixture.runs.start({ ...input('restart'), restartRunId: first.id })).rejects.toThrow(
    'no longer available',
  )
  expect(fixture.processes[0]?.isStopped()).toBe(false)
  fixture.edit([{ ...fixture.definition, name: 'New name' }])
  fixture.failValidation(new Error('Runner unavailable'))
  await expect(fixture.runs.start({ ...input('restart'), restartRunId: first.id })).rejects.toThrow(
    'Runner unavailable',
  )
  expect(fixture.processes[0]?.isStopped()).toBe(false)
  fixture.failValidation(null)
  const next = await fixture.runs.start({ ...input('restart'), restartRunId: first.id })
  expect(next.id).not.toBe(first.id)
  expect(next.action.name).toBe('New name')
  expect(fixture.processes[0]?.isStopped()).toBe(true)
  expect(fixture.records.get(first.id)?.action.name).toBe('Test')
})

it('isolates workspaces and allows overlap only for explicitly concurrent finite actions', async () => {
  const first = await fixture.runs.start(input('first'))
  const separate = await fixture.runs.start({
    ...input('second'),
    workspace: { ...fixture.workspace, workspaceId: 'workspace-two' },
  })
  expect(first.id).not.toBe(separate.id)
  await fixture.runs.stop(fixture.workspace.workspaceId, first.id)
  fixture.edit([{ ...fixture.definition, allowConcurrent: true }])
  const concurrent = await Promise.all([
    fixture.runs.start(input('third')),
    fixture.runs.start(input('fourth')),
  ])
  expect(concurrent[0]?.id).not.toBe(concurrent[1]?.id)
  await expect(fixture.runs.stop('workspace-two', concurrent[0]?.id ?? '')).rejects.toThrow(
    'not found in this workspace',
  )
})

it('reconnects by cursor without another launch and detects preview URLs across output chunks', async () => {
  const run = await fixture.runs.start(input('first'))
  fixture.processes[0]?.emit('ready: http://local')
  fixture.processes[0]?.emit('host:4321/\r\nhello 🌊\n')
  const initial = await fixture.runs.output(fixture.workspace.workspaceId, run.id)
  expect(initial.output).toContain('hello 🌊')
  expect(initial.run.previewUrl).toBe('http://localhost:4321/')
  expect(initial.run.ready).toBe(false)
  await expect
    .poll(async () => (await fixture.runs.list(fixture.workspace.workspaceId))[0]?.ready)
    .toBe(true)
  fixture.processes[0]?.emit('next line\n')
  const reconnected = await fixture.runs.output(
    fixture.workspace.workspaceId,
    run.id,
    initial.endOffset,
  )
  expect(reconnected.output).toBe('next line\n')
  expect(fixture.processes).toHaveLength(1)
  expect(fixture.owners()).toBe(1)
})

it('retains ownership after a failed Stop and permits retry before a replacement launch', async () => {
  const first = await fixture.runs.start(input('first'))
  fixture.failStop(new Error('Process exit could not be confirmed'))
  await expect(fixture.runs.start({ ...input('restart'), restartRunId: first.id })).rejects.toThrow(
    'could not be confirmed',
  )
  expect(fixture.owners()).toBe(1)
  expect(fixture.processes).toHaveLength(1)
  fixture.failStop(null)
  const next = await fixture.runs.start({ ...input('restart'), restartRunId: first.id })
  expect(next.id).not.toBe(first.id)
  expect(fixture.owners()).toBe(1)
})

it('stops services when their workspace is released while leaving other workspaces alone', async () => {
  fixture.edit([{ ...fixture.definition, kind: 'service' }])
  const first = await fixture.runs.start(input('first'))
  const separate = await fixture.runs.start({
    ...input('second'),
    workspace: { ...fixture.workspace, workspaceId: 'workspace-two' },
  })
  await fixture.runs.stopWorkspaceServices(fixture.workspace.workspaceId)
  expect(fixture.records.get(first.id)?.status).toBe('stopped')
  expect(fixture.records.get(separate.id)?.status).toBe('running')
})

it('keeps read-only reuse safe if a run finishes before the request reaches the Host', async () => {
  const first = await fixture.runs.start(input('first'))
  await fixture.runs.stop(fixture.workspace.workspaceId, first.id)
  fixture.edit([])
  const receipt = await fixture.runs.start({ ...input('reuse'), reuseRunId: first.id })
  expect(receipt.id).toBe(first.id)
  expect(receipt.status).toBe('stopped')
  expect(fixture.processes).toHaveLength(1)
  expect((await fixture.runs.start(input('reuse'))).id).toBe(first.id)
  await expect(fixture.runs.start({ ...input('missing'), reuseRunId: 'missing' })).rejects.toThrow(
    'does not belong to this workspace action',
  )
  expect(fixture.processes).toHaveLength(1)
})
