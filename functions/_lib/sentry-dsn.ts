/** Parsing of the real Sentry DSN the endpoint holds (ADR 0045); the app never ships it. */

export interface SentryProject {
  /** The configured DSN, written into every forwarded envelope header. */
  readonly dsn: string
  /** Sentry's envelope ingestion URL for the DSN's project. */
  readonly envelopeUrl: string
}

const PROJECT_ID = /^\d+$/u
/** Sentry's EU data region; error reports go nowhere else (ADR 0045). */
const EU_REGION_HOST_SUFFIX = '.de.sentry.io'

/**
 * Parses `https://<key>@<host>[/<path>]/<projectId>` into the project's envelope URL,
 * `https://<host>[/<path>]/api/<projectId>/envelope/`. Returns `undefined` for anything else,
 * including a project outside Sentry's EU region, so a misconfigured DSN fails closed.
 */
export function parseSentryDsn(dsn: string): SentryProject | undefined {
  let url: URL
  try {
    url = new URL(dsn)
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' || url.username === '') return undefined
  if (!url.hostname.endsWith(EU_REGION_HOST_SUFFIX)) return undefined
  const segments = url.pathname.split('/').filter((segment) => segment !== '')
  const projectId = segments.pop()
  if (projectId === undefined || !PROJECT_ID.test(projectId)) return undefined
  const prefix = segments.map((segment) => `/${segment}`).join('')
  return { dsn, envelopeUrl: `https://${url.host}${prefix}/api/${projectId}/envelope/` }
}
