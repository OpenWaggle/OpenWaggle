export const DATABASE_FILE_NAME = 'openwaggle.db'

// Low-level SQLite driver tuning knob; not shared application configuration.
export const SQLITE_PREPARE_CACHE_SIZE = 128

export const SQLITE_BOOLEAN = {
  TRUE: 1,
  FALSE: 0,
} as const
