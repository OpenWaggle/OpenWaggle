import type { SessionCapability } from '@shared/types/session-capability'
import type { OPENWAGGLE_MCP_SESSION_OPERATIONS_V2 } from './openwaggle-mcp-session-operations-v2'

type McpSessionOperationV2 = (typeof OPENWAGGLE_MCP_SESSION_OPERATIONS_V2)[number]

/**
 * The capabilities every call of an operation needs, before options such as
 * `fullTranscript` or `includeQueueBodies` add more. `openwaggle_hive` advertises only the
 * operations an `mcp serve` process was granted (#350); each call is still checked exactly,
 * against the server's `--grant` here and against the Session Host's caller authority.
 */
export const MCP_SESSION_OPERATION_BASE_CAPABILITIES_V2 = {
  list: ['sessions:discover'],
  search: ['sessions:discover'],
  read: ['sessions:read'],
  turns: ['sessions:read'],
  items: ['sessions:read'],
  status: ['sessions:read'],
  'requests-list': ['sessions:read'],
  wait: ['sessions:read'],
  export: ['sessions:export', 'sessions:read'],
  'export-create': ['sessions:export', 'sessions:read'],
  'export-cancel': ['sessions:export'],
  'exports-list': ['sessions:export', 'sessions:read'],
  'exports-read': ['sessions:export', 'sessions:read'],
  'exports-wait': ['sessions:export', 'sessions:read'],
  'request-respond': ['sessions:respond'],
  'approval-respond': ['sessions:approve'],
  'authorization-set': ['sessions:authorization'],
  rename: ['sessions:organize'],
  archive: ['sessions:organize'],
  unarchive: ['sessions:organize'],
  handoff: ['sessions:organize'],
  create: ['sessions:create'],
  fork: ['sessions:create', 'sessions:read'],
  launch: ['sessions:create', 'sessions:start'],
  spawn: ['sessions:spawn'],
  message: ['sessions:message'],
  start: ['sessions:start'],
  'follow-up': ['sessions:message'],
  steer: ['sessions:steer'],
  promote: ['sessions:queue', 'sessions:steer'],
  replace: ['sessions:message', 'sessions:interrupt'],
  interrupt: ['sessions:interrupt'],
  'interrupt-descendants': ['sessions:interrupt'],
  report: ['sessions:report'],
  'delegation-submit': ['delegations:contribute'],
  'delegation-state': ['delegations:contribute'],
  'delegation-claim': ['delegations:contribute'],
  'delegation-propose-amendment': ['delegations:contribute'],
  'delegation-conflict-acknowledge': ['delegations:review'],
  'delegation-dependency': ['delegations:review'],
  'delegation-amend': ['delegations:review'],
  'delegation-request-revision': ['delegations:review'],
  'delegation-accept': ['delegations:review'],
  'delegation-reopen': ['delegations:review'],
  'delegation-cancel': ['delegations:review'],
  'delegation-verify': ['delegations:review'],
  'delegations-list': ['delegations:read'],
  'delegations-read': ['delegations:read'],
  'delegations-conflicts': ['delegations:read'],
  'queue-list': ['sessions:queue'],
  'queue-withdraw': ['sessions:queue'],
  'queue-reorder': ['sessions:queue'],
  'queue-pause': ['sessions:queue'],
  'queue-resume': ['sessions:queue'],
  // Read in the server process from the --workspace grants; no Session capability.
  'agent-definitions-list': [],
  'agent-definitions-search': [],
} as const satisfies Record<McpSessionOperationV2, readonly SessionCapability[]>

export function mcpSessionOperationGrantedV2(
  operation: McpSessionOperationV2,
  grants: ReadonlySet<SessionCapability>,
) {
  const required: readonly SessionCapability[] =
    MCP_SESSION_OPERATION_BASE_CAPABILITIES_V2[operation]
  return required.every((capability) => grants.has(capability))
}
