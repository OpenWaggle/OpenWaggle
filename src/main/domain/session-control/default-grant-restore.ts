import {
  DEFAULT_SESSION_AGENT_CAPABILITIES,
  type SessionCapability,
} from '@shared/types/session-capability'
import { includesEvery } from '@shared/utils/set-membership'
import { DEFAULT_BEFORE_SCHEDULED_TASKS } from './session-capability-restriction'

/** A Session's stored execution profile, as the one-time capability restore reads it. */
export interface StoredSessionGrant {
  readonly sessionId: string
  readonly createdAt: number
  /** Whether the local user's own authority wrote it (not an access profile or another client). */
  readonly localUserOrigin: boolean
  /** Its `sessionCapabilities`; undefined when it has none or it is not a list of strings. */
  readonly capabilities: readonly string[] | undefined
  /** Whether its agent definition chose a capability list, or the snapshot cannot be read. */
  readonly definitionChoseCapabilities: boolean
}

/**
 * Where a Session's list came from: the agent that created, launched or forked it, the Session it
 * was forked from, or the parent it was spawned under.
 */
export interface StoredSessionGrantSource {
  readonly sessionId: string
  readonly sourceSessionId: string
}

const SCHEDULE_CAPABILITIES: readonly SessionCapability[] = ['schedules:read', 'schedules:manage']

function sourcesBySession(sources: readonly StoredSessionGrantSource[]) {
  const sourcesOf = new Map<string, string[]>()
  for (const { sessionId, sourceSessionId } of sources) {
    if (sessionId === sourceSessionId) continue
    const known = sourcesOf.get(sessionId) ?? []
    if (!known.includes(sourceSessionId)) known.push(sourceSessionId)
    sourcesOf.set(sessionId, known)
  }
  return sourcesOf
}

/**
 * Whether a definition chose the Session's list, or that of any Session it came from: a fixpoint
 * over the history, so a cycle in it cannot hide a definition.
 */
function definitionAncestry(
  grants: readonly StoredSessionGrant[],
  sourcesOf: ReadonlyMap<string, readonly string[]>,
) {
  const chosen = new Set(
    grants.filter((grant) => grant.definitionChoseCapabilities).map((grant) => grant.sessionId),
  )
  let changed = true
  while (changed) {
    changed = false
    for (const [sessionId, sources] of sourcesOf) {
      if (chosen.has(sessionId) || !sources.some((source) => chosen.has(source))) continue
      chosen.add(sessionId)
      changed = true
    }
  }
  return (sessionId: string) => chosen.has(sessionId)
}

/** Restore: a default grant in itself. Older copy: restored only if every source is. */
function grantKind(
  grant: StoredSessionGrant,
  scheduledTasksSince: number | undefined,
  comesFromDefinition: (sessionId: string) => boolean,
) {
  const list = grant.capabilities
  if (!list || !grant.localUserOrigin || !includesEvery(list, DEFAULT_BEFORE_SCHEDULED_TASKS)) {
    return 'keep'
  }
  if (comesFromDefinition(grant.sessionId)) return 'keep'
  if (includesEvery(list, DEFAULT_SESSION_AGENT_CAPABILITIES)) return 'restore'
  if (list.some((capability) => SCHEDULE_CAPABILITIES.some((held) => held === capability))) {
    return 'keep'
  }
  const olderThanScheduledTasks =
    scheduledTasksSince !== undefined && grant.createdAt < scheduledTasksSince
  return olderThanScheduledTasks ? 'restore' : 'older-copy'
}

/**
 * The Sessions whose stored `sessionCapabilities` only ever held the default grant of its time, so
 * removing the list (the current default grant) restores what they were meant to have:
 *
 * - the default grant before Scheduled tasks, stored before Scheduled tasks existed
 *   (`scheduledTasksSince`), or the whole current default grant;
 * - the default grant before Scheduled tasks that a Session got later from those, through any
 *   number of steps, when every Session it came from is one of them.
 *
 * Only lists the local user's authority wrote count, and never one an agent definition chose, on
 * the Session or anywhere it came from. Any other list is a real restriction and stays.
 */
export function sessionsHoldingOnlyADefaultGrant(input: {
  readonly grants: readonly StoredSessionGrant[]
  readonly sources: readonly StoredSessionGrantSource[]
  /** When Scheduled tasks were installed; undefined when unknown, which restores none by age. */
  readonly scheduledTasksSince: number | undefined
}) {
  const sourcesOf = sourcesBySession(input.sources)
  const comesFromDefinition = definitionAncestry(input.grants, sourcesOf)
  const olderCopies = new Set<string>()
  const restored = new Set<string>()
  for (const grant of input.grants) {
    const kind = grantKind(grant, input.scheduledTasksSince, comesFromDefinition)
    if (kind === 'restore') restored.add(grant.sessionId)
    if (kind === 'older-copy') olderCopies.add(grant.sessionId)
  }

  // Least fixpoint: a later copy of the older grant is restored once every source it has is.
  let changed = true
  while (changed) {
    changed = false
    for (const sessionId of olderCopies) {
      const sources = sourcesOf.get(sessionId) ?? []
      if (sources.length === 0 || !sources.every((source) => restored.has(source))) continue
      restored.add(sessionId)
      olderCopies.delete(sessionId)
      changed = true
    }
  }
  return [...restored]
}
