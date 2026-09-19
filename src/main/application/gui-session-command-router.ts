import type { HostBackedGuiChannel } from '@shared/types/host-ui-protocol'
import type { IpcInvokeArgs } from '@shared/types/ipc'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import * as Effect from 'effect/Effect'
import {
  executeLocalSessionCommand,
  type LocalSessionClientConnectionInput,
} from '../session-host/local-session-client'
import {
  ensureLocalSessionHost,
  isLocalSessionHostUnavailable,
} from '../session-host/local-session-host-launcher'
import { refreshLocalSessionHostEndpoint } from '../session-host/local-session-paths'
import { executeConfiguredHostUi } from './configured-host-ui-client'
import { reconcileMcpOwnerRuntime } from './mcp-owner-runtime-reconciliation'

type GuiSessionClientInput = Omit<
  LocalSessionClientConnectionInput,
  'workingDirectory' | 'clientKind'
>

type GuiSessionCommandRoute =
  | { readonly mode: 'local' }
  | { readonly mode: 'remote'; readonly client: GuiSessionClientInput }
  | { readonly mode: 'retired-for-upgrade' }

let guiSessionCommandRoute: GuiSessionCommandRoute = { mode: 'local' }
let guiSessionCommandRouteEpoch = 0

export class GuiSessionHostRetiredForUpgradeError extends Error {
  constructor() {
    super('This OpenWaggle window retired its Session Host for an upgrade. Restart it to continue.')
    this.name = 'GuiSessionHostRetiredForUpgradeError'
  }
}

export interface GuiSessionCommandDependencies {
  readonly execute: typeof executeLocalSessionCommand
  readonly ensure: (input: Parameters<typeof ensureLocalSessionHost>[0]) => Promise<unknown>
  readonly refreshPaths: typeof refreshLocalSessionHostEndpoint
}

function canRetryAfterAmbiguousTransportFailure(payload: LocalSessionCommandPayload) {
  return (
    payload.contract === 'session-query-v2' ||
    payload.contract === 'session-control-v2' ||
    payload.contract === 'session-lifecycle-v2' ||
    payload.contract === 'local-access-v1'
  )
}

export function configureGuiSessionCommandClient(input: GuiSessionClientInput | null) {
  guiSessionCommandRoute = input ? { mode: 'remote', client: input } : { mode: 'local' }
  guiSessionCommandRouteEpoch += 1
}

export function retireGuiSessionCommandClientForUpgrade() {
  guiSessionCommandRoute = { mode: 'retired-for-upgrade' }
  guiSessionCommandRouteEpoch += 1
}

function requireActiveGuiSessionCommandRoute(expectedEpoch: number) {
  const route = guiSessionCommandRoute
  if (route.mode === 'retired-for-upgrade') {
    throw new GuiSessionHostRetiredForUpgradeError()
  }
  if (route.mode !== 'remote' || guiSessionCommandRouteEpoch !== expectedEpoch) {
    throw new Error('The GUI Session Host client changed during command dispatch.')
  }
  return route
}

export type ConfiguredHostUiInvocation =
  | { readonly handled: false }
  | { readonly handled: true; readonly result: unknown }

export async function invokeConfiguredHostUi<C extends HostBackedGuiChannel>(
  channel: C,
  args: IpcInvokeArgs<C>,
): Promise<ConfiguredHostUiInvocation> {
  return invokeConfiguredHostUiRaw(channel, args)
}

export async function invokeConfiguredHostUiRaw<C extends HostBackedGuiChannel>(
  channel: C,
  args: readonly unknown[],
): Promise<ConfiguredHostUiInvocation> {
  const route = guiSessionCommandRoute
  if (route.mode === 'local') return { handled: false }
  if (route.mode === 'retired-for-upgrade') throw new GuiSessionHostRetiredForUpgradeError()
  const expectedEpoch = guiSessionCommandRouteEpoch
  const paths = await refreshLocalSessionHostEndpoint(route.client.paths)
  const activeRoute = requireActiveGuiSessionCommandRoute(expectedEpoch)
  const result = await executeConfiguredHostUi({
    client: { ...activeRoute.client, paths },
    channel,
    args,
  })
  return { handled: true, result }
}

