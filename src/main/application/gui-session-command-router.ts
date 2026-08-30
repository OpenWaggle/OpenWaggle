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
import { executeConfiguredHostUi } from './configured-host-ui-client'

type GuiSessionClientInput = Omit<
  LocalSessionClientConnectionInput,
  'workingDirectory' | 'clientKind'
>

type GuiSessionCommandRoute =
  | { readonly mode: 'local' }
  | { readonly mode: 'remote'; readonly client: GuiSessionClientInput }
  | { readonly mode: 'retired-for-upgrade' }

let guiSessionCommandRoute: GuiSessionCommandRoute = { mode: 'local' }

export class GuiSessionHostRetiredForUpgradeError extends Error {
  constructor() {
    super('This OpenWaggle window retired its Session Host for an upgrade. Restart it to continue.')
    this.name = 'GuiSessionHostRetiredForUpgradeError'
  }
}

export interface GuiSessionCommandDependencies {
  readonly execute: typeof executeLocalSessionCommand
  readonly ensure: (input: Parameters<typeof ensureLocalSessionHost>[0]) => Promise<unknown>
}

function cannotRetryAfterAmbiguousTransportFailure(payload: LocalSessionCommandPayload) {
  return payload.contract === 'session-waggle-v1' || payload.contract === 'local-compaction-v1'
}

export function configureGuiSessionCommandClient(input: GuiSessionClientInput | null) {
  guiSessionCommandRoute = input ? { mode: 'remote', client: input } : { mode: 'local' }
}

export function retireGuiSessionCommandClientForUpgrade() {
  guiSessionCommandRoute = { mode: 'retired-for-upgrade' }
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
  const result = await executeConfiguredHostUi({ client: route.client, channel, args })
  return { handled: true, result }
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
    ...dependencyOverrides,
  }
  const route = guiSessionCommandRoute
  if (input.caller.callerId !== 'gui:local-user' || route.mode === 'local') return undefined
  if (route.mode === 'retired-for-upgrade') {
    return Effect.fail(new GuiSessionHostRetiredForUpgradeError())
  }
  const configuredGuiClient = route.client
  const commandInput = {
    ...configuredGuiClient,
    clientKind: 'gui' as const,
    ...(input.caller.workingDirectory ? { workingDirectory: input.caller.workingDirectory } : {}),
    payload: input.payload,
  }
  return Effect.tryPromise(async () => {
    try {
      return await dependencies.execute(commandInput)
    } catch (error) {
      if (
        !isLocalSessionHostUnavailable(error) ||
        cannotRetryAfterAmbiguousTransportFailure(input.payload)
      ) {
        throw error
      }
      await dependencies.ensure({
        ...configuredGuiClient,
        clientKind: 'gui',
      })
      return dependencies.execute(commandInput)
    }
  })
}
