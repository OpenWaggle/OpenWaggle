import * as Effect from 'effect/Effect'
import { SESSION_SEMANTIC_DISCOVERY_STORAGE_POLICY } from '../domain/session-semantic-discovery-storage-policy'
import { SessionFlatVectorIndex, type SessionVectorRecord } from './session-flat-vector-index'

function cancellableCooperativeScan<A>(scan: (signal: AbortSignal) => Promise<A>) {
  return Effect.async<A>((resume) => {
    const controller = new AbortController()
    const promise = scan(controller.signal)
    void promise.then(
      (value) => resume(Effect.succeed(value)),
      (cause) => resume(Effect.die(cause)),
    )
    return Effect.promise(async () => {
      controller.abort()
      await promise.catch(() => undefined)
    })
  })
}

export interface SemanticIndexRefresh {
  readonly revision: number
  readonly rebuild: boolean
  readonly records: readonly SessionVectorRecord[]
  readonly deletedSessionIds: readonly string[]
}

export class SessionSemanticIndexSnapshotCache {
  readonly #refreshLock = Effect.runSync(Effect.makeSemaphore(1))
  readonly #index: SessionFlatVectorIndex
  #loadedRevision = -1

  constructor(maximumRecordCount: number = SESSION_SEMANTIC_DISCOVERY_STORAGE_POLICY.recordLimit) {
    this.#index = new SessionFlatVectorIndex(maximumRecordCount)
  }

  search<Error, Requirements>(input: {
    readonly minimumRevision: number
    readonly refresh: (
      afterRevision: number,
    ) => Effect.Effect<SemanticIndexRefresh, Error, Requirements>
    readonly acknowledge?: (revision: number) => Effect.Effect<void, Error, Requirements>
    readonly query: Float32Array
    readonly limit: number
    readonly allowedSessionIds?: ReadonlySet<string>
    readonly excludedSessionIds?: ReadonlySet<string>
  }): Effect.Effect<
    { readonly revision: number; readonly matches: ReturnType<SessionFlatVectorIndex['search']> },
    Error,
    Requirements
  > {
    return this.#refreshLock.withPermits(1)(
      Effect.gen(this, function* () {
        if (input.minimumRevision > this.#loadedRevision) {
          const refresh = yield* input.refresh(this.#loadedRevision)
          if (refresh.revision > this.#loadedRevision) {
            if (refresh.rebuild) this.#index.replace(refresh.records)
            else {
              for (const sessionId of refresh.deletedSessionIds) this.#index.remove(sessionId)
              for (const record of refresh.records) this.#index.upsert(record)
            }
            if (input.acknowledge) yield* input.acknowledge(refresh.revision)
            this.#loadedRevision = refresh.revision
          }
        }
        const matches = yield* cancellableCooperativeScan((signal) =>
          this.#index.searchCooperatively({
            query: input.query,
            limit: input.limit,
            ...(input.allowedSessionIds ? { allowedSessionIds: input.allowedSessionIds } : {}),
            ...(input.excludedSessionIds ? { excludedSessionIds: input.excludedSessionIds } : {}),
            signal,
          }),
        )
        return {
          revision: this.#loadedRevision,
          matches,
        }
      }),
    )
  }

  diagnostics() {
    return { loadedRevision: this.#loadedRevision, recordCount: this.#index.size }
  }
}
