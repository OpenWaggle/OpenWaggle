import { SESSION_REPORT_REFERENCE_MAX_LENGTH } from './session-report-reference'

/** One visible title must always remain usable as a Worker report reference. */
export const SESSION_TITLE_MAX_LENGTH = SESSION_REPORT_REFERENCE_MAX_LENGTH
export const SESSION_TITLE_MIN_LENGTH = 1
/** JSON Schema-compatible expression requiring at least one non-whitespace character. */
export const SESSION_TITLE_NON_BLANK_PATTERN = '\\S'

export function isNonBlankSessionTitle(title: string) {
  return title.trim().length >= SESSION_TITLE_MIN_LENGTH
}

export function normalizeSessionTitle(title: string) {
  return title.trim()
}

/** Bound titles synthesized from longer content such as a Worker delegation objective. */
export function boundGeneratedSessionTitle(title: string) {
  const normalized = normalizeSessionTitle(title)
  return (normalized || 'New session').slice(0, SESSION_TITLE_MAX_LENGTH)
}

/** Keep every persistence path aligned with the report-reference contract. */
export function assertSessionTitle(title: string) {
  if (!isNonBlankSessionTitle(title)) {
    throw new RangeError('Session title cannot be blank.')
  }
  if (title.length > SESSION_TITLE_MAX_LENGTH) {
    throw new RangeError(`Session title cannot exceed ${SESSION_TITLE_MAX_LENGTH} characters.`)
  }
  return normalizeSessionTitle(title)
}
