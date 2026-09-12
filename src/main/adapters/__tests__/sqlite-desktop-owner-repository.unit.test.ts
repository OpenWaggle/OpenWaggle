import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { DesktopOwnerRepository } from '../../ports/desktop-owner-repository'
import { DESKTOP_FENCE_MIGRATION } from '../../services/desktop-fence-migration'
import { SqliteDesktopOwnerRepositoryLive } from '../sqlite-desktop-owner-repository'

function withRepository<A, E>(operation: Effect.Effect<A, E, DesktopOwnerRepository>) {
  const sql = SqliteClient.layer({ filename: ':memory:' })
  const schema = Layer.effectDiscard(
    Effect.gen(function* () {
      const database = yield* SqlClient.SqlClient
      for (const statement of DESKTOP_FENCE_MIGRATION.statements) yield* database.unsafe(statement)
    }),
  ).pipe(Layer.provide(sql))
  return Effect.runPromise(
    operation.pipe(
      Effect.provide(
        SqliteDesktopOwnerRepositoryLive.pipe(Layer.provide(schema), Layer.provide(sql)),
      ),
    ),
  )
}

describe('durable desktop owner cleanup receipt', () => {
  it('distinguishes never adopted, active, and explicitly cleaned native ownership', async () => {
    await withRepository(
      Effect.gen(function* () {
        const repository = yield* DesktopOwnerRepository
        expect(yield* repository.get()).toBeNull()
        yield* repository.activate({ guiInstanceId: 'gui-1', hostInstanceId: 'host-1' })
        expect(yield* repository.get()).toEqual({
          guiInstanceId: 'gui-1',
          hostInstanceId: 'host-1',
          state: 'active',
        })
        yield* repository.markClosed('gui-1', 'host-1')
        yield* repository.markClosed('gui-1', 'host-1')
        expect(yield* repository.get()).toEqual({
          guiInstanceId: 'gui-1',
          hostInstanceId: 'host-1',
          state: 'closed',
        })
        yield* repository.activate({ guiInstanceId: 'gui-2', hostInstanceId: 'host-1' })
        expect(yield* repository.get()).toEqual({
          guiInstanceId: 'gui-2',
          hostInstanceId: 'host-1',
          state: 'active',
        })
      }),
    )
  })

  it('rejects stale clean receipts and a competing GUI without erasing active ownership', async () => {
    await withRepository(
      Effect.gen(function* () {
        const repository = yield* DesktopOwnerRepository
        expect((yield* Effect.either(repository.markClosed('missing', 'missing')))._tag).toBe(
          'Left',
        )
        yield* repository.activate({ guiInstanceId: 'gui-1', hostInstanceId: 'host-1' })
        yield* repository.activate({ guiInstanceId: 'gui-1', hostInstanceId: 'host-2' })
        expect((yield* Effect.either(repository.markClosed('gui-1', 'host-1')))._tag).toBe('Left')
        expect((yield* Effect.either(repository.markClosed('gui-2', 'host-2')))._tag).toBe('Left')
        expect(
          yield* Effect.either(
            repository.activate({ guiInstanceId: 'gui-2', hostInstanceId: 'host-2' }),
          ),
        ).toMatchObject({ _tag: 'Left' })
        expect(yield* repository.get()).toEqual({
          guiInstanceId: 'gui-1',
          hostInstanceId: 'host-2',
          state: 'active',
        })
      }),
    )
  })
})
