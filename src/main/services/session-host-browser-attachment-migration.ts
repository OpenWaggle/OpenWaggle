import { SESSION_ATTACHMENT_TARGET_SCHEMA_STATEMENTS } from './session-host-attachment-schema'
import { SESSION_HOST_BROWSER_ATTACHMENT_MIGRATION_ID } from './session-host-schema-identity'

const MAX_BROWSER_ATTACHMENT_METADATA_LENGTH = 512 * 1024

export const SESSION_HOST_BROWSER_ATTACHMENT_MIGRATION = {
  id: SESSION_HOST_BROWSER_ATTACHMENT_MIGRATION_ID,
  name: 'session-host-browser-preview-attachments',
  statements: [
    `CREATE TABLE session_prepared_attachments_browser (
      id TEXT PRIMARY KEY,
      owner_caller_id TEXT NOT NULL,
      preparation_request_id TEXT NOT NULL,
      session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('text', 'image', 'pdf')),
      origin TEXT NOT NULL CHECK (origin IN ('user-file', 'auto-paste-text', 'browser-preview')),
      name TEXT NOT NULL,
      real_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
      source_base64 TEXT NOT NULL,
      extracted_text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      bound_at INTEGER,
      expires_at INTEGER,
      browser_preview_json TEXT CHECK (browser_preview_json IS NULL OR
        (length(browser_preview_json) <= ${MAX_BROWSER_ATTACHMENT_METADATA_LENGTH} AND json_valid(browser_preview_json)))
    )`,
    `INSERT INTO session_prepared_attachments_browser (
      id, owner_caller_id, preparation_request_id, session_id, kind, origin, name, real_path,
      mime_type, size_bytes, source_base64, extracted_text, created_at, bound_at, expires_at
    ) SELECT id, owner_caller_id, preparation_request_id, session_id, kind, origin, name,
      real_path, mime_type, size_bytes, source_base64, extracted_text, created_at, bound_at,
      expires_at FROM session_prepared_attachments`,
    'DROP TABLE session_prepared_attachments',
    'ALTER TABLE session_prepared_attachments_browser RENAME TO session_prepared_attachments',
    ...SESSION_ATTACHMENT_TARGET_SCHEMA_STATEMENTS.slice(1),
  ],
} as const
