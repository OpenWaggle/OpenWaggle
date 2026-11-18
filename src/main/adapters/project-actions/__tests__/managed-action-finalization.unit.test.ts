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

it.each([
  { stage: 'history', fails: false },
  { stage: 'history', fails: true },
  { stage: 'metadata', fails: false },
  { stage: 'metadata', fails: true },
] as const)(
  'keeps completion active until $stage settles, fails=$fails',
  async ({ stage, fails }) => {
    const run = await fixture.runs.start({
      workspace: fixture.workspace,
      actionId: 'test',
      requestId: 'finish',
    })
    fixture.processes[0]?.emit('final output\n')
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    const flush = fixture.history.flush.bind(fixture.history)
    const save = fixture.persistence.save.bind(fixture.persistence)
    if (stage === 'history') {
      vi.spyOn(fixture.history, 'flush').mockImplementationOnce(async () => {
        entered.resolve()
        await gate.promise
        await flush()
      })
    } else {
      vi.spyOn(fixture.persistence, 'save').mockImplementationOnce(async (finished) => {
        entered.resolve()
        await gate.promise
        await save(finished)
      })
    }
    fixture.processes[0]?.finish(0)
    await entered.promise
    try {
      const page = await fixture.runs.output(fixture.workspace.workspaceId, run.id)
      expect(page.run.status).toBe('running')
      expect(page.run.finishedAt).toBeNull()
      expect(page.output).toBe('final output\n')
      expect(fixture.owners()).toBe(1)
    } finally {
      if (fails) gate.reject(new Error('Simulated disk write failure'))
      else gate.resolve()
    }
    if (fails) {
      await expect.poll(() => fixture.errors.length).toBeGreaterThan(0)
      const failed = await fixture.runs.output(fixture.workspace.workspaceId, run.id)
      expect(failed.run).toMatchObject({
        status: 'stopping',
        error: 'Simulated disk write failure',
        finishedAt: null,
      })
      expect(fixture.owners()).toBe(1)
      await fixture.runs.stop(fixture.workspace.workspaceId, run.id)
    }
    await expect.poll(() => fixture.owners()).toBe(0)
    const finished = await fixture.runs.output(fixture.workspace.workspaceId, run.id)
    expect(finished.run.status).toBe(fails ? 'stopped' : 'completed')
    expect(finished.run.finishedAt).not.toBeNull()
    expect(finished.output).toBe('final output\n')
  },
)

it.each(['history', 'metadata'] as const)(
  'waits for pending completion when Stop arrives during the final %s write',
  async (stage) => {
    const run = await fixture.runs.start({
      workspace: fixture.workspace,
      actionId: 'test',
      requestId: 'finish-and-stop',
    })
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    const save = fixture.persistence.save.bind(fixture.persistence)
    const writes = vi.spyOn(fixture.persistence, 'save')
    if (stage === 'history') {
      const flush = fixture.history.flush.bind(fixture.history)
      vi.spyOn(fixture.history, 'flush').mockImplementationOnce(async () => {
        entered.resolve()
        await gate.promise
        await flush()
      })
    } else {
      writes.mockImplementationOnce(async (finished) => {
        entered.resolve()
        await gate.promise
        await save(finished)
      })
    }
    fixture.processes[0]?.finish(0)
    await entered.promise
    const stopping = fixture.runs.stop(fixture.workspace.workspaceId, run.id)
    gate.resolve()
    expect((await stopping).status).toBe('completed')
    expect((await fixture.runs.output(fixture.workspace.workspaceId, run.id)).run.status).toBe(
      'completed',
    )
    expect(fixture.owners()).toBe(0)
    expect(writes.mock.calls.map(([saved]) => saved.status)).toEqual(['completed'])
  },
)
