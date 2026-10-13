import { safeDecodeUnknown } from '@shared/schema'
import { actionManagementRequestSchema } from '@shared/schemas/action-management'
import type { HostBackedGuiChannel } from '@shared/types/host-ui-protocol'
import { isRecord } from '@shared/utils/validation'

/** Channels that only read, whatever their arguments. */
export const READ_ONLY_HOST_UI_CHANNELS: ReadonlySet<HostBackedGuiChannel> =
  new Set<HostBackedGuiChannel>([
    'agent:list-active-runs',
    'agent:get-context-usage',
    'agent:list-extension-commands',
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
    'mcp:get-configuration',
    // Not `mcp:inspect-server`: it connects to the server and may start its process, so it is
    // neither replayed after an ambiguous failure nor answered while the Host drains.
    'mcp:get-server-statuses',
    'mcp:preview-imports',
    'mcp:search-registry',
    'mcp:get-registry-server',
    'mcp:get-session-enabled',
    'mcp:list-app-catalog',
    'providers:get-models',
    'docs:discover',
    'skills:list',
    'skills:get-preview',
    'agent-definitions:list-display',
    'agent-definitions:get-preview',
    'git:change-request:panel',
    'git:change-request:merge-candidate',
    'git:session:verify-working-path',
  ])

function isReplaySafeAgentDefinitionInvocation(args: readonly unknown[]) {
  if (args.length !== 1 || !isRecord(args[0]) || !isRecord(args[0].command)) return false
  const operation = args[0].command.operation
  return operation === 'list' || operation === 'import-plan' || operation === 'refresh-plan'
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
  return READ_ONLY_HOST_UI_CHANNELS.has(channel)
}
