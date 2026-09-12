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
  /** Max total uncompressed bytes inspected inside an office-document archive */
  MAX_ARCHIVE_EXPANDED_BYTES: 32 * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE,
  /** Max entries inspected inside an office-document archive */
  MAX_ARCHIVE_ENTRY_COUNT: 2_048,
  /** Max decoded image pixels accepted for OCR */
  MAX_IMAGE_PIXELS: 40_000_000,
  /** Max pixels passed to Tesseract after safe image normalization */
  MAX_OCR_IMAGE_PIXELS: 8_000_000,
  /** Max wall-clock time, including queueing, allowed for one rich-text extraction */
  EXTRACTION_TIMEOUT_MS: 30_000,
  /** Max expensive attachment extractors allowed across all concurrent requests */
  MAX_CONCURRENT_EXTRACTIONS: 2,
  /** Max waiting extractors allowed across all concurrent requests */
  MAX_QUEUED_EXTRACTIONS: 16,
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
  /** Min terminal columns accepted over IPC */
  MIN_COLS: 2,
  /** Min terminal rows accepted over IPC */
  MIN_ROWS: 2,
  /** Max terminal columns */
  MAX_COLS: 500,
  /** Max terminal rows */
  MAX_ROWS: 200,
  /** Max terminal owner key length (session id or draft key). */
  OWNER_KEY_MAX_LENGTH: 512,
  /** Max terminal id length (client-chosen). */
  TERMINAL_ID_MAX_LENGTH: 128,
  /** Max renderer input-generation nonce length. */
  INPUT_GENERATION_MAX_LENGTH: 128,
  /** Maximum number of explicit environment overrides in one launch context. */
  ENV_MAX_ENTRIES: 32,
  /** Maximum environment variable name length. */
  ENV_KEY_MAX_LENGTH: 128,
  /** Maximum value length for one explicit environment override. */
  ENV_VALUE_MAX_LENGTH: 8_192,
  /** UTF-8 byte cap across explicit environment override names and values. */
  ENV_TOTAL_MAX_BYTES: 64 * BYTES_PER_KIBIBYTE,
  /** Max Working path length accepted for a terminal launch context. */
  CWD_PATH_MAX_LENGTH: 4_096,
  /** Persisted scrollback lines replayed on reattach (ADR 0030). */
  MAX_SCROLLBACK_LINES: 5_000,
  /** Byte cap on retained and persisted scrollback, so progress-bar style
   * output that never emits a newline cannot grow memory or disk unbounded. */
  MAX_SCROLLBACK_BYTES: 10 * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE,
  /** Maximum orphaned, exited terminal records retained hot in main. */
  MAX_INACTIVE_RECORDS: 128,
  /** Aggregate hot scrollback cap across orphaned, exited terminal records. */
  MAX_INACTIVE_SCROLLBACK_BYTES: 64 * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE,
  /** Max terminal input bytes accepted by one write. */
  MAX_INPUT_BYTES: 16 * BYTES_PER_KIBIBYTE,
  /**
   * Max UTF-8 bytes accepted for one atomic Project Action command. Project
   * Action commands are capped at 8,192 Unicode code points plus Enter, so
   * the worst-case UTF-8 payload is 32,769 bytes.
   */
  MAX_PROJECT_ACTION_INPUT_BYTES: 32 * BYTES_PER_KIBIBYTE + 1,
  /** Max input retained while one shell is waiting for prompt readiness. */
  MAX_PENDING_INPUT_BYTES: 2 * BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE,
  /** Pause PTY output once renderer delivery backlog reaches this size. */
  OUTPUT_BACKPRESSURE_HIGH_WATER_BYTES: 512 * BYTES_PER_KIBIBYTE,
  /** Resume PTY output after renderer delivery backlog drains below this size. */
  OUTPUT_BACKPRESSURE_LOW_WATER_BYTES: 256 * BYTES_PER_KIBIBYTE,
  /** Maximum data carried by one acknowledged terminal output event. */
  OUTPUT_DELIVERY_CHUNK_BYTES: 128 * BYTES_PER_KIBIBYTE,
  /** Max panes visible in one terminal tab's split grid. */
  MAX_PANES_PER_TAB: 4,
  /** Maximum tabs retained for one owner in the persisted renderer layout. */
  MAX_TABS_PER_GROUP: 64,
  /** Maximum owner groups retained in the persisted renderer layout. */
  MAX_STORED_GROUPS: 256,
  /** Maximum live or retained main-process terminal records for one owner. */
  MAX_TERMINALS_PER_OWNER: 64,
  /** Maximum live or retained terminal records across the application. */
  MAX_TERMINAL_RECORDS: 256,
  /** Maximum persisted custom tab label length. */
  TAB_NAME_MAX_LENGTH: 256,
  /** PTY output coalescing window in milliseconds before an IPC flush. */
  OUTPUT_FLUSH_MS: 10,
  /** Debounce for resize PTY RPCs while a pane is being dragged. */
  RESIZE_DEBOUNCE_MS: 150,
  /** Coalescing window for appending scrollback to the persisted history file. */
  HISTORY_FLUSH_MS: 40,
  /** Interval for the shared foreground-process poll behind tab titles. */
  ACTIVITY_POLL_MS: 1_000,
  /** Maximum terminal activity records carried by one global metadata snapshot. */
  ACTIVITY_SUMMARY_LIMIT: 1_000,
  /** Interval for the listening-port scan behind terminal port previews. */
  PORT_SCAN_POLL_MS: 2_000,
  /** Maximum time spent classifying one candidate HTTP or HTTPS endpoint. */
  PORT_PREVIEW_PROBE_TIMEOUT_MS: 1_000,
  /** Maximum endpoint probes allowed to run at once. */
  PORT_PREVIEW_PROBE_CONCURRENCY: 16,
  /** Short cache lifetime for both successful and failed endpoint classifications. */
  PORT_PREVIEW_PROBE_CACHE_MS: 15_000,
  /** Bounds retained endpoint classifications across repeated process scans. */
  PORT_PREVIEW_PROBE_CACHE_LIMIT: 512,
  /** Maximum port-preview chips rendered per pane. */
  MAX_PORT_PREVIEWS_SHOWN: 3,
  /** Reliable-idle grace before a missed fast Project Action is considered complete. */
  PROJECT_ACTION_IDLE_FALLBACK_MS: 1_500,
  /** Consecutive reliable idle observations required by the completion fallback. */
  PROJECT_ACTION_IDLE_FALLBACK_POLLS: 2,
} as const

/** Feedback limits */
export const FEEDBACK = {
  /** Default log lines to send in feedback */
  DEFAULT_LOG_LINE_COUNT: 100,
} as const
