import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createManagedActionFixture } from './managed-action-runs.test-harness'

let fixture: Awaited<ReturnType<typeof createManagedActionFixture>>
beforeEach(async () => {
  fixture = await createManagedActionFixture()
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fixture.dispose()
})
const input = (requestId: string) => ({ workspace: fixture.workspace, actionId: 'test', requestId })

it('keeps a failed launch visible and Stop retryable when its terminal save fails', async () => {
  vi.spyOn(fixture.persistence, 'recordRequest').mockRejectedValue(new Error('Request save failed'))
  const save = fixture.persistence.save.bind(fixture.persistence)
  let failTerminalSave = true
  vi.spyOn(fixture.persistence, 'save').mockImplementation(async (run) => {
    if (run.status === 'failed' && failTerminalSave) throw new Error('Terminal status save failed')
    await save(run)
  })

  await expect(fixture.runs.start(input('failed-start'))).rejects.toThrow(
    'Terminal status save failed',
  )
  const durable = [...fixture.records.values()][0]
  expect(durable?.status).toBe('starting')
  expect(fixture.owners()).toBe(0)
  expect(fixture.processes).toHaveLength(0)
  const listed = (await fixture.runs.list(fixture.workspace.workspaceId))[0]
  expect(listed).toMatchObject({ id: durable?.id, status: 'failed', error: 'Request save failed' })
  expect((await fixture.runs.output(fixture.workspace.workspaceId, durable?.id ?? '')).run).toEqual(
    listed,
  )

  await expect(fixture.runs.stop(fixture.workspace.workspaceId, durable?.id ?? '')).rejects.toThrow(
    'Terminal status save failed',
  )
  expect((await fixture.runs.list(fixture.workspace.workspaceId))[0]?.status).toBe('failed')
  failTerminalSave = false
  const stopped = await fixture.runs.stop(fixture.workspace.workspaceId, durable?.id ?? '')
  expect(stopped.status).toBe('failed')
  expect(fixture.records.get(durable?.id ?? '')).toMatchObject({
    status: 'failed',
    error: 'Request save failed',
  })
  expect(fixture.owners()).toBe(0)
})

it('leaves a concurrent Stop with a durable terminal launch failure', async () => {
  vi.spyOn(fixture.persistence, 'recordRequest').mockRejectedValue(new Error('Request save failed'))
  const terminalSave = Promise.withResolvers<void>()
  const enteredSave = Promise.withResolvers<void>()
  const save = fixture.persistence.save.bind(fixture.persistence)
  vi.spyOn(fixture.persistence, 'save').mockImplementation(async (run) => {
    if (run.status === 'failed') {
      enteredSave.resolve()
      await terminalSave.promise
    }
    await save(run)
  })

  const starting = fixture.runs.start(input('concurrent-stop'))
  await enteredSave.promise
  const runId = [...fixture.records.keys()][0] ?? ''
  const stopping = fixture.runs.stop(fixture.workspace.workspaceId, runId)
  terminalSave.resolve()
  await expect(starting).resolves.toMatchObject({
    status: 'failed',
    error: 'Request save failed',
  })
  expect((await stopping).status).toBe('failed')
  expect(fixture.records.get(runId)?.status).toBe('failed')
  expect(fixture.owners()).toBe(0)
})
