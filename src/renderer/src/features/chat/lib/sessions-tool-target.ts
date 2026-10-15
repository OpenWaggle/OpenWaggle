import type { JsonObject, JsonValue } from '@shared/types/json'
import type { HiveSession } from '@/queries/session-hive-contract'
import { parseToolArgs } from './tool-args'
import { getToolResultText } from './tool-call-block'
import type { SessionsToolTarget } from './tool-labels-sessions'

/** The actions whose Session is the one the call created, named by the call's result. */
const CREATING_ACTIONS: ReadonlySet<string> = new Set(['spawn', 'launch', 'create'])

function objectField(value: JsonValue | undefined): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function stringField(value: JsonValue | undefined) {
  return typeof value === 'string' && value ? value : null
}

/** `{ response: { outcome: { sessionId } } }`, as Session Control answers a spawn or launch. */
function createdSessionId(resultContent: unknown) {
  if (resultContent === undefined) return null
  const body = parseToolArgs(getToolResultText(resultContent))
  return stringField(objectField(objectField(body.response)?.outcome)?.sessionId)
}

/** The id of the Session a sessions-tool call acts on, when its arguments or result name one. */
export function sessionsToolTargetId(args: JsonObject, resultContent: unknown): string | null {
  const action = stringField(args.action)
  if (action !== null && CREATING_ACTIONS.has(action)) return createdSessionId(resultContent)
  if (action === 'report') {
    const target = objectField(args.target)
    return target?.type === 'session' ? stringField(target.sessionId) : null
  }
  return stringField(args.sessionId)
}

/** The Session as the Hive panel shows it; null when this Hive does not hold it. */
export function sessionsToolTarget(
  id: string | null,
  sessions: readonly HiveSession[],
): SessionsToolTarget | null {
  if (id === null) return null
  const session = sessions.find((candidate) => String(candidate.id) === id)
  if (!session) return null
  return {
    title: session.title,
    agentName: session.lineage?.agentDefinitionName ?? null,
    isWorker: session.lineage?.role === 'worker',
  }
}
