const KIBIBYTE = 1024
const MEBIBYTE = 1024 * KIBIBYTE

/** Runtime policy mirrored by the measured platform profiles under performance/syntax-budgets. */
export const WORKSPACE_EDITOR_PERFORMANCE = {
  FOCUSED_EDIT_MAX_BYTES: MEBIBYTE,
  SOURCE_PAGE_REQUEST_BYTES: 256 * KIBIBYTE,
  SOURCE_PAGE_MAX_BYTES: 512 * KIBIBYTE,
  DRAFT_JOURNAL_MAX_CHARACTERS: 4 * MEBIBYTE,
  /** One lane may tokenize a large file while another keeps compact code responsive. */
  SYNTAX_MAX_WORKERS: 2,
  SYNTAX_WORKER_TOKEN_CACHE_MAX_ENTRIES: 2,
  /** Retains at least one admitted 1 MiB TypeScript token tree between viewport requests. */
  SYNTAX_WORKER_TOKEN_CACHE_MAX_ESTIMATED_BYTES: 32 * MEBIBYTE,
  SYNTAX_CACHE_MAX_ENTRIES: 64,
  SYNTAX_CACHE_MAX_SOURCE_BYTES: 4 * MEBIBYTE,
} as const
