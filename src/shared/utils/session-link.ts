import { SESSION_INPUT_LIMITS } from '../session-input-limits'

/**
 * Session links name one Session by its stable identity: `openwaggle://sessions/<sessionId>`
 * (ADR 0056). The `openwaggle` scheme is shared with the renderer origin, whose host is `app`;
 * only the `sessions` host is a Session link, so nothing here can address the renderer.
 */
export const SESSION_LINK_SCHEME = 'openwaggle'

const SESSION_LINK_PREFIX = `${SESSION_LINK_SCHEME}://sessions/`

/**
 * One Session identity and nothing else: no query, fragment, credentials, port, or second path
 * segment. A trailing slash is accepted because some launchers append one to a bare URL. The
 * scheme and host are case-insensitive as URLs are; the identity keeps its exact case.
 */
const SESSION_LINK_PATTERN = /^openwaggle:\/\/sessions\/([A-Za-z0-9][A-Za-z0-9_-]*)\/?$/i

const SESSION_LINK_SCHEME_PATTERN = /^openwaggle:/i

export const SESSION_LINK_FORMAT_HINT = `A Session link looks like ${SESSION_LINK_PREFIX}<session-id>.`

/** The Session link for a Session identity. */
export function sessionLink(sessionId: string) {
  return `${SESSION_LINK_PREFIX}${encodeURIComponent(sessionId)}`
}

/** True for any `openwaggle:` URL, valid Session link or not. */
export function hasSessionLinkScheme(value: string) {
  return SESSION_LINK_SCHEME_PATTERN.test(value.trim())
}

/** The Session identity a Session link names, or `null` when the value is not a Session link. */
export function parseSessionLink(value: string) {
  const sessionId = SESSION_LINK_PATTERN.exec(value.trim())?.[1]
  if (sessionId === undefined || sessionId.length > SESSION_INPUT_LIMITS.idLength) return null
  return sessionId
}

/**
 * Accept a Session identity written as a bare ID or as a Session link. A bare ID is returned
 * unchanged, so the caller's own validation still decides whether it exists or is allowed. An
 * `openwaggle:` value that is not a valid Session link is refused rather than passed on as an ID.
 */
export function sessionIdFromReference(value: string) {
  if (!hasSessionLinkScheme(value)) return value
  const sessionId = parseSessionLink(value)
  if (sessionId === null)
    throw new Error(`The value is not a Session link. ${SESSION_LINK_FORMAT_HINT}`)
  return sessionId
}
