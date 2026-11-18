import { describe, expect, it } from 'vitest'
import type { HiveParentWakeOutcome } from '../../application/hive-parent-wake'
import { createHiveParentWakeScheduler, MAX_DEFERRED_PARENTS } from '../hive-parent-wake-scheduler'

type Done = (outcome: HiveParentWakeOutcome | undefined) => void

function harness() {
  const started: string[] = []
  const running = new Map<string, Done>()
  const full: string[] = []
  const scheduler = createHiveParentWakeScheduler({
    start: (request, done) => {
      started.push(request.parentSessionId)
      running.set(request.parentSessionId, done)
    },
    onDeferredFull: (parentSessionId) => full.push(parentSessionId),
  })
  const finish = (parentSessionId: string, outcome: HiveParentWakeOutcome | undefined) => {
    const done = running.get(parentSessionId)
    if (!done) throw new Error(`no wake runs for ${parentSessionId}`)
    running.delete(parentSessionId)
    done(outcome)
  }
  const finishAll = (outcome: HiveParentWakeOutcome) => {
    for (const parentSessionId of [...running.keys()]) finish(parentSessionId, outcome)
  }
  return { scheduler, started, finish, finishAll, full }
}

describe('Hive wake scheduler', () => {
  it('runs one wake per parent at a time, and a request that arrived meanwhile after it', () => {
    const { scheduler, started, finish } = harness()

    scheduler.request({ parentSessionId: 'queen' })
    scheduler.request({ parentSessionId: 'queen' })
    scheduler.request({ parentSessionId: 'queen' })
    expect(started).toEqual(['queen'])

    finish('queen', 'not-needed')
    expect(started).toEqual(['queen', 'queen'])
    finish('queen', 'not-needed')
    expect(started).toEqual(['queen', 'queen'])
  })

  it('retries a parent a full Run limit deferred when another Session asks', () => {
    const { scheduler, started, finish } = harness()

    scheduler.request({ parentSessionId: 'queen' })
    finish('queen', 'deferred')
    scheduler.request({ parentSessionId: 'other' })
    expect(started).toEqual(['queen', 'other', 'queen'])

    finish('queen', 'started')
    finish('other', 'not-needed')
    scheduler.request({ parentSessionId: 'third' })
    expect(started).toEqual(['queen', 'other', 'queen', 'third'])
  })

  it('keeps a deferred parent after a failed retry, and says when too many wait', () => {
    const { scheduler, started, finishAll, full } = harness()
    for (let index = 0; index < MAX_DEFERRED_PARENTS; index++) {
      scheduler.request({ parentSessionId: `queen-${index}` })
      finishAll('deferred')
    }
    started.length = 0

    scheduler.request({ parentSessionId: 'overflow' })
    finishAll('deferred')

    expect(full).toEqual(['overflow'])
    // Every held-back parent was retried, and none was forgotten when its retry deferred again.
    expect(started).toHaveLength(MAX_DEFERRED_PARENTS + 1)
    started.length = 0
    scheduler.request({ parentSessionId: 'queen-0' })
    expect(started).toHaveLength(MAX_DEFERRED_PARENTS)
  })
})
