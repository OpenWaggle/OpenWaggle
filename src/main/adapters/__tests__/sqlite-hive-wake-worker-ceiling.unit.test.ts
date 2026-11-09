import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { RunId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { newRunAdmissionRefusal } from '../sqlite-session-control-queue-delivery'
import { loadSessionControlState } from '../sqlite-session-control-state'
import { makeSessionControlTestLayer } from './sqlite-session-control-test-layer'
import {
  makeTargetAWorker,
  seedFirstRun,
  seedHive,
} from './sqlite-worker-run-admission.test-support'

let temporaryRoot = ''

/**
 * The capacity step of a Hive wake's in-transaction check (`hiveWakeRefusal`): `session-target`
 * starting a wake Run for the person, with every Worker slot of a ceiling of 2 taken.
 */
function wakeRefusal(targetIsWorker: boolean) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* seedHive(sql, 2)
    // The Queen's first Run was the person's, as a Queen's always is before any wake.
    yield* seedFirstRun(sql, 'gui:local-user')
    if (targetIsWorker) yield* makeTargetAWorker(sql)
    const idle = yield* loadSessionControlState(sql, 'session-target')
    const waking = {
      ...idle,
      run: {
        state: 'starting' as const,
        runId: RunId('run-wake'),
        intent: {
          text: 'Worker updates arrived while this Session was idle.',
          attachmentIds: [],
          callerId: 'gui:local-user',
          acceptedAt: 1,
          idempotencyKey: 'hive-wake:session-target:1',
          hiveWake: true as const,
        },
      },
    }
    return yield* newRunAdmissionRefusal(sql, waking, 2)
  })
}

describe('Hive wake and the Worker ceiling', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-wake-ceiling-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('wakes a root Queen the person made while every Worker slot is taken', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'root-queen.sqlite'))
    const refusal = await Effect.runPromise(wakeRefusal(false).pipe(Effect.provide(layer)))

    expect(refusal).toBeUndefined()
  })

  it('holds a nested Queen’s wake to the Worker ceiling, though it acts for the person', async () => {
    const layer = makeSessionControlTestLayer(path.join(temporaryRoot, 'nested-queen.sqlite'))
    const refusal = await Effect.runPromise(wakeRefusal(true).pipe(Effect.provide(layer)))

    expect(refusal).toBe('host_run_ceiling_reached')
  })
})