export async function reconcileConfiguredMcpOwnerRuntime(projectPath: string | null | undefined) {
  const route = guiSessionCommandRoute
  if (route.mode === 'local') return false
  if (route.mode === 'retired-for-upgrade') throw new GuiSessionHostRetiredForUpgradeError()
  const expectedEpoch = guiSessionCommandRouteEpoch
  const paths = await refreshLocalSessionHostEndpoint(route.client.paths)
  const activeRoute = requireActiveGuiSessionCommandRoute(expectedEpoch)
  await reconcileMcpOwnerRuntime({ ...activeRoute.client, paths, clientKind: 'gui' }, projectPath)
  return true
}

export function dispatchConfiguredGuiSessionCommand(
  input: {
    readonly caller: LocalSessionCallerIdentity
    readonly payload: LocalSessionCommandPayload
  },
  dependencyOverrides: Partial<GuiSessionCommandDependencies> = {},
) {
  const dependencies: GuiSessionCommandDependencies = {
    execute: executeLocalSessionCommand,
    ensure: ensureLocalSessionHost,
    refreshPaths: refreshLocalSessionHostEndpoint,
    ...dependencyOverrides,
  }
  const route = guiSessionCommandRoute
  if (input.caller.callerId !== 'gui:local-user' || route.mode === 'local') return undefined
  if (route.mode === 'retired-for-upgrade') {
    return Effect.fail(new GuiSessionHostRetiredForUpgradeError())
  }
  const expectedEpoch = guiSessionCommandRouteEpoch
  return Effect.tryPromise(async () => {
    const configuredGuiClient = requireActiveGuiSessionCommandRoute(expectedEpoch).client
    let paths: GuiSessionClientInput['paths']
    try {
      paths = await dependencies.refreshPaths(configuredGuiClient.paths)
    } catch (error) {
      if (!isLocalSessionHostUnavailable(error)) throw error
      requireActiveGuiSessionCommandRoute(expectedEpoch)
      await dependencies.ensure({ ...configuredGuiClient, clientKind: 'gui' })
      requireActiveGuiSessionCommandRoute(expectedEpoch)
      paths = await dependencies.refreshPaths(configuredGuiClient.paths)
    }
    const activeRoute = requireActiveGuiSessionCommandRoute(expectedEpoch)
    guiSessionCommandRoute = { mode: 'remote', client: { ...activeRoute.client, paths } }
    const commandInput = {
      ...configuredGuiClient,
      paths,
      clientKind: 'gui' as const,
      ...(input.caller.workingDirectory ? { workingDirectory: input.caller.workingDirectory } : {}),
      payload: input.payload,
    }
    try {
      return await dependencies.execute(commandInput)
    } catch (error) {
      if (
        !isLocalSessionHostUnavailable(error) ||
        !canRetryAfterAmbiguousTransportFailure(input.payload)
      ) {
        throw error
      }
      requireActiveGuiSessionCommandRoute(expectedEpoch)
      await dependencies.ensure({ ...configuredGuiClient, paths, clientKind: 'gui' })
      const currentRoute = requireActiveGuiSessionCommandRoute(expectedEpoch)
      const recoveredPaths = await dependencies.refreshPaths(currentRoute.client.paths)
      const recoveredRoute = requireActiveGuiSessionCommandRoute(expectedEpoch)
      guiSessionCommandRoute = {
        mode: 'remote',
        client: { ...recoveredRoute.client, paths: recoveredPaths },
      }
      return dependencies.execute({ ...commandInput, paths: recoveredPaths })
    }
  })
}
