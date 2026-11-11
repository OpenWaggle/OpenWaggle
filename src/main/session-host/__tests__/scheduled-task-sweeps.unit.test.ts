import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { describe, expect, it } from 'vitest'
import type { ScheduledTaskRecord } from '../../ports/scheduled-task-repository'

describe('forTask', () => {
  it('keeps a sweep going when one task fails or dies', async () => {
    const { forTask } = await import('../scheduled-task-sweeps')
    const seen: string[] = []
    const records = ['broken', 'dying', 'fine'].map((id) =>
      fromPartial<ScheduledTaskRecord>({ id }),
    )
    const step = (record: ScheduledTaskRecord) =>
      record.id === 'broken'
        ? Effect.fail(new Error('broken'))
        : record.id === 'dying'
          ? Effect.die(new Error('Hive tool source Session was not found: gone'))
          : Effect.sync(() => seen.push(record.id))
    await Effect.runPromise(
      Effect.forEach(records, (record) => forTask(record, 'test', step(record)), {
        discard: true,
      }),
    )
    expect(seen).toEqual(['fine'])
  })

  it('lets an interruption stop the sweep instead of logging it as one task’s failure', async () => {
    const { forTask } = await import('../scheduled-task-sweeps')
    const seen: string[] = []
    const records = ['interrupted', 'after'].map((id) => fromPartial<ScheduledTaskRecord>({ id }))
    const exit = await Effect.runPromiseExit(
      Effect.forEach(
        records,
        (record) =>
          forTask(
            record,
            'test',
            record.id === 'interrupted'
              ? Effect.interrupt
              : Effect.sync(() => seen.push(record.id)),
          ),
        { discard: true },
      ),
    )
    expect(Exit.isInterrupted(exit)).toBe(true)
    expect(seen).toEqual([])
  })
})
