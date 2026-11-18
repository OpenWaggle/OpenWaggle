import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SessionDelegationRepository } from '../../ports/session-delegation-repository'
import { SessionLifecycleRepository } from '../../ports/session-lifecycle-repository'
import {
  makeSessionLifecycleTestLayer,
  spawnLifecycleInput,
} from './sqlite-session-lifecycle-test-support'

describe('SQLite Delegation repository: a Session’s Delegation state', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-delegation-state-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('answers the Delegation state of a Worker, and null for any other Session (review R5 P3-6)', async () => {
    const layer = makeSessionLifecycleTestLayer(path.join(root, 'delegation-state.db'))
    const states = await Effect.runPromise(
      Effect.gen(function* () {
        const lifecycle = yield* SessionLifecycleRepository
        const delegations = yield* SessionDelegationRepository
        yield* lifecycle.execute(spawnLifecycleInput())
        return {
          worker: yield* delegations.delegationStateOf('session-worker'),
          other: yield* delegations.delegationStateOf('session-without-delegation'),
        }
      }).pipe(Effect.provide(layer)),
    )

    expect(states).toEqual({ worker: 'working', other: null })
  })
})
