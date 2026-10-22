import { SESSION_INPUT_LIMITS } from '../session-input-limits'
import type { BuildChannel } from '../types/build-identity'

/**
 * Session links name one Session by its stable identity: `openwaggle://sessions/<sessionId>`
 * (ADR 0056). The `openwaggle` scheme is shared with the renderer origin, whose host is `app`;
 * only the `sessions` host is a Session link, so nothing here can address the renderer.
 *
 * Imports stay relative: electron-builder loads this module through `scripts/build-identity.ts`
 * with jiti, which does not resolve the `@shared` alias.
 */
export const SESSION_LINK_SCHEME = 'openwaggle'

const SESSION_LINK_PREFIX = `${SESSION_LINK_SCHEME}://sessions/`

/** The identities a Session link can carry, unencoded. Generated Session ids are UUIDs. */
const SESSION_LINK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

/**
 * One Session identity and nothing else: no query, fragment, credentials, port, or second path
 * segment. A trailing slash is accepted because some launchers append one to a bare URL. The
 * scheme and host are case-insensitive as URLs are; the identity keeps its exact case.
 */
const SESSION_LINK_PATTERN = /^openwaggle:\/\/sessions\/([A-Za-z0-9][A-Za-z0-9_-]*)\/?$/i

const SESSION_LINK_SCHEME_PATTERN = /^openwaggle:/i

export const SESSION_LINK_FORMAT_HINT = `A Session link looks like ${SESSION_LINK_PREFIX}<session-id>.`

function isLinkableSessionId(sessionId: string) {
  return (
    sessionId.length <= SESSION_INPUT_LIMITS.idLength && SESSION_LINK_ID_PATTERN.test(sessionId)
  )
}

/**
 * The Session link for a Session identity, or `null` for an identity a link cannot carry, so a
 * copied link always opens. Every identity OpenWaggle generates can be linked.
 */
export function sessionLink(sessionId: string) {
  return isLinkableSessionId(sessionId) ? `${SESSION_LINK_PREFIX}${sessionId}` : null
}

/** True for any `openwaggle:` URL, valid Session link or not. */
export function hasSessionLinkScheme(value: string) {
  return SESSION_LINK_SCHEME_PATTERN.test(value.trim())
}

/** The Session identity a Session link names, or `null` when the value is not a Session link. */
export function parseSessionLink(value: string) {
  const sessionId = SESSION_LINK_PATTERN.exec(value.trim())?.[1]
  if (sessionId === undefined || !isLinkableSessionId(sessionId)) return null
  return sessionId
}

/**
 * Accept a Session identity written as a bare ID or as a Session link. A bare ID is returned
 * unchanged, so the caller's own validation still decides whether it exists or is allowed. An
 * `openwaggle:` value that is not a valid Session link is refused rather than passed on as an ID.
 * The label names the refused field, for example `sessionIds` or `--target`.
 */
export function sessionIdFromReference(value: string, label = 'The value') {
  if (!hasSessionLinkScheme(value)) return value
  const sessionId = parseSessionLink(value)
  if (sessionId === null) {
    throw new Error(`${label} is not a Session link. ${SESSION_LINK_FORMAT_HINT}`)
  }
  return sessionId
}

/**
 * Resolve a list of Session identities, dropping a repeat that only appears once both are
 * resolved, such as a link and the bare ID of the same Session.
 */
export function sessionIdsFromReferences(values: readonly string[], label = 'The value') {
  return [...new Set(values.map((value) => sessionIdFromReference(value, label)))]
}

/**
 * Whether builds of a channel claim Session links from the operating system (ADR 0056). Release
 * channels share one identity and Session data (ADR 0032); a dev build keeps its own data, so it
 * never takes links meant for the installed app. Packaging and the runtime both ask this.
 */
export function channelClaimsSessionLinks(channel: BuildChannel) {
  return channel !== 'dev'
}
