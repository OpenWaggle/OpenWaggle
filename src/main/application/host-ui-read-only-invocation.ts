import { safeDecodeUnknown } from '@shared/schema'
import { actionManagementRequestSchema } from '@shared/schemas/action-management'
import type { HostBackedGuiChannel } from '@shared/types/host-ui-protocol'
import { isRecord } from '@shared/utils/validation'

const REPLAY_SAFE_HOST_UI_CHANNELS = new Set<HostBackedGuiChannel>([
  'agent:list-active-runs',
  'agent:get-context-usage',
  'sessions:get-detail',
  'sessions:list-by-ids',
  'sessions:list-page',
  'sessions:list-projects',
  'sessions:list-hive-page',
  'sessions:list-archived-branches',
  'sessions:get-tree',
  'sessions:get-workspace',
  'sessions:turn-checkpoints:list',
  'sessions:turn-diff:get',
  'sessions:turn-diff-files:get',
  'sessions:pins:list',
  'sessions:resources:get',
  'sessions:resources:locate-image',
  'sessions:resources:node-page',
  'sessions:resources:list-by-node-ids',
  'sessions:resources:thumbnail',
  'settings:get',
  'extensions:list-packages',
  'extensions:list-contributions',
  'mcp:list-secrets',
  'mcp:list-capabilities',
  'mcp:list-events',
  'mcp:list-event-subscriptions',
  'mcp:preview-imports',
  'providers:get-models',
  'docs:discover',
  'skills:list',
  'skills:get-preview',
  'agent-definitions:list-display',
  'agent-definitions:get-preview',
])

function isReplaySafeAgentDefinitionInvocation(args: readonly unknown[]) {
  if (args.length !== 1 || !isRecord(args[0]) || !isRecord(args[0].command)) return false
  const operation = args[0].command.operation
  return operation === 'list' || operation === 'import-plan' || operation === 'refresh-plan'
}

function isReplaySafeMcpSettingsInvocation(args: readonly unknown[]) {
  if (args.length === 0 || (args.length === 1 && args[0] === undefined)) return true
  if (args.length !== 1 || !args[0] || typeof args[0] !== 'object' || Array.isArray(args[0])) {
    return false
  }
  return !('reconcileRuntime' in args[0]) || args[0].reconcileRuntime === false
}

/**
 * Whether a Host UI invocation only reads. Such reads can be replayed after an ambiguous
 * transport failure, and a draining Host still answers them so the desktop app stays usable
 * while its work ends. Mutations, including mixed read/write channels, are never read-only.
 */
export function isReadOnlyHostUiInvocation(
  channel: HostBackedGuiChannel,
  args: readonly unknown[],
) {
  if (channel === 'project-actions:manage') {
    if (args.length !== 1) return false
    const decoded = safeDecodeUnknown(actionManagementRequestSchema, args[0])
    return (
      decoded.success &&
      ['catalog', 'discover', 'runs', 'output', 'preparation', 'retained-preparation'].includes(
        decoded.data.operation.type,
      )
    )
  }
  if (channel === 'agent-definitions:manage') return isReplaySafeAgentDefinitionInvocation(args)
  if (channel === 'mcp:get-settings') return isReplaySafeMcpSettingsInvocation(args)
  return REPLAY_SAFE_HOST_UI_CHANNELS.has(channel)
}
