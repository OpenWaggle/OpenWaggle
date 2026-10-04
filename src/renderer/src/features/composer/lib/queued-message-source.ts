import type { SessionFollowUpSource } from '@shared/types/session-control-queue'

/** The desktop composer's own caller: its messages carry no source label. */
const DESKTOP_USER_CALLER_ID = 'gui:local-user'

/** An agent Session's caller: `session-agent:<sessionId>:<runId>`. */
const SESSION_AGENT_CALLER_PREFIX = 'session-agent:'

export interface QueuedMessageSourceLabel {
  /** What the row shows, such as "From Release prep" or "From CLI". */
  readonly label: string
  /** The full source, shown on hover. */
  readonly detail: string
}

/**
 * The agent Session that queued a message: the Host's resolved `sessionId`, or the one its
 * `session-agent:` caller names when the Host did not resolve it.
 */
export function queuedMessageSourceSessionId(source: SessionFollowUpSource | undefined) {
  if (!source) return undefined
  if (source.sessionId) return source.sessionId
  if (!source.callerId.startsWith(SESSION_AGENT_CALLER_PREFIX)) return undefined
  const sessionId = source.callerId.slice(SESSION_AGENT_CALLER_PREFIX.length).split(':')[0]
  return sessionId || undefined
}

/**
 * The agent Session's title as the Host resolved it. Read defensively: a Host that predates the
 * field sends none, and the value crosses a process boundary.
 */
export function queuedMessageSourceTitle(source: SessionFollowUpSource | undefined) {
  if (!source || !('sessionTitle' in source)) return undefined
  const title = source.sessionTitle
  return typeof title === 'string' && title.trim() ? title.trim() : undefined
}

function sessionLabel(title: string | undefined) {
  const trimmed = title?.trim()
  return trimmed ? `From ${trimmed}` : 'From another Session'
}

function profileLabel(name: string | undefined) {
  return name ? `From CLI profile: ${name}` : 'From CLI profile'
}

function labelText(source: SessionFollowUpSource, sessionTitle: string | undefined) {
  const { callerId } = source
  if (callerId.startsWith(SESSION_AGENT_CALLER_PREFIX)) return sessionLabel(sessionTitle)
  if (callerId.startsWith('local-user:')) return 'From CLI'
  if (callerId.startsWith('profile:')) return profileLabel(source.profileName)
  if (callerId.startsWith('transient-mcp:')) return 'From MCP'
  return 'From another source'
}

function detailText(
  source: SessionFollowUpSource,
  sessionTitle: string | undefined,
  sentAsYou: boolean,
) {
  const parts = [`Queued by ${source.callerId}`]
  const sessionId = queuedMessageSourceSessionId(source)
  if (sessionId) {
    parts.push(
      sessionTitle?.trim()
        ? `Session: ${sessionTitle.trim()} (${sessionId})`
        : `Session: ${sessionId}`,
    )
  }
  if (source.profileName) parts.push(`CLI profile: ${source.profileName}`)
  if (sentAsYou) parts.push('Sent as you')
  return parts.join('\n')
}

/**
 * The "From …" label of a queued message, or `null` for one the user sent from the desktop
 * composer. `sessionTitle` is the title of the agent Session that queued it, when known.
 * `deliveringCallerId` is whose access delivers it: the desktop user after "Send as me".
 */
export function queuedMessageSourceLabel(
  source: SessionFollowUpSource | undefined,
  sessionTitle: string | undefined,
  deliveringCallerId?: string,
): QueuedMessageSourceLabel | null {
  if (!source || source.callerId === DESKTOP_USER_CALLER_ID) return null
  const sentAsYou = deliveringCallerId === DESKTOP_USER_CALLER_ID
  return {
    label: labelText(source, sessionTitle),
    detail: detailText(source, sessionTitle, sentAsYou),
  }
}
