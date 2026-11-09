import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import {
  makeSessionLifecycleTestLayer,
  rootLifecycleInput,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

let temporaryRoot = ''

/*
 * The Host's run ceiling limits Worker Runs only (ADR 0030, amended 2026-11-09): a launched root
 * never meets it, and a spawn counts only the Worker Runs already active.
 */
describe('SQLite Session lifecycle and the Worker ceiling', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-lifecycle-ceiling-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('launches an independent root whatever the Worker ceiling', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'launch-ceiling.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionLifecycleRepository
        // The parent's active Run would fill a ceiling of 1 if root Runs counted.
        const response = yield* repository.execute({
          ...rootLifecycleInput('launch'),
          hostRunCeiling: 1,
        })
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM sessions WHERE id = ${'session-launch'}
        `
        return { response, sessionCount: rows[0]?.count }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.response.outcome).toMatchObject({
      operation: 'launch',
      effect: 'launched-root',
    })
    expect(result.sessionCount).toBe(1)
  })

  it('launches concurrent roots past the Worker ceiling', async () => {
    const layer = makeSessionLifecycleTestLayer(
      path.join(temporaryRoot, 'launch-ceiling-race.sqlite'),
    )
    const responses = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionLifecycleRepository
        const first = rootLifecycleInput('launch')
        const second = {
          ...first,
          request: {
            ...first.request,
            requestId: 'request-launch-second',
            idempotencyKey: 'idempotency-launch-second',
          },
          session: {
            sessionId: 'session-launch-second',
            piSessionId: 'pi-launch-second',
            piSessionFile: '/sessions/launch-second.jsonl',
          },
          runId: 'run-launch-second',
        }
        return yield* Effect.all(
          [
            repository.execute({ ...first, hostRunCeiling: 1 }),
            repository.execute({ ...second, hostRunCeiling: 1 }),
          ],
          { concurrency: 'unbounded' },
        )
      }).pipe(Effect.provide(layer)),
    )

    expect(responses.map((response) => response.outcome.effect)).toEqual([
      'launched-root',
      'launched-root',
    ])
  })

  it('refuses a spawn at the Worker ceiling, counting Worker Runs only', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'spawn-ceiling.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const repository = yield* SessionLifecycleRepository
        // Only the parent, a root, is active: a ceiling of 1 still has its slot.
        const admitted = yield* repository.execute({ ...spawnLifecycleInput(), hostRunCeiling: 1 })
        const second = spawnLifecycleInput(4, 'A second Worker.')
        const refused = yield* repository.execute({
          ...second,
          request: {
            ...second.request,
            requestId: 'request-spawn-second',
            idempotencyKey: 'idempotency-spawn-second',
          },
          session: {
            sessionId: 'session-worker-second',
            piSessionId: 'pi-worker-second',
            piSessionFile: '/sessions/worker-second.jsonl',
          },
          runId: 'run-worker-second',
          delegationId: 'delegation-worker-second',
          derivedGrantId: 'grant-worker-second',
          hostRunCeiling: 1,
        })
        const children = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM sessions WHERE id = ${'session-worker-second'}
        `
        return { admitted, refused, secondChildCount: children[0]?.count }
      }).pipe(Effect.provide(layer)),
    )

    expect(result.admitted.outcome).toMatchObject({ effect: 'spawned-worker' })
    expect(result.refused.outcome).toMatchObject({
      effect: 'rejected',
      code: 'host_capacity_reached',
      hostRunCeiling: 1,
      hostActiveRuns: 1,
    })
    expect(result.secondChildCount).toBe(0)
  })
})
