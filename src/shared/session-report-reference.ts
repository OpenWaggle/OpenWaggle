export const SESSION_REPORT_REFERENCE_KINDS = ['session-id', 'title', 'agent-definition'] as const
export const SESSION_REPORT_REFERENCE_MAX_LENGTH = 512

export type SessionReportReferenceKind = (typeof SESSION_REPORT_REFERENCE_KINDS)[number]

/** Locale-stable normalization shared by persistence and exact reference resolution. */
export function normalizeSessionReportReference(value: string) {
  return value.trim().toLowerCase()
}
