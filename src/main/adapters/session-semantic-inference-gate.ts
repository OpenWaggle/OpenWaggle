const DEFAULT_MAX_CONCURRENT_QUERY_INFERENCES = 2
const DEFAULT_MAX_QUEUED_QUERY_INFERENCES = 32

interface PendingInference {
  readonly signal?: AbortSignal
  readonly task: () => Promise<void>
  readonly reject: (cause: unknown) => void
  started: boolean
  settled: boolean
  abortListener?: () => void
}

function cancellationError(signal?: AbortSignal) {
  const reason: unknown = signal?.reason
  if (reason instanceof Error) return reason
  const error = new Error('Semantic inference was cancelled.')
  error.name = 'AbortError'
  return error
}

/**
 * Keeps non-cancellable ONNX work inside a hard concurrency envelope. Cancelling
 * a caller removes queued work immediately; already-started inference retains
 * its slot until the underlying promise settles, so abandoned work cannot make
 * room for an unbounded number of replacement requests.
 */
export class SessionSemanticInferenceGate {
  readonly #queue: PendingInference[] = []
  #active = 0

  constructor(
    private readonly maxConcurrent = DEFAULT_MAX_CONCURRENT_QUERY_INFERENCES,
    private readonly maxQueued = DEFAULT_MAX_QUEUED_QUERY_INFERENCES,
  ) {
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent <= 0) {
      throw new Error('Semantic inference concurrency must be a positive safe integer.')
    }
    if (!Number.isSafeInteger(maxQueued) || maxQueued < 0) {
      throw new Error('Semantic inference queue capacity must be a non-negative safe integer.')
    }
  }

  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(cancellationError(signal))
    if (this.#active >= this.maxConcurrent && this.#queue.length >= this.maxQueued) {
      return Promise.reject(new Error('Semantic inference capacity is temporarily exhausted.'))
    }
    return new Promise<T>((resolve, reject) => {
      const pending: PendingInference = {
        task: async () => {
          const value = await task()
          if (pending.settled) return
          pending.settled = true
          resolve(value)
        },
        reject,
        ...(signal ? { signal } : {}),
        started: false,
        settled: false,
      }
      const abort = () => this.#abort(pending)
      pending.abortListener = abort
      signal?.addEventListener('abort', abort, { once: true })
      this.#queue.push(pending)
      this.#pump()
    })
  }

  #abort(pending: PendingInference) {
    if (pending.settled) return
    pending.settled = true
    pending.reject(cancellationError(pending.signal))
    if (!pending.started) {
      const index = this.#queue.indexOf(pending)
      if (index >= 0) this.#queue.splice(index, 1)
      if (pending.abortListener) pending.signal?.removeEventListener('abort', pending.abortListener)
    }
  }

  #pump() {
    while (this.#active < this.maxConcurrent) {
      const pending = this.#queue.shift()
      if (!pending) return
      if (pending.settled) continue
      pending.started = true
      this.#active += 1
      void pending
        .task()
        .catch((cause: unknown) => {
          if (pending.settled) return
          pending.settled = true
          pending.reject(cause)
        })
        .finally(() => {
          if (pending.abortListener)
            pending.signal?.removeEventListener('abort', pending.abortListener)
          this.#active -= 1
          this.#pump()
        })
    }
  }
}

export const sessionSemanticQueryInferenceGate = new SessionSemanticInferenceGate()
