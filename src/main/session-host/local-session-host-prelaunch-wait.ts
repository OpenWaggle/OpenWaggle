import { awaitWithSignal } from './await-with-signal'
import {
  type LocalSessionClientConnectionInput,
  LocalSessionHostUpgradePendingError,
} from './local-session-client-connection'
import {
  defaultLocalSessionHostLauncherDependencies,
  type LocalSessionHostLauncherDependencies,
} from './local-session-host-launcher'
import { waitForCondition } from './local-session-host-polling'
import type { LocalSessionHostPaths } from './local-session-paths'
import type { SessionHostPrelaunch } from './session-host-prelaunch-handoff'

/**
 * How long to wait for the Host the boot shim launched to answer: a little past the window's
 * startup deadline. A Host that is still not listening then is left to the usual path, which
 * waits for whichever Host holds the profile; one that listens but keeps refusing the window
 * ends the wait with its reason.
 */
export const PRELAUNCHED_HOST_ANSWER_TIMEOUT_MS = 30_000

/**
 * Waits for the Host the boot shim launched (`boot/session-host-prelaunch.ts`) to answer, the way
 * a client waits for a Host it launched itself. Resolves false, so the caller starts the Host the
 * usual way, once that process has ended without answering (another Host owned the profile, or it
 * failed to start), once it is handing over to an update (the usual path shows that), or when it
 * has not listened within the timeout. Rejects with the last refusal when it listened and kept
 * refusing the window until the timeout.
 */
function hasErrorCode(error: unknown, code: string) {
  return error instanceof Error && 'code' in error && error.code === code
}

/** The Host's endpoint once it has published one; a Windows Host may not have written it yet. */
async function publishedPaths(
  paths: LocalSessionHostPaths,
  dependencies: LocalSessionHostLauncherDependencies,
) {
  try {
    return await dependencies.refreshPaths(paths)
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT')) return null
    throw error
  }
}

export async function waitForPrelaunchedLocalSessionHost(
  input: LocalSessionClientConnectionInput & {
    readonly prelaunch: Pick<SessionHostPrelaunch, 'hasEnded'>
    readonly timeoutMs?: number
  },
  dependencies: LocalSessionHostLauncherDependencies = defaultLocalSessionHostLauncherDependencies,
) {
  let answered = false
  let handingOver = false
  let lastFailure: { readonly error: unknown } | undefined
  const settled = await waitForCondition({
    timeoutMs: input.timeoutMs ?? PRELAUNCHED_HOST_ANSWER_TIMEOUT_MS,
    dependencies,
    ...(input.signal ? { signal: input.signal } : {}),
    condition: async () => {
      if (input.prelaunch.hasEnded()) return true
      const paths = await awaitWithSignal(publishedPaths(input.paths, dependencies), input.signal)
      if (paths === null) return false
      if (
        !(await awaitWithSignal(
          dependencies.canConnect(paths.endpoint, input.signal),
          input.signal,
        ))
      ) {
        return false
      }
      try {
        await awaitWithSignal(dependencies.probe({ ...input, paths }), input.signal)
        answered = true
        return true
      } catch (error) {
        if (input.signal?.aborted) throw error
        if (error instanceof LocalSessionHostUpgradePendingError) {
          handingOver = true
          return true
        }
        // It may still be opening; kept, so a Host that never accepts the window says why.
        lastFailure = { error }
        return false
      }
    },
  })
  if (!settled && !handingOver && lastFailure) throw lastFailure.error
  return answered
}
