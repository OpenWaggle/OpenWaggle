import type { SessionFollowUpSource } from '@shared/types/session-control-queue'

/** The desktop composer's own caller: its messages carry no source label. */
const DESKTOP_USER_CALLER_ID = 'gui:local-user'

export interface QueuedMessageSourceLabel {
  /** What the row shows, such as "From Release prep" or "From CLI". */
  readonly label: string
  /** The full source, shown on hover. */
  readonly detail: string
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
  if (callerId.startsWith('session-agent:')) return sessionLabel(sessionTitle)
  if (callerId.startsWith('local-user:')) return 'From CLI'
  if (callerId.startsWith('profile:')) return profileLabel(source.profileName)
  if (callerId.startsWith('transient-mcp:')) return 'From MCP'
  return 'From another source'
}

function detailText(source: SessionFollowUpSource, sessionTitle: string | undefined) {
  const parts = [`Queued by ${source.callerId}`]
  if (source.sessionId) {
    parts.push(
      sessionTitle?.trim()
        ? `Session: ${sessionTitle.trim()} (${source.sessionId})`
        : `Session: ${source.sessionId}`,
    )
  }
  if (source.profileName) parts.push(`CLI profile: ${source.profileName}`)
  return parts.join('\n')
}

/**
 * The "From …" label of a queued message, or `null` for one the user sent from the desktop
 * composer. `sessionTitle` is the title of the agent Session that queued it, when known.
 */
export function queuedMessageSourceLabel(
  source: SessionFollowUpSource | undefined,
  sessionTitle: string | undefined,
): QueuedMessageSourceLabel | null {
  if (!source || source.callerId === DESKTOP_USER_CALLER_ID) return null
  return { label: labelText(source, sessionTitle), detail: detailText(source, sessionTitle) }
}
