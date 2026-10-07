import { match } from '@diegogbrisa/ts-match'
import {
  HOST_BACKED_MCP_GUI_CHANNELS,
  type HostBackedGuiChannel,
  type HostBackedMcpGuiChannel,
} from '@shared/types/host-ui-protocol'
import * as Effect from 'effect/Effect'
import { callMcpAppToolOperation, readMcpResourceOperation } from './mcp-app-operations'
import {
  addMcpServerOperation,
  applyMcpImportsOperation,
  getMcpConfigurationOperation,
  inspectMcpServerOperation,
  installMcpCatalogServerOperation,
  previewMcpImportsOperation,
  removeMcpServerOperation,
  setMcpServerEnabledOperation,
  setMcpServerExposureOperation,
  signInMcpServerOperation,
  signOutMcpServerOperation,
} from './mcp-configuration-operations'
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
    .with('mcp:get-configuration', () => oneInput(args, getMcpConfigurationOperation))
    .with('mcp:set-server-enabled', () => oneInput(args, setMcpServerEnabledOperation))
    .with('mcp:set-server-exposure', () => oneInput(args, setMcpServerExposureOperation))
    .with('mcp:add-server', () => oneInput(args, addMcpServerOperation))
    .with('mcp:remove-server', () => oneInput(args, removeMcpServerOperation))
    .with('mcp:install-catalog-server', () => oneInput(args, installMcpCatalogServerOperation))
    .with('mcp:inspect-server', () => oneInput(args, inspectMcpServerOperation))
    .with('mcp:sign-in', () => oneInput(args, signInMcpServerOperation))
    .with('mcp:sign-out', () => oneInput(args, signOutMcpServerOperation))
    .with('mcp:preview-imports', () => oneInput(args, previewMcpImportsOperation))
    .with('mcp:apply-imports', () => oneInput(args, applyMcpImportsOperation))
    .with('mcp:list-secrets', () => noInput(args, listMcpSecretsOperation))
    .with('mcp:set-secret', () => oneInput(args, setMcpSecretOperation))
    .with('mcp:remove-secret', () => oneInput(args, removeMcpSecretOperation))
    .with('mcp:read-resource', () => oneInput(args, readMcpResourceOperation))
    .with('mcp:call-app-tool', () => oneInput(args, callMcpAppToolOperation))
    .exhaustive()
}
