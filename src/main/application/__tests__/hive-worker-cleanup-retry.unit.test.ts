import * as SqlClient from '@effect/sql/SqlClient'
import { SessionId } from '@shared/types/brand'
import type { DesktopServiceCommand } from '@shared/types/desktop-service'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { seedHiveWorker } from '../../adapters/__tests__/hive-worker-cleanup-fixture'
import { DesktopServiceBroker } from '../../ports/desktop-service-broker'
import { HiveWorkerCleanup } from '../../ports/hive-worker-cleanup'
import { makeHiveWorkerCleanupLayer } from '../hive-worker-cleanup-layer'
import {
  archivedState,
  useHiveCleanupServiceContext,
} from './hive-worker-cleanup-service.test-harness'

const RETRY_DELAY_MS = 20
const SETTLE_TIMEOUT_MS = 2_000

/** A desktop whose renderer holds the Worker's browser owner until `close` is called. */
function openInApp() {
  const state = { registered: true, inspections: 0 }
  const broker = fromPartial<DesktopServiceBroker['Type']>({
    execute: (command: DesktopServiceCommand) => {
      if (command.service === 'browser' && command.operation === 'inspectOwner') {
        state.inspections += 1
        return Effect.succeed({
          service: 'browser',
          operation: 'inspectOwner',
          value: { registered: state.registered, previews: 0 },
        })
      }
      if (command.service === 'browser' && command.operation === 'deleteOwner') {
        return Effect.succeed({ service: 'browser', operation: 'deleteOwner', value: null })
      }
      if (command.service === 'fence') {
        return Effect.succeed({ service: 'fence', operation: 'acquire', value: null })
      }
      return Effect.dieMessage('Unexpected desktop command in Hive cleanup retry test')
    },
  })
  return { state, broker }
}

function waitUntil<A, E, R>(effect: Effect.Effect<A, E, R>, done: (value: A) => boolean) {
  return Effect.gen(function* () {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS
    while (true) {
      const value = yield* effect
      if (done(value) || Date.now() > deadline) return value
      yield* Effect.sleep(RETRY_DELAY_MS / 2)
    }
  })
}

describe('Hive Worker cleanup retries after desktop state clears', () => {
  const service = useHiveCleanupServiceContext('openwaggle-hive-cleanup-retry-')

  it('archives a finished Worker once the app releases it, with no further trigger (#352)', async () => {
    const desktop = openInApp()
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* seedHiveWorker(sql)
        const cleanupLayer = makeHiveWorkerCleanupLayer('background', {
          retryDelaysMs: [RETRY_DELAY_MS],
        })
        return yield* Effect.gen(function* () {
          const cleanup = yield* HiveWorkerCleanup
          yield* cleanup.requestReconciliation(SessionId('queen'))
          const kept = yield* waitUntil(
            Effect.sync(() => desktop.state.inspections),
            (count) => count >= 2,
          )
          const keptArchived = yield* archivedState(sql, 'worker')
          // The user navigates away; the Host hears nothing about it.
          desktop.state.registered = false
          const archived = yield* waitUntil(archivedState(sql, 'worker'), (value) => value === 1)
          return { kept, keptArchived, archived }
        }).pipe(Effect.provide(cleanupLayer))
      }).pipe(
        Effect.provideService(DesktopServiceBroker, desktop.broker),
        Effect.provide(service.store('retry-open-in-app')),
      ),
    )

    expect(result.kept).toBeGreaterThanOrEqual(2)
    expect(result.keptArchived).toBe(0)
    expect(result.archived).toBe(1)
  })
})
