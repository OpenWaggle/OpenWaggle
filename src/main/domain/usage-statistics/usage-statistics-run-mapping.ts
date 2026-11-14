/** Pure mappings from Run facts to the values `run.finished` publishes. */
import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import {
  isProfileCallerId,
  isSessionAgentCallerId,
  isTransientMcpCallerId,
} from '../session-control/root-session-project-reach'

const GUI_CALLER_ID = 'gui:local-user'
const MILLISECONDS_PER_SECOND = 1000
const MAX_DURATION_SECONDS = 604_800
const MAX_TOKEN_COUNT = 1_000_000_000_000

/**
 * The entry point a Run came from, read from the caller that wrote it. Agents inside OpenWaggle,
 * external tools through MCP and anything using a named access profile count as `agent`; the
 * plain local-user credential is the command line. The Host cannot tell an MCP client using that
 * plain credential apart from the CLI, so those count as `cli`.
 */
export function usageStatisticsEntryPointForCaller(callerId: string) {
  if (callerId === GUI_CALLER_ID) return 'app' as const
  if (
    // An OpenWaggle agent through the Hive tool, an external tool through a scoped MCP
    // authority, or anything under a named access profile.
    isSessionAgentCallerId(callerId) ||
    isTransientMcpCallerId(callerId) ||
    isProfileCallerId(callerId)
  ) {
    return 'agent' as const
  }
  return 'cli' as const
}

/** What the Host knows of a Run's authorization at its start, before it asks for approval. */
export interface UsageStatisticsStartAccess {
  readonly ceiling: AgentAuthorizationMode | null
  readonly runOverride?: AgentAuthorizationMode
  readonly sessionMode: AgentAuthorizationMode | null
  /** The project's default, from the project config the Run already loads; `null` when unset. */
  readonly projectDefault?: AgentAuthorizationMode | null
  readonly globalDefault: AgentAuthorizationMode | null
}

/**
 * The authorization mode a Run starts under, by the precedence the authorization module uses:
 * an execution ceiling of Ask for Approval wins, then the Run's override, the Session's mode,
 * the project default and the global default. Grant and profile ceilings and revocations are
 * not consulted; a Run that asks for approval reports the mode it resolved then instead, which
 * includes them.
 */
export function usageStatisticsStartAccessMode(input: UsageStatisticsStartAccess) {
  if (input.ceiling === 'ask-for-approval') return 'ask-for-approval' as const
  return (input.runOverride ??
    input.sessionMode ??
    input.projectDefault ??
    input.globalDefault ??
    'ask-for-approval') satisfies AgentAuthorizationMode
}

export function usageStatisticsRunResult(
  terminalStatus: 'completed' | 'failed' | 'interrupted' | 'interrupted-by-interaction-timeout',
) {
  if (terminalStatus === 'completed' || terminalStatus === 'failed') return terminalStatus
  return 'interrupted' as const
}

export function usageStatisticsDurationSeconds(startedAt: number, endedAt: number) {
  const seconds = Math.round((endedAt - startedAt) / MILLISECONDS_PER_SECOND)
  return Math.min(Math.max(seconds, 0), MAX_DURATION_SECONDS)
}

export function usageStatisticsTokenCount(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(Math.max(Math.round(value), 0), MAX_TOKEN_COUNT)
}
