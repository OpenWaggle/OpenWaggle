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

it('does not publish completion while final history persistence fails', async () => {
  const run = await fixture.runs.start({
    workspace: fixture.workspace,
    actionId: 'test',
    requestId: 'failed-output-finalization',
  })
  fixture.processes[0]?.emit('must remain visible')
  const flush = vi
    .spyOn(fixture.history, 'flush')
    .mockRejectedValueOnce(new Error('history disk full'))
  fixture.processes[0]?.finish(0)
  await expect.poll(() => fixture.records.get(run.id)?.status).toBe('stopping')
  expect(fixture.records.get(run.id)?.error).toContain('history disk full')
  expect(fixture.owners()).toBe(1)

  flush.mockRestore()
  const stopped = await fixture.runs.stop(fixture.workspace.workspaceId, run.id)
  expect(stopped.status).toBe('stopped')
  expect(fixture.owners()).toBe(0)
  await expect(
    fixture.runs.output(fixture.workspace.workspaceId, run.id, 0),
  ).resolves.toMatchObject({ output: 'must remain visible' })
})
