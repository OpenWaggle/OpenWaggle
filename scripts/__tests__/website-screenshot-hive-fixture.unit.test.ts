import { describe, expect, it } from 'vitest'
import { hiveNextActor } from '../../src/shared/domain/hive-next-actor'
import { hiveWorkerFixtures } from '../website-screenshot-hive-fixture'

describe('website Hive screenshot fixture', () => {
  it('fills every who-acts-next group of the Hive panel, below the first level too', () => {
    const workers = hiveWorkerFixtures()
    const groups = workers
      .filter((worker) => worker.archived !== true)
      .map((worker) => {
        // Seeded Hives have no active Run and nothing queued, so no parent will act.
        const next = hiveNextActor({
          delegationState: worker.delegationState,
          attentionCause: worker.attentionCause ?? null,
          parentWillAct: false,
        })
        const parent =
          worker.parentWorkerIndex === undefined
            ? 'Queen'
            : workers[worker.parentWorkerIndex]?.title
        return `${next?.nextActor ?? 'none'}:${next?.nextActor === 'parent' ? parent : ''}`
      })

    expect(new Set(groups)).toEqual(
      new Set([
        'user:',
        'parent:Queen',
        'parent:Review the Hive user guide',
        'worker:',
        'none:',
      ]),
    )
    expect(workers.some((worker) => worker.archived === true)).toBe(true)
  })
})
