import type { SessionRunExecutionProfileRow } from '../../../src/main/adapters/session-run-execution-profile'

/**
 * Who the measured Session is. A root Session with no Workers is Independent, one with Workers is
 * the Queen of its Hive, and a Worker is a spawned Session with the Worker capabilities.
 */
export type PrefixSessionRole = 'independent' | 'queen' | 'worker'

export const PREFIX_SESSION_ROLES: readonly PrefixSessionRole[] = ['independent', 'queen', 'worker']

/** The capabilities a Queen grants a Worker it spawns with the defaults. */
const WORKER_CAPABILITIES = [
  'sessions:discover',
  'sessions:read',
  'sessions:spawn',
  'sessions:message',
  'sessions:steer',
  'sessions:interrupt',
  'sessions:queue',
  'sessions:report',
  'delegations:read',
  'delegations:contribute',
  'delegations:review',
]

const QUEEN_WORKER_COUNT = 3
const WORKER_DEPTH = 1
const ROOT_DEPTH = 0
const PARENT_SESSION_ID = '5f0c3d2a-8b1e-4c7a-9d6f-2e4b8a1c7d30'
const DELEGATION_ID = '9a7e1b24-6c3d-4f58-8e0a-b1c2d3e4f506'
const WORKSPACE_ID = '3c1d5e7f-9a2b-4c6d-8e0f-1a3b5c7d9e2f'

interface IdentityRowInput {
  readonly sessionId: string
  readonly projectPath: string
  readonly modelId: string
}

function baseRow(input: IdentityRowInput): SessionRunExecutionProfileRow {
  return {
    session_id: input.sessionId,
    title: 'Untitled',
    project_path: input.projectPath,
    profile_json: JSON.stringify({ modelId: input.modelId, thinkingLevel: 'medium' }),
    resolved_agent_snapshot_json: null,
    authorization_ceiling: 'ask-for-approval',
    parent_session_id: null,
    parent_title: null,
    hive_root_session_id: input.sessionId,
    depth: ROOT_DEPTH,
    direct_worker_count: 0,
    workspace_id: WORKSPACE_ID,
    workspace_kind: 'local',
    working_path: input.projectPath,
    capabilities_json: null,
    delegation_id: null,
    delegation_state: null,
  }
}

/** The Host's Session row for the role, as `resolveSessionRunExecution` reads it. */
export function identityRowForRole(
  role: PrefixSessionRole,
  input: IdentityRowInput,
): SessionRunExecutionProfileRow {
  const row = baseRow(input)
  if (role === 'independent') return row
  if (role === 'queen') return { ...row, direct_worker_count: QUEEN_WORKER_COUNT }
  return {
    ...row,
    title: 'Measure the first-turn prefix',
    parent_session_id: PARENT_SESSION_ID,
    parent_title: 'Improve agent context use',
    hive_root_session_id: PARENT_SESSION_ID,
    depth: WORKER_DEPTH,
    workspace_kind: 'managed-worktree',
    capabilities_json: JSON.stringify(WORKER_CAPABILITIES),
    delegation_id: DELEGATION_ID,
    delegation_state: 'working',
  }
}
