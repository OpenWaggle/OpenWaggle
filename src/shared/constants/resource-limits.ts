// File size, attachment, and output limits.

import { BYTES_PER_KIBIBYTE, PERCENT_BASE } from './constants'

/** Tool output limits */
export const TOOL_OUTPUT = {
  /** Hard cap on tool output (100 KB) */
  MAX_BYTES: PERCENT_BASE * BYTES_PER_KIBIBYTE,
} as const

/** File read limits */
export const FILE_READ = {
  /** Maximum file read size (1 MB) */
  MAX_SIZE_BYTES: BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE,
} as const

/** Web fetch limits */
export const WEB_FETCH = {
  /** Default max response length (50,000 characters) */
  DEFAULT_MAX_LENGTH: 50_000,
  /** Hard cap on response body (5 MB) */
  MAX_BODY_BYTES: 5 * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE,
} as const

/** Attachment limits */
export const ATTACHMENT = {
  /** Max attachments per message */
  MAX_COUNT: 5,
  /** Max size per attachment (8 MB) */
  MAX_SIZE_BYTES: 8 * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE,
  /** Max total attachment size (20 MB) */
  MAX_TOTAL_SIZE_BYTES: 20 * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE,
  /** Max attachments in preview list */
  MAX_LIST_PREVIEW: 5,
} as const

/** Project context read limits */
export const PROJECT_CONTEXT = {
  /** Max project file read size (512 KB) */
  MAX_READ_SIZE_BYTES: 512 * BYTES_PER_KIBIBYTE,
  /** Max lines to read from a project file */
  MAX_READ_LINES: 500,
} as const

/** Command execution limits */
export const COMMAND_EXECUTION = {
  /** Max command output preview in logs (1024 bytes) */
  MAX_LOG_PREVIEW_BYTES: 1024,
} as const

/** Feedback limits */
export const FEEDBACK = {
  /** Default log lines to send in feedback */
  DEFAULT_LOG_LINE_COUNT: 100,
} as const
