import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import {
  forkLifecycleInput,
  makeSessionLifecycleTestLayer,
  rootLifecycleInput,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

let temporaryRoot = ''

/** A launch by `callerId` of a root named `name`, with its own request and Run. */
function launchBy(callerId: string, name: string) {
  const base = rootLifecycleInput('launch')
  return {
    ...base,
    callerId,
    request: {
      ...base.request,
      requestId: `request-launch-${name}`,
      idempotencyKey: `idempotency-launch-${name}`,
    },
    session: {
      sessionId: `session-launch-${name}`,
      piSessionId: `pi-launch-${name}`,
      piSessionFile: `/sessions/launch-${name}.jsonl`,
    },
    runId: `run-launch-${name}`,
    hostRunCeiling: 1,
  }
}

/** A caller that is not the person: an MCP client holding a transient authority. */
const AGENT = 'transient-mcp:digest-agent'

/*
 * The Host's run ceiling limits what agents start (ADR 0030, amended 2026-11-09): the person's
 * launch never meets it, and a spawn or an agent's launch counts only agent-made Sessions' Runs.
 */
describe('SQLite Session lifecycle and the Worker ceiling', () => {
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-lifecycle-ceiling-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('launches the person’s root whatever the Worker ceiling', async () => {
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

  it('launches the person’s concurrent roots past the Worker ceiling', async () => {
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

  it('refuses an agent’s launch once agent-made Sessions fill the ceiling, not the person’s', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'agent-launch.sqlite'))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionLifecycleRepository
        const first = yield* repository.execute(launchBy(AGENT, 'agent-first'))
        const second = yield* repository.execute(launchBy(AGENT, 'agent-second'))
        const person = yield* repository.execute(launchBy('gui:local-user', 'person'))
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM sessions WHERE id = ${'session-launch-agent-second'}
        `
        return { first, second, person, secondSessions: rows[0]?.count }
      }).pipe(Effect.provide(layer)),
    )

    // The parent's root Run does not count; the agent's first launched root does.
    expect(result.first.outcome).toMatchObject({ effect: 'launched-root' })
    expect(result.second.outcome).toMatchObject({
      operation: 'launch',
      effect: 'rejected',
      code: 'host_run_ceiling_reached',
      hostRunCeiling: 1,
      hostActiveRuns: 1,
    })
    expect(result.secondSessions).toBe(0)
    expect(result.person.outcome).toMatchObject({ effect: 'launched-root' })
  })

  it('admits only one of two concurrent agent launches into the last Worker slot', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'agent-race.sqlite'))
    const responses = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionLifecycleRepository
        return yield* Effect.all(
          [
            repository.execute(launchBy(AGENT, 'race-a')),
            repository.execute(launchBy(AGENT, 'race-b')),
          ],
          { concurrency: 'unbounded' },
        )
      }).pipe(Effect.provide(layer)),
    )

    const effects = responses.map((response) => response.outcome.effect).sort()
    expect(effects).toEqual(['launched-root', 'rejected'])
  })

  it('records the roots an agent creates, launches or forks as agent-made, and none of the person’s', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(temporaryRoot, 'agent-origins.sqlite'))
    const origins = await Effect.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionLifecycleRepository
        const create = rootLifecycleInput('create')
        yield* repository.execute({ ...create, callerId: AGENT })
        yield* repository.execute({ ...forkLifecycleInput(), callerId: AGENT })
        yield* repository.execute(launchBy(AGENT, 'agent'))
        yield* repository.execute(launchBy('gui:local-user', 'person'))
        const sql = yield* SqlClient.SqlClient
        const rows = yield* sql<{ readonly session_id: string; readonly caller_id: string }>`
          SELECT session_id, caller_id FROM session_agent_origins ORDER BY session_id
        `
        return rows.map((row) => [row.session_id, row.caller_id])
      }).pipe(Effect.provide(layer)),
    )

    expect(origins).toEqual([
      ['session-create', AGENT],
      ['session-fork', AGENT],
      ['session-launch-agent', AGENT],
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
