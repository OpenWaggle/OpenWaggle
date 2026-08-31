import { matchBy } from '@diegogbrisa/ts-match'
import type {
  LocalSessionCallerIdentity,
  LocalSessionProfileAuthority,
} from '@shared/types/local-session-profile'
import type { SessionCapability } from '@shared/types/session-capability'
import type { SessionControlMutationRequest } from '@shared/types/session-control'
import type { SessionLifecycleRequest } from '@shared/types/session-lifecycle'
import type { SessionQueryRequest } from '@shared/types/session-query'

export function requiredSessionControlCapabilities(
  command: SessionControlMutationRequest['command'],
): readonly SessionCapability[] {
  return matchBy(command, 'operation')
    .with('message', 'follow-up', () => ['sessions:message'])
    .with('start', () => ['sessions:start'])
    .with('steer', () => ['sessions:steer'])
    .with('interrupt', 'interrupt-descendants', () => ['sessions:interrupt'])
    .with('request-respond', 'approval-respond', (interaction) =>
      interaction.operation === 'approval-respond' ? ['sessions:approve'] : ['sessions:respond'],
    )
    .with('authorization-set', () => ['sessions:authorization'])
    .with('report', () => ['sessions:report'])
    .with('export-cancel', () => ['sessions:export'])
    .with('export-create', (command) =>
      command.includeQueueBodies
        ? ['sessions:export', 'sessions:read', 'sessions:queue']
        : ['sessions:export', 'sessions:read'],
    )
    .with('rename', 'archive', 'unarchive', 'handoff', () => ['sessions:organize'])
    .with(
      'delegation-submit',
      'delegation-state',
      'delegation-claim',
      'delegation-propose-amendment',
      () => ['delegations:contribute'],
    )
    .with(
      'delegation-request-revision',
      'delegation-accept',
      'delegation-reopen',
      'delegation-cancel',
      'delegation-conflict-acknowledge',
      'delegation-dependency',
      'delegation-amend',
      'delegation-verify',
      () => ['delegations:review'],
    )
    .with('promote', () => ['sessions:queue', 'sessions:steer'])
    .with('replace', () => ['sessions:message', 'sessions:interrupt'])
    .with(
      'queue-withdraw',
      'queue-reorder',
      'queue-pause',
      'queue-resume',
      'queue-update-authorization',
      () => ['sessions:queue'],
    )
    .exhaustive()
}

export function requiredSessionLifecycleCapabilities(
  command: SessionLifecycleRequest['command'],
): readonly SessionCapability[] {
  return matchBy(command, 'operation')
    .with('create', () => ['sessions:create'])
    .with('fork', () => ['sessions:create', 'sessions:read'])
    .with('launch', () => ['sessions:create', 'sessions:start'])
    .with('spawn', () => ['sessions:spawn'])
    .exhaustive()
}

export function requiredSessionQueryCapabilities(
  query: SessionQueryRequest['query'],
): readonly SessionCapability[] {
  return matchBy(query, 'operation')
    .with('list', () => ['sessions:discover'])
    .with('search', (query) =>
      query.searchScope === 'full-transcript'
        ? ['sessions:discover', 'sessions:read']
        : ['sessions:discover'],
    )
    .with('read', 'turns', 'items', 'status', 'requests-list', 'wait', () => ['sessions:read'])
    .with('export', (query) =>
      query.includeQueueBodies
        ? ['sessions:export', 'sessions:read', 'sessions:queue']
        : ['sessions:export', 'sessions:read'],
    )
    .with('exports-list', 'exports-read', 'exports-wait', () => ['sessions:export'])
    .with('delegations-list', 'delegations-read', 'delegations-conflicts', () => [
      'delegations:read',
    ])
    .with('queue-list', (command) =>
      command.includeBodies ? ['sessions:queue', 'sessions:read'] : ['sessions:queue'],
    )
    .exhaustive()
}

export function authorizeSessionCapabilities(
  authority: LocalSessionProfileAuthority | undefined,
  required: readonly SessionCapability[],
) {
  if (!authority) return { authorized: true } as const
  const missing = required.filter((capability) => !authority.capabilities.includes(capability))
  return missing.length === 0
    ? ({ authorized: true } as const)
    : ({ authorized: false, code: 'capability_denied' as const, missing } as const)
}

export function authorizeSessionTarget(
  authority: LocalSessionProfileAuthority | undefined,
  target: {
    readonly projectPath?: string
    readonly sessionId?: string
    readonly hiveRootSessionId?: string
  },
) {
  if (!authority || authority.scope.all) return { authorized: true } as const
  const matchesProject =
    target.projectPath !== undefined && authority.scope.projectPaths?.includes(target.projectPath)
  const matchesSession =
    target.sessionId !== undefined && authority.scope.sessionIds?.includes(target.sessionId)
  const matchesHive =
    target.hiveRootSessionId !== undefined &&
    authority.scope.hiveRootSessionIds?.includes(target.hiveRootSessionId)
  return matchesProject || matchesSession || matchesHive
    ? ({ authorized: true } as const)
    : ({ authorized: false, code: 'target_scope_denied' as const } as const)
}

export function authorizeSessionTargetForCaller(
  caller: LocalSessionCallerIdentity,
  target: {
    readonly projectPath?: string
    readonly sessionId?: string
    readonly hiveRootSessionId?: string
  },
  required: readonly SessionCapability[],
) {
  const authority = caller.profileAuthority
  const baseAuthority =
    authority && caller.baseProfileScope
      ? { ...authority, scope: caller.baseProfileScope }
      : authority
  const baseCapabilities = authorizeSessionCapabilities(baseAuthority, required)
  const baseScope = authorizeSessionTarget(baseAuthority, target)
  if (baseCapabilities.authorized && baseScope.authorized) return baseScope
  const derived = target.sessionId
    ? caller.derivedSessionAuthorities?.find(
        (candidate) => candidate.sessionId === target.sessionId,
      )
    : undefined
  if (!derived) return baseCapabilities.authorized ? baseScope : baseCapabilities
  const missing = required.filter((capability) => !derived.capabilities.includes(capability))
  return missing.length === 0
    ? ({ authorized: true, derived } as const)
    : ({ authorized: false, code: 'capability_denied' as const, missing } as const)
}

export function snapshotAuthorizesSessionCapabilities(
  caller: LocalSessionCallerIdentity,
  sessionId: string,
  required: readonly SessionCapability[],
) {
  const authority = caller.profileAuthority
  if (!authority) return true
  const baseScope = caller.baseProfileScope ?? authority.scope
  const baseSessionIds = caller.eventAdmissionSessionIds ?? baseScope.sessionIds ?? []
  const baseAuthorized =
    required.every((capability) => authority.capabilities.includes(capability)) &&
    (baseScope.all === true || baseSessionIds.includes(sessionId))
  if (baseAuthorized) return true
  const derived = caller.derivedSessionAuthorities?.find(
    (candidate) => candidate.sessionId === sessionId,
  )
  return Boolean(
    derived && required.every((capability) => derived.capabilities.includes(capability)),
  )
}
