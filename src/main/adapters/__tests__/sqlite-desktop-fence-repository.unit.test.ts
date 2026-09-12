import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { DESKTOP_SERVICE_LIMITS, type DesktopFenceRecord } from '@shared/types/desktop-service'
import { Effect, Layer, ManagedRuntime } from 'effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DesktopFenceRepository } from '../../ports/desktop-fence-repository'
import { DESKTOP_FENCE_MIGRATION } from '../../services/desktop-fence-migration'
import { SqliteDesktopFenceRepositoryLive } from '../sqlite-desktop-fence-repository'

function record(token = 'fence-1'): DesktopFenceRecord & { readonly state: 'active' } {
  return {
    token,
    hostInstanceId: 'host-1',
    scope: { kind: 'owner', ownerKey: 'session:one' },
    state: 'active',
  }
}

function makeRuntime(filename: string) {
  const sql = SqliteClient.layer({ filename })
  const initialization = Layer.effectDiscard(
    Effect.gen(function* () {
      const database = yield* SqlClient.SqlClient
      for (const statement of DESKTOP_FENCE_MIGRATION.statements) yield* database.unsafe(statement)
    }),
  ).pipe(Layer.provide(sql))
  return ManagedRuntime.make(
    SqliteDesktopFenceRepositoryLive.pipe(
      Layer.provideMerge(initialization),
      Layer.provideMerge(sql),
    ),
  )
}

describe('durable desktop mutation fences', () => {
  let temporaryRoot = ''
  const runtimes: ReturnType<typeof makeRuntime>[] = []
  function runtime() {
    const created = makeRuntime(path.join(temporaryRoot, 'fences.sqlite'))
    runtimes.push(created)
    return created
  }
  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-desktop-fences-'))
  })
  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((active) => active.dispose()))
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('preserves active scopes and released tombstones across process reconnection', async () => {
    const first = runtime()
    await first.runPromise(
      Effect.gen(function* () {
        const repository = yield* DesktopFenceRepository
        yield* repository.insert(record())
        yield* repository.insert({
          ...record('path-fence'),
          scope: { kind: 'path', directoryPath: '/project/worktree' },
        })
        yield* repository.markReleased('path-fence', 'host-1')
      }),
    )
    await first.dispose()
    const reopened = runtime()
    expect(
      await reopened.runPromise(
        Effect.gen(function* () {
          const repository = yield* DesktopFenceRepository
          return yield* repository.getAll()
        }),
      ),
    ).toEqual([
      record(),
      {
        ...record('path-fence'),
        scope: { kind: 'path', directoryPath: '/project/worktree' },
        state: 'released',
      },
    ])
  })

  it('rejects deletion of active fences and mismatched owners without losing the journal', async () => {
    await runtime().runPromise(
      Effect.gen(function* () {
        const repository = yield* DesktopFenceRepository
        yield* repository.insert(record())
        expect((yield* Effect.either(repository.removeReleased('fence-1', 'host-1')))._tag).toBe(
          'Left',
        )
        expect((yield* Effect.either(repository.markReleased('fence-1', 'other-host')))._tag).toBe(
          'Left',
        )
        expect((yield* Effect.either(repository.markReleased('missing', 'host-1')))._tag).toBe(
          'Left',
        )
        expect(yield* repository.getAll()).toEqual([record()])
        yield* repository.markReleased('fence-1', 'host-1')
        yield* repository.markReleased('fence-1', 'host-1')
        expect(
          (yield* Effect.either(repository.removeReleased('fence-1', 'other-host')))._tag,
        ).toBe('Left')
        yield* repository.removeReleased('fence-1', 'host-1')
        yield* repository.removeReleased('fence-1', 'host-1')
        expect(yield* repository.getAll()).toEqual([])
      }),
    )
  })

  it('never replaces an existing token, even with the same owner', async () => {
    await runtime().runPromise(
      Effect.gen(function* () {
        const repository = yield* DesktopFenceRepository
        yield* repository.insert(record())
        expect((yield* Effect.either(repository.insert(record())))._tag).toBe('Left')
        expect(
          yield* Effect.either(repository.insert({ ...record(), hostInstanceId: 'other' })),
        ).toMatchObject({ _tag: 'Left' })
        expect(yield* repository.getAll()).toEqual([record()])
      }),
    )
  })

  it('bounds admission including released records and reclaims space only after acknowledgement', async () => {
    await runtime().runPromise(
      Effect.gen(function* () {
        const repository = yield* DesktopFenceRepository
        for (let index = 0; index < DESKTOP_SERVICE_LIMITS.fenceRecords; index += 1)
          yield* repository.insert(record(`fence-${index}`))
        yield* repository.markReleased('fence-0', 'host-1')
        expect((yield* Effect.either(repository.insert(record('overflow'))))._tag).toBe('Left')
        expect(yield* repository.getAll()).toHaveLength(DESKTOP_SERVICE_LIMITS.fenceRecords)
        yield* repository.removeReleased('fence-0', 'host-1')
        yield* repository.insert(record('replacement'))
        expect(yield* repository.getAll()).toHaveLength(DESKTOP_SERVICE_LIMITS.fenceRecords)
      }),
    )
  })
})
