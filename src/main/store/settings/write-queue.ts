import * as SqlClient from '@effect/sql/SqlClient'
import * as Effect from 'effect/Effect'
import { createLogger } from '../../logger'
import { runStoreEffect } from '../store-runtime'
import type { SettingsPatchWrite } from './persistence-plan'

const logger = createLogger('settings')

let writeQueue: Promise<void> = Promise.resolve()

export function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Serializes one operation onto the store write queue. The queue always continues after a
 * rejection; the returned promise still rejects so the caller can handle its own failure.
 */
export function chainWriteQueue<T>(operation: () => Promise<T>): Promise<T> {
  const pending = writeQueue.then(operation)
  writeQueue = pending.then(
    () => undefined,
    () => undefined,
  )
  return pending
}

export function enqueueSettingsWrite<T>(
  operation: () => Promise<T>,
  description: string,
): Promise<T> {
  const pending = chainWriteQueue(operation)
  void pending.catch((error: unknown) => {
    logger.warn('Failed to write setting to SQLite', {
      setting: description,
      error: describeError(error),
    })
  })
  return pending
}

/** Resolves once every write queued so far has settled. Test and shutdown plumbing only. */
export function flushWriteQueue(): Promise<void> {
  return writeQueue
}

export async function writeStoredSettingsToDb(writes: readonly SettingsPatchWrite[]) {
  await runStoreEffect(
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql.withTransaction(
        Effect.forEach(
          writes,
          (write) => sql`
            INSERT INTO settings_store (key, value_json, updated_at)
            VALUES (${write.key}, ${JSON.stringify(write.value)}, ${Date.now()})
            ON CONFLICT(key) DO UPDATE SET
              value_json = excluded.value_json,
              updated_at = excluded.updated_at
          `,
          { discard: true },
        ),
      )
    }),
  )
}

export function queueStoredSettingWrite(key: string, value: unknown) {
  return enqueueSettingsWrite(() => writeStoredSettingsToDb([{ key, value }]), key)
}
