export const SESSION_LIFECYCLE_RESOURCE_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE session_deletion_operations (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    phase TEXT NOT NULL CHECK (phase IN (
      'prepared', 'checkpoint-ref-cleanup-pending', 'external-cleanup-complete', 'pi-file-cleanup-pending',
      'pi-file-cleanup-complete'
    )),
    checkpoint_refs_json TEXT,
    pi_session_file TEXT,
    staged_pi_session_file TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
  `
  CREATE TABLE session_lifecycle_preparation_attempts (
    attempt_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    pi_session_file TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
  `,
] as const
