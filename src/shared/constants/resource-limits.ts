// File size, attachment, and output limits.

/** Bytes in one kibibyte (1024). Canonical home for byte-unit constants. */
export const BYTES_PER_KIBIBYTE = 1024

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
  /** Max extracted text characters from attachment content */
  MAX_EXTRACTED_TEXT_CHARS: 12_000,
} as const

/** Composer limits */
export const COMPOSER = {
  /** Max file suggestions in autocomplete */
  FILE_SUGGEST_LIMIT: 50,
} as const

/** Workspace file search and preview limits */
export const WORKSPACE_FILES = {
  /** Maximum results returned by the centered file picker */
  PICKER_RESULT_LIMIT: 200,
  /** Maximum content-search matches returned to the renderer */
  CONTENT_RESULT_LIMIT: 200,
  /** Maximum indexed files returned to the side-panel explorer */
  EXPLORER_RESULT_LIMIT: 5_000,
  /** Maximum ordered document edit batches accepted by one IPC request */
  DOCUMENT_EDIT_BATCH_LIMIT: 64,
  /** Maximum deltas accepted inside one ordered edit batch. */
  DOCUMENT_EDIT_CHANGES_PER_BATCH_LIMIT: 256,
  /** Aggregate deltas accepted in one save request before the renderer must compact. */
  DOCUMENT_EDIT_CHANGE_LIMIT: 2_048,
  /** Aggregate inserted UTF-16 code units accepted in one save request. */
  DOCUMENT_EDIT_INSERT_CODE_UNIT_LIMIT: 2 * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE,
} as const

/** Terminal limits */
export const TERMINAL = {
  /** Default terminal columns */
  DEFAULT_COLS: 80,
  /** Default terminal rows */
  DEFAULT_ROWS: 24,
  /** Max terminal columns */
  MAX_COLS: 500,
  /** Max terminal rows */
  MAX_ROWS: 200,
} as const

/** Feedback limits */
export const FEEDBACK = {
  /** Default log lines to send in feedback */
  DEFAULT_LOG_LINE_COUNT: 100,
} as const
