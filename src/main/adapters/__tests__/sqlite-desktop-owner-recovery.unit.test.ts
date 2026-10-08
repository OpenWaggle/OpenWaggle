import * as SqlClient from '@effect/sql/SqlClient'
import { SqliteClient } from '@effect/sql-sqlite-node'
import {
  decodeDesktopServiceRequest,
  decodeDesktopServiceResponse,
} from '@shared/schemas/desktop-service'
import type { DesktopServiceRequest } from '@shared/types/desktop-service'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { makeDesktopServiceBroker } from '../../application/desktop-service-broker'
import { DesktopFenceRepository } from '../../ports/desktop-fence-repository'
import { DesktopOwnerRepository } from '../../ports/desktop-owner-repository'
import { DESKTOP_FENCE_MIGRATION } from '../../services/desktop-fence-migration'
import { SqliteDesktopFenceRepositoryLive } from '../sqlite-desktop-fence-repository'
import { SqliteDesktopOwnerRepositoryLive } from '../sqlite-desktop-owner-repository'

const STALE_GUI = 'b0061e64-6211-4dfa-a079-fabd5bc67aea'
const NEW_GUI = '5f0c2b8e-7d1a-4c7e-9a43-0d6c1c9e2a11'

describe('desktop owner recovery over the SQLite journal and wire schemas', () => {
  it('turns the stale active row an unclean quit left behind into the new owner', async () => {
    const sql = SqliteClient.layer({ filename: ':memory:' })
    const schema = Layer.effectDiscard(
      Effect.gen(function* () {
        const database = yield* SqlClient.SqlClient
        for (const statement of DESKTOP_FENCE_MIGRATION.statements)
          yield* database.unsafe(statement)
        yield* database`INSERT INTO desktop_native_owner (singleton, gui_instance_id, host_instance_id, state)
          VALUES (1, ${STALE_GUI}, ${'host-old'}, ${'active'})`
      }),
    ).pipe(Layer.provide(sql))
    const repositories = Layer.mergeAll(
      SqliteDesktopOwnerRepositoryLive,
      SqliteDesktopFenceRepositoryLive,
    ).pipe(Layer.provide(schema), Layer.provide(sql))

    await Effect.runPromise(
      Effect.gen(function* () {
        const owners = yield* DesktopOwnerRepository
        const broker = makeDesktopServiceBroker({
          getHostInstanceId: () => 'host-new',
          fences: yield* DesktopFenceRepository,
          owners,
          offlineExecute: () => Effect.fail(new Error('No offline work expected.')),
        })
        // Every message crosses the exact wire schemas, as on the Local Session socket.
        const send = (request: DesktopServiceRequest) =>
          broker
            .handleGuiRequest(decodeDesktopServiceRequest(request))
            .pipe(Effect.map(decodeDesktopServiceResponse))
        try {
          expect(yield* send({ operation: 'register', guiInstanceId: NEW_GUI })).toEqual({
            operation: 'quarantined',
            reason: 'previous-owner-unclean',
          })
          const recovered = yield* send({ operation: 'recoverOwner', guiInstanceId: NEW_GUI })
          if (recovered.operation !== 'register') throw new Error('Expected registration')
          expect(yield* owners.get()).toEqual({
            guiInstanceId: NEW_GUI,
            hostInstanceId: 'host-new',
            state: 'active',
          })
          expect(
            yield* send({ operation: 'ready', leaseId: recovered.leaseId, fenceTokens: [] }),
          ).toEqual({ operation: 'ready', accepted: true })
        } finally {
          broker.close()
        }
      }).pipe(Effect.provide(repositories)),
    )
  })
})
