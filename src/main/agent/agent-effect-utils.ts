import * as Effect from 'effect/Effect'
import { AgentCancelledError } from '../errors'

export function isRetryableStallReason(
  stallReason: 'stream-stall' | 'incomplete-tool-args' | 'awaiting-tool-result' | null,
): stallReason is 'stream-stall' | 'incomplete-tool-args' {
  return stallReason === 'stream-stall' || stallReason === 'incomplete-tool-args'
}

export function withStageTimingEffect<T, E, R>(
  stageDurationsMs: Record<string, number>,
  stageName: string,
  effect: Effect.Effect<T, E, R>,
): Effect.Effect<T, E, R> {
  const start = Date.now()
  return effect.pipe(
    Effect.ensuring(
      Effect.sync(() => {
        stageDurationsMs[stageName] = Date.now() - start
      }),
    ),
  )
}

export function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'AbortError') return true
  return error.message.trim().toLowerCase() === 'aborted'
}

export function isAgentCancelledCause(error: unknown): boolean {
  return error instanceof AgentCancelledError || isAbortError(error)
}

export function toEffectError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function withAbortBridge<A, E, R>(
  signal: AbortSignal,
  use: (abortController: AbortController) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const abortController = new AbortController()
      const onAbort = (): void => {
        abortController.abort()
      }

      signal.addEventListener('abort', onAbort, { once: true })
      return { abortController, onAbort }
    }),
    (state) => use(state.abortController),
    ({ abortController, onAbort }) =>
      Effect.sync(() => {
        signal.removeEventListener('abort', onAbort)
        abortController.abort()
      }),
  )
}
