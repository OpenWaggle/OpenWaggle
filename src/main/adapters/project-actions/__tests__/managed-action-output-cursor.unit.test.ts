import { afterEach, beforeEach, expect, it } from 'vitest'
import { createManagedActionFixture } from './managed-action-runs.test-harness'

let fixture: Awaited<ReturnType<typeof createManagedActionFixture>>
beforeEach(async () => {
  fixture = await createManagedActionFixture()
})
afterEach(async () => {
  await fixture.dispose()
})

it('keeps action byte cursors aligned with control bytes after a live run becomes cold', async () => {
  const run = await fixture.runs.start({
    workspace: fixture.workspace,
    actionId: 'test',
    requestId: 'control-cursor',
  })
  const rawOutput = 'before\b\u0007\u0000after'
  fixture.processes[0]?.emit(rawOutput)
  const live = await fixture.runs.output(fixture.workspace.workspaceId, run.id)
  expect(live.output).toBe(rawOutput)
  expect(live.endOffset).toBe(Buffer.byteLength(rawOutput))

  fixture.processes[0]?.finish(0)
  await expect.poll(() => fixture.records.get(run.id)?.status).toBe('completed')

  const continued = await fixture.runs.output(fixture.workspace.workspaceId, run.id, live.endOffset)
  expect(continued).toMatchObject({
    output: '',
    startOffset: live.endOffset,
    endOffset: live.endOffset,
    truncated: false,
  })
  const cold = await fixture.runs.output(fixture.workspace.workspaceId, run.id)
  expect(cold).toMatchObject({
    output: rawOutput,
    startOffset: 0,
    endOffset: Buffer.byteLength(rawOutput),
    truncated: false,
  })
})
