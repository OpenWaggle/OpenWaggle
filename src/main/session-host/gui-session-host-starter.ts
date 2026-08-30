import type * as Effect from 'effect/Effect'
import type { AppServices } from '../runtime'
import type { AppDatabaseAccess } from '../services/database-service'
import { ensureLocalSessionHost } from './local-session-host-launcher'
import type { LocalSessionHostRuntime } from './local-session-host-runtime'
import type { LocalSessionHostPaths } from './local-session-paths'

export type AppEffectRunner = <A, E>(effect: Effect.Effect<A, E, AppServices>) => Promise<A>

export interface StartGuiSessionHostInput {
  readonly runEffect: AppEffectRunner
  readonly startOwnedServices: () => Promise<void>
  readonly stopOwnedServices: () => Promise<void>
}

export class SessionHostDrainedDuringStartupError extends Error {}

function markSessionHostListening(
  startupMark: (label: string) => void,
  mode: 'attached' | 'owned',
) {
  startupMark('session-host-listening')
  return mode
}

interface GuiRemoteClient {
  readonly paths: LocalSessionHostPaths
  readonly clientVersion: string
  readonly supportedRevisions: readonly number[]
}

async function attachIsolatedGuiToAuthoritativeHost(input: {
  readonly databaseAccess: AppDatabaseAccess
  readonly remoteClient: GuiRemoteClient
  readonly attach: () => Promise<boolean>
}) {
  if (input.databaseAccess !== 'client-isolated') return false
  await ensureLocalSessionHost({
    ...input.remoteClient,
    clientKind: 'gui',
  })
  return input.attach()
}

export function createGuiSessionHostStarter(input: {
  readonly databaseAccess: AppDatabaseAccess
  readonly remoteClient: GuiRemoteClient
  readonly startupMark: (label: string) => void
  readonly requestShutdownForHandoff?: () => void
  readonly configureOwnedServices: (start: () => Promise<void>, stop: () => Promise<void>) => void
  readonly attachToExistingHost: () => Promise<boolean>
  readonly startOwnedRuntime: (runEffect: AppEffectRunner) => Promise<LocalSessionHostRuntime>
  readonly installOwnedRuntime: (
    runtime: LocalSessionHostRuntime,
    runEffect: AppEffectRunner,
  ) => void
  readonly setStopping: (stopping: boolean) => void
  readonly isStopping: () => boolean
  readonly stopFailedRuntime: () => Promise<void>
}) {
  return async ({ runEffect, startOwnedServices, stopOwnedServices }: StartGuiSessionHostInput) => {
    input.setStopping(false)
    input.configureOwnedServices(startOwnedServices, stopOwnedServices)
    if (await input.attachToExistingHost()) {
      return markSessionHostListening(input.startupMark, 'attached')
    }
    if (
      await attachIsolatedGuiToAuthoritativeHost({
        databaseAccess: input.databaseAccess,
        remoteClient: input.remoteClient,
        attach: input.attachToExistingHost,
      })
    ) {
      return markSessionHostListening(input.startupMark, 'attached')
    }
    if (input.databaseAccess === 'client-isolated') {
      throw new Error('The isolated GUI could not attach to an authoritative Session Host.')
    }
    while (!input.isStopping()) {
      try {
        const ownedRuntime = await input.startOwnedRuntime(runEffect)
        input.installOwnedRuntime(ownedRuntime, runEffect)
        return markSessionHostListening(input.startupMark, 'owned')
      } catch (error) {
        await input.stopFailedRuntime()
        if (!(error instanceof SessionHostDrainedDuringStartupError)) throw error
        input.requestShutdownForHandoff?.()
        throw new Error('GUI Session Host retired during startup for a version handoff.', {
          cause: error,
        })
      }
    }
    throw new Error('GUI Session Host startup was stopped.')
  }
}
