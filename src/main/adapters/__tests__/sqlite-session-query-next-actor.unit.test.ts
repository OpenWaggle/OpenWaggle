import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import type { HivePendingRequest } from '@shared/types/hive-next-actor'
import type { SessionQuery } from '@shared/types/session-query'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionQueryRepository } from '../../ports/session-query-repository'
import { makeSessionQueryRuntime } from './sqlite-session-query-test-layer'

/**
 * The contract the Hive tool, the CLI and MCP share: they all read through this repository, and
 * print its outcome as is, so `nextActor` here is what each of them returns (#380).
 */
describe('Session queries: nextActor on every summary and Delegation with a state', () => {
  let temporaryRoot = ''
  let runtime: ReturnType<typeof makeSessionQueryRuntime> | undefined

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-query-next-actor-'))
    runtime = makeSessionQueryRuntime(path.join(temporaryRoot, 'next-actor.sqlite'))
  })

  afterEach(async () => {
    await runtime?.dispose()
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  function query(
    request: SessionQuery,
    pendingRequests: ReadonlyMap<string, HivePendingRequest> | null = new Map(),
  ) {
    if (!runtime) throw new Error('runtime')
    return runtime.runPromise(
      Effect.gen(function* () {
        const repository = yield* SessionQueryRepository
        return yield* repository.execute({
          ...(pendingRequests === null ? {} : { pendingRequests }),
          request: { contractVersion: 2, requestId: 'next-actor', query: request },
        })
      }),
    )
  }

  function setWorker(state: string, cause: string | null, queenActive: boolean) {
    if (!runtime) throw new Error('runtime')
    return runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`
          UPDATE delegation_contracts SET state = ${state}, attention_cause = ${cause}
          WHERE id = ${'delegation-worker'}
        `
        yield* sql`
          UPDATE session_control_states SET active_run_id = ${queenActive ? 'run-queen' : null}
          WHERE session_id = ${'queen'}
        `
      }),
    )
  }

  async function nextActors(pendingRequests: ReadonlyMap<string, HivePendingRequest> = new Map()) {
    const list = await query({ operation: 'list', limit: 10 }, pendingRequests)
    const read = await query({ operation: 'read', sessionId: 'worker' }, pendingRequests)
    const delegations = await query({ operation: 'delegations-list', limit: 10 }, pendingRequests)
    const delegation = await query(
      { operation: 'delegations-read', delegationId: 'delegation-worker' },
      pendingRequests,
    )
    const listed = 'sessions' in list.outcome ? list.outcome.sessions : []
    return {
      list: Object.fromEntries(listed.map((s) => [s.sessionId, s.nextActor ?? 'absent'])),
      readSession: 'session' in read.outcome ? read.outcome.session.nextActor : 'absent',
      readDelegation: 'delegation' in read.outcome ? read.outcome.delegation?.nextActor : 'absent',
      delegationsList:
        'delegations' in delegations.outcome
          ? delegations.outcome.delegations.map((d) => d.nextActor)
          : [],
      delegationsRead:
        'delegation' in delegation.outcome && 'specifications' in delegation.outcome
          ? delegation.outcome.delegation.nextActor
          : 'absent',
    }
  }

  it('says the parent acts next on a Worker ready for review, and only Workers carry it', async () => {
    expect(await nextActors()).toEqual({
      // The Queen and an independent Session have no Delegation state, so no next actor.
      list: { queen: 'absent', worker: 'parent', other: 'absent' },
      readSession: 'parent',
      readDelegation: 'parent',
      delegationsList: ['parent'],
      delegationsRead: 'parent',
    })
  })

  it('routes a failed Run by the parent’s activity, and a parked approval to the user', async () => {
    await setWorker('needs_attention', 'run_failed', false)
    expect((await nextActors()).delegationsList).toEqual(['user'])
    await setWorker('needs_attention', 'run_failed', true)
    expect((await nextActors()).delegationsList).toEqual(['parent'])
    await setWorker('revision_requested', null, true)
    expect((await nextActors()).readSession).toBe('worker')
    expect(await nextActors(new Map([['worker', 'approval']]))).toMatchObject({
      readSession: 'user',
      delegationsRead: 'user',
    })
    await setWorker('accepted', null, false)
    expect((await nextActors()).readDelegation).toBe('none')
  })

  it('leaves outcomes alone for callers that do not ask for it', async () => {
    const read = await query({ operation: 'read', sessionId: 'worker' }, null)
    expect('session' in read.outcome && read.outcome.session).not.toHaveProperty('nextActor')
  })
})
