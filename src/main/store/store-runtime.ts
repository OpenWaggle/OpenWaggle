import type * as SqlClient from '@effect/sql/SqlClient'
import type { Effect as EffectType } from 'effect/Effect'

type StoreEffectRunner = <A, E>(effect: EffectType<A, E, SqlClient.SqlClient>) => Promise<A>

let storeEffectRunner: StoreEffectRunner | null = null

export function setStoreEffectRunner(runner: StoreEffectRunner): void {
  storeEffectRunner = runner
}

export function runStoreEffect<A, E>(effect: EffectType<A, E, SqlClient.SqlClient>): Promise<A> {
  if (storeEffectRunner === null) {
    throw new Error('Store Effect runner has not been initialized')
  }

  return storeEffectRunner(effect)
}
