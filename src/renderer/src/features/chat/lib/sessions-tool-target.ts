import type { JsonObject } from '@shared/types/json'
import { parseSessionLink } from '@shared/utils/session-link'
import type { HiveSession } from '@/queries/session-hive-contract'
import { parseToolArgs } from './tool-args'
import { getToolResultText } from './tool-call-block'
import type { SessionsToolTarget } from './tool-labels-sessions'
import { hiveToolArgFields, hiveToolCreatedSessionId, hiveToolTargetFields } from './hive-tool-args'

/** The actions whose Session is the one the call created, named by the call's result. */
const CREATING_ACTIONS: ReadonlySet<string> = new Set(['spawn', 'launch', 'create'])

function stringField(value: unknown) {
  return typeof value === 'string' && value ? value : null
}

/** A Session id argument, which the tool also accepts as a Session link (ADR 0056). */
function sessionIdField(value: unknown) {
  const id = stringField(value)
  return id === null ? null : (parseSessionLink(id) ?? id)
}

/** `{ response: { outcome: { sessionId } } }`, as Session Control answers a spawn or launch. */
function createdSessionId(resultContent: unknown) {
  if (resultContent === undefined) return null
  const body = parseToolArgs(getToolResultText(resultContent))
  return stringField(hiveToolCreatedSessionId(body))
}

/**
 * The id of the Session a hive-tool call acts on, when its arguments or result name one. A
 * fork without a `sessionId` forks the calling Session, whose transcript the row sits in.
 */
export function sessionsToolTargetId(
  args: JsonObject,
  resultContent: unknown,
  callerSessionId: string | null,
) {
  const fields = hiveToolArgFields(args)
  const action = stringField(fields.action)
  if (action !== null && CREATING_ACTIONS.has(action)) return createdSessionId(resultContent)
  if (action === 'report') {
    const target = hiveToolTargetFields(args)
    const result: string | null =
      target.type === 'session' ? sessionIdField(target.sessionId) : null
    return result
  }
  if (action === 'fork') {
    const result: string | null = sessionIdField(fields.sessionId) ?? callerSessionId
    return result
  }
  return sessionIdField(fields.sessionId)
}

export function findHiveSession(id: string | null, sessions: readonly HiveSession[]) {
  if (id === null) return null
  return sessions.find((candidate) => String(candidate.id) === id) ?? null
}

/** The Session as the Hive panel shows it. */
export function sessionsToolTarget(session: HiveSession | null) {
  if (!session) return null
  const target: SessionsToolTarget | null = {
    title: session.title,
    agentName: session.lineage?.agentDefinitionName ?? null,
    isWorker: session.lineage?.role === 'worker',
  }
  return target
}
