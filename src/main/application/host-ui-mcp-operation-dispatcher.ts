import { match } from '@diegogbrisa/ts-match'
import {
  HOST_BACKED_MCP_GUI_CHANNELS,
  type HostBackedGuiChannel,
  type HostBackedMcpGuiChannel,
} from '@shared/types/host-ui-protocol'
import * as Effect from 'effect/Effect'
import { callMcpAppToolOperation, readMcpResourceOperation } from './mcp-app-operations'
import {
  listMcpSecretsOperation,
  removeMcpSecretOperation,
  setMcpSecretOperation,
} from './mcp-secret-operations'

function invalid(message: string) {
  return Effect.fail(new Error(message))
}

function noInput<A, E, R>(args: readonly unknown[], operation: () => Effect.Effect<A, E, R>) {
  return args.length === 0 ? operation() : invalid('Expected 0 Host UI arguments.')
}

function oneInput<A, E, R>(
  args: readonly unknown[],
  operation: (input: unknown) => Effect.Effect<A, E, R>,
) {
  return args.length === 1 ? operation(args[0]) : invalid('Expected 1 Host UI arguments.')
}

export function isMcpHostUiChannel(
  channel: HostBackedGuiChannel,
): channel is HostBackedMcpGuiChannel {
  return HOST_BACKED_MCP_GUI_CHANNELS.some((candidate) => candidate === channel)
}

export function dispatchMcpHostUiOperation(
  channel: HostBackedMcpGuiChannel,
  args: readonly unknown[],
) {
  return match(channel)
    .with('mcp:list-secrets', () => noInput(args, listMcpSecretsOperation))
    .with('mcp:set-secret', () => oneInput(args, setMcpSecretOperation))
    .with('mcp:remove-secret', () => oneInput(args, removeMcpSecretOperation))
    .with('mcp:read-resource', () => oneInput(args, readMcpResourceOperation))
    .with('mcp:call-app-tool', () => oneInput(args, callMcpAppToolOperation))
    .exhaustive()
}
