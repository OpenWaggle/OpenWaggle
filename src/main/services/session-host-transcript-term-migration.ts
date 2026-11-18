import type { AppMigration } from './database-migrations'
import {
  SESSION_HOST_TRANSCRIPT_TERM_NORMALIZATION_MIGRATION_ID,
  SESSION_HOST_TRANSCRIPT_TERM_NORMALIZATION_MIGRATION_NAME,
} from './session-host-schema-identity'
import {
  SESSION_TRANSCRIPT_TERMS_SESSION_INDEX_STATEMENT,
  SESSION_TRANSCRIPT_TERMS_TABLE_STATEMENT,
} from './session-host-transcript-term-schema'

export const SESSION_HOST_TRANSCRIPT_TERM_NORMALIZATION_MIGRATION = {
  id: SESSION_HOST_TRANSCRIPT_TERM_NORMALIZATION_MIGRATION_ID,
  name: SESSION_HOST_TRANSCRIPT_TERM_NORMALIZATION_MIGRATION_NAME,
  statements: [
    'DROP INDEX IF EXISTS idx_session_transcript_terms_rank',
    'DROP INDEX IF EXISTS idx_session_transcript_terms_session',
    'ALTER TABLE session_transcript_terms RENAME TO session_transcript_terms_before_normalization',
    SESSION_TRANSCRIPT_TERMS_TABLE_STATEMENT,
    `INSERT INTO session_transcript_terms (
      term, session_id, occurrences, first_node_id, first_created_order, first_run_id
    )
    SELECT term, session_id, occurrences, first_node_id, first_created_order, first_run_id
    FROM session_transcript_terms_before_normalization`,
    'DROP TABLE session_transcript_terms_before_normalization',
    SESSION_TRANSCRIPT_TERMS_SESSION_INDEX_STATEMENT,
  ],
} satisfies AppMigration
