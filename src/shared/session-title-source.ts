/**
 * Where a Session title came from. Generation may replace only a `default` or `provisional` title;
 * an explicitly given, renamed, or forked title is `manual` and is never overwritten (ADR 0043).
 */
export const SESSION_TITLE_SOURCES = ['default', 'provisional', 'generated', 'manual'] as const

export type SessionTitleSource = (typeof SESSION_TITLE_SOURCES)[number]

/** The placeholder title of a Session that has not received its first message yet. */
export const DEFAULT_SESSION_TITLE = 'New session'

export function isSessionTitleSource(value: unknown): value is SessionTitleSource {
  return typeof value === 'string' && SESSION_TITLE_SOURCES.some((source) => source === value)
}
