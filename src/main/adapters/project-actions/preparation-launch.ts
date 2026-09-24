import type { ActionProcess, ActionProcessLaunch, ActionProcessRunner } from './action-process'
import type { createPreparationProcessOwnership } from './preparation-process-ownership'

interface PendingLaunch {
  readonly abort: (reason: unknown) => void
  readonly settled: Promise<ActionProcess>
}

/** A canceled setup can settle before native launch does; any late child is stopped on arrival. */
export function createPreparationLaunches(
  runner: ActionProcessRunner,
  ownership: ReturnType<typeof createPreparationProcessOwnership>,
) {
  const pending = new Set<PendingLaunch>()
  return {
    start: async (input: ActionProcessLaunch) => {
      const controller = new AbortController()
      const canceled = Promise.withResolvers<never>()
      const abort = (reason: unknown) => {
        if (controller.signal.aborted) return
        const error = reason ?? new Error('Action launch canceled.')
        controller.abort(error)
        canceled.reject(error)
      }
      const onAbort = () => abort(input.signal?.reason)
      input.signal?.addEventListener('abort', onAbort, { once: true })
      if (input.signal?.aborted) onAbort()
      const launch = Promise.resolve().then(() => {
        controller.signal.throwIfAborted()
        return runner.start({ ...input, signal: controller.signal })
      })
      const settled = Promise.race([launch, canceled.promise])
      const entry = { abort, settled }
      pending.add(entry)
      try {
        const child = await settled
        ownership.add(child, input.onOutput)
        return child
      } catch (error) {
        if (controller.signal.aborted) {
          // A native load may ignore cancellation until it returns a process. Do not await it here.
          void launch
            .then(async (late) => {
              ownership.add(late, input.onOutput)
              await ownership.stop(late)
            })
            .catch(() => {})
        }
        throw error
      } finally {
        pending.delete(entry)
        input.signal?.removeEventListener('abort', onAbort)
      }
    },
    shutdown: async () => {
      const active = [...pending]
      for (const entry of active) entry.abort(new Error('The Session Host is stopping.'))
      await Promise.allSettled(active.map((entry) => entry.settled))
    },
  }
}
