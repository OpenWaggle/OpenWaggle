import { SESSION_REPORT_REFERENCE_MAX_LENGTH } from './session-report-reference'

/** One visible title must always remain usable as a Worker report reference. */
export const SESSION_TITLE_MAX_LENGTH = SESSION_REPORT_REFERENCE_MAX_LENGTH

/** Bound titles synthesized from longer content such as a Worker delegation objective. */
export function boundGeneratedSessionTitle(title: string) {
  return title.slice(0, SESSION_TITLE_MAX_LENGTH)
}

/** Keep every persistence path aligned with the report-reference contract. */
export function assertSessionTitleLength(title: string) {
  if (title.length > SESSION_TITLE_MAX_LENGTH) {
    throw new RangeError(`Session title cannot exceed ${SESSION_TITLE_MAX_LENGTH} characters.`)
  }
  return title
}
