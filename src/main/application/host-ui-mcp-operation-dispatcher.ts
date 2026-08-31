import { match } from '@diegogbrisa/ts-match'
import {
  HOST_BACKED_MCP_GUI_CHANNELS,
  type HostBackedGuiChannel,
  type HostBackedMcpGuiChannel,
} from '@shared/types/host-ui-protocol'
import * as Effect from 'effect/Effect'
import {
  callMcpAppToolOperation,
  getMcpPromptOperation,
  listMcpCapabilitiesOperation,
  listMcpEventSubscriptionsOperation,
  listMcpEventsOperation,
  operateMcpTaskOperation,
  readMcpResourceOperation,
  reviewMcpRemoteSkillOperation,
  setMcpEventSubscriptionOperation,
} from './mcp-capability-operations'
import {
  addMcpServerOperation,
  applyMcpImportsOperation,
  doctorMcpOperation,
  getMcpSettingsOperation,
  listMcpSecretsOperation,
  logoutMcpServerOperation,
  previewMcpImportsOperation,
  removeMcpSecretOperation,
  removeMcpServerOperation,
  setMcpProjectServerEnabledOperation,
  setMcpScopeStateOperation,
  setMcpSecretOperation,
  setMcpServerEnabledOperation,
  setMcpServerTrustOperation,
  writeMcpSourceConfigOperation,
} from './mcp-management-operations'

function invalid(message: string) {
  return Effect.fail(new Error(message))
}

function noInput<A, E, R>(args: readonly unknown[], operation: () => Effect.Effect<A, E, R>) {
  return args.length === 0 ? operation() : invalid('Expected 0 Host UI arguments.')
}

function optionalInput<A, E, R>(
  args: readonly unknown[],
  operation: (input?: unknown) => Effect.Effect<A, E, R>,
) {
  return args.length <= 1 ? operation(args[0]) : invalid('Expected 0 to 1 Host UI arguments.')
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
    .with('mcp:get-settings', () => optionalInput(args, getMcpSettingsOperation))
    .with('mcp:set-scope-state', () => oneInput(args, setMcpScopeStateOperation))
    .with('mcp:set-server-enabled', () => oneInput(args, setMcpServerEnabledOperation))
    .with('mcp:set-project-server-enabled', () =>
      oneInput(args, setMcpProjectServerEnabledOperation),
    )
    .with('mcp:write-source-config', () => oneInput(args, writeMcpSourceConfigOperation))
    .with('mcp:set-server-trust', () => oneInput(args, setMcpServerTrustOperation))
    .with('mcp:remove-server', () => oneInput(args, removeMcpServerOperation))
    .with('mcp:logout-server', () => oneInput(args, logoutMcpServerOperation))
    .with('mcp:add-server', () => oneInput(args, addMcpServerOperation))
    .with('mcp:preview-imports', () => oneInput(args, previewMcpImportsOperation))
    .with('mcp:apply-imports', () => oneInput(args, applyMcpImportsOperation))
    .with('mcp:doctor', () => optionalInput(args, doctorMcpOperation))
    .with('mcp:list-secrets', () => noInput(args, listMcpSecretsOperation))
    .with('mcp:set-secret', () => oneInput(args, setMcpSecretOperation))
    .with('mcp:remove-secret', () => oneInput(args, removeMcpSecretOperation))
    .with('mcp:list-capabilities', () => oneInput(args, listMcpCapabilitiesOperation))
    .with('mcp:get-prompt', () => oneInput(args, getMcpPromptOperation))
    .with('mcp:read-resource', () => oneInput(args, readMcpResourceOperation))
    .with('mcp:review-remote-skill', () => oneInput(args, reviewMcpRemoteSkillOperation))
    .with('mcp:operate-task', () => oneInput(args, operateMcpTaskOperation))
    .with('mcp:call-app-tool', () => oneInput(args, callMcpAppToolOperation))
    .with('mcp:set-event-subscription', () => oneInput(args, setMcpEventSubscriptionOperation))
    .with('mcp:list-events', () => optionalInput(args, listMcpEventsOperation))
    .with('mcp:list-event-subscriptions', () =>
      optionalInput(args, listMcpEventSubscriptionsOperation),
    )
    .exhaustive()
}
