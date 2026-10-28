import { awaitWithSignal } from './await-with-signal'
import type { LocalSessionClientConnectionInput } from './local-session-client-connection'
import {
  defaultLocalSessionHostLauncherDependencies,
  HOST_TAKEOVER_TIMEOUT_MS,
  type LocalSessionHostLauncherDependencies,
} from './local-session-host-launcher'
import { waitForCondition } from './local-session-host-polling'
import type { SessionHostPrelaunch } from './session-host-prelaunch-handoff'

/**
 * Waits for the Host the boot shim launched (`boot/session-host-prelaunch.ts`) to answer, the way
 * a client waits for a Host it launched itself. Resolves false, so the caller starts the Host the
 * usual way, once that process has ended without answering: another Host owned the profile, or it
 * failed to start.
 */
export async function waitForPrelaunchedLocalSessionHost(
  input: LocalSessionClientConnectionInput & {
    readonly prelaunch: Pick<SessionHostPrelaunch, 'hasEnded'>
    readonly timeoutMs?: number
  },
  dependencies: LocalSessionHostLauncherDependencies = defaultLocalSessionHostLauncherDependencies,
) {
  let answered = false
  await waitForCondition({
    timeoutMs: input.timeoutMs ?? HOST_TAKEOVER_TIMEOUT_MS,
    dependencies,
    signal: input.signal,
    condition: async () => {
      if (input.prelaunch.hasEnded()) return true
      const paths = await awaitWithSignal(dependencies.refreshPaths(input.paths), input.signal)
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
        return false
      }
    },
  })
  return answered
}
