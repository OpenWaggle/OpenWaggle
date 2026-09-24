export const PINNED_SESSIONS_MIGRATION = {
  id: 24,
  name: 'pinned-sessions',
  statements: [
    `
      CREATE TABLE IF NOT EXISTS pinned_sessions (
        session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        pinned_at INTEGER NOT NULL,
        sort_key TEXT NOT NULL
      )
      `,
    `
      CREATE INDEX IF NOT EXISTS idx_pinned_sessions_sort_key
      ON pinned_sessions (sort_key ASC)
      `,
  ],
} as const
