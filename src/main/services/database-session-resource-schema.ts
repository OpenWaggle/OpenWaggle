import { SESSION_OUTPUT_RETRY_SCHEMA_STATEMENT } from './database-session-output-retry-schema'

export const SESSION_RESOURCE_BACKFILL_SCHEMA_STATEMENT = `
  CREATE TABLE IF NOT EXISTS session_resource_backfill_state (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    through_created_order INTEGER NOT NULL
  )
  `

export const SESSION_RESOURCE_CLEANUP_QUEUE_SCHEMA_STATEMENT = `
  CREATE TABLE IF NOT EXISTS session_resource_cleanup_queue (
    session_id TEXT PRIMARY KEY,
    queued_at INTEGER NOT NULL
  )
  `

export const CURRENT_SESSION_RESOURCE_SCHEMA_STATEMENTS = [
  `
  CREATE TABLE IF NOT EXISTS session_resources (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    canonical_key TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    mime_type TEXT,
    locator TEXT,
    managed_path TEXT,
    available INTEGER NOT NULL DEFAULT 1,
    is_source INTEGER NOT NULL DEFAULT 0,
    is_output INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE (session_id, canonical_key)
  )
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_session_resources_session_updated
  ON session_resources (session_id, updated_at DESC)
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_session_resources_source_updated
  ON session_resources (session_id, is_source, updated_at DESC, id ASC)
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_session_resources_output_updated
  ON session_resources (session_id, is_output, updated_at DESC, id ASC)
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_session_resources_change_request_updated
  ON session_resources (session_id, kind, is_output, updated_at DESC, id ASC)
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_session_resources_image_created
  ON session_resources (session_id, kind, created_at ASC, id ASC)
  `,
  `
  CREATE TABLE IF NOT EXISTS session_resource_occurrences (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL REFERENCES session_resources(id) ON DELETE CASCADE,
    node_id TEXT,
    branch_id TEXT,
    actor TEXT NOT NULL,
    activity TEXT NOT NULL,
    label TEXT,
    locator TEXT,
    created_at INTEGER NOT NULL
  )
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_session_resource_occurrences_resource_created
  ON session_resource_occurrences (resource_id, created_at ASC)
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_session_resource_occurrences_node_resource
  ON session_resource_occurrences (node_id, resource_id)
  `,
  `
  CREATE INDEX IF NOT EXISTS idx_session_resource_occurrences_resource_branch_created
  ON session_resource_occurrences (resource_id, branch_id, created_at ASC, id ASC)
  `,
  `
  CREATE TABLE IF NOT EXISTS session_resource_catalog_state (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL DEFAULT 0
  )
  `,
  `
  CREATE TRIGGER IF NOT EXISTS trg_session_resource_catalog_resource_insert
  AFTER INSERT ON session_resources BEGIN
    INSERT INTO session_resource_catalog_state (session_id, revision) VALUES (NEW.session_id, 1)
    ON CONFLICT(session_id) DO UPDATE SET revision = revision + 1;
  END
  `,
  `
  CREATE TRIGGER IF NOT EXISTS trg_session_resource_catalog_resource_update
  AFTER UPDATE ON session_resources BEGIN
    UPDATE session_resource_catalog_state SET revision = revision + 1
    WHERE session_id = NEW.session_id;
  END
  `,
  `
  CREATE TRIGGER IF NOT EXISTS trg_session_resource_catalog_resource_delete
  AFTER DELETE ON session_resources BEGIN
    UPDATE session_resource_catalog_state SET revision = revision + 1
    WHERE session_id = OLD.session_id;
  END
  `,
  `
  CREATE TRIGGER IF NOT EXISTS trg_session_resource_catalog_occurrence_insert
  AFTER INSERT ON session_resource_occurrences BEGIN
    UPDATE session_resource_catalog_state SET revision = revision + 1
    WHERE session_id = (SELECT session_id FROM session_resources WHERE id = NEW.resource_id);
  END
  `,
  `
  CREATE TRIGGER IF NOT EXISTS trg_session_resource_catalog_occurrence_update
  AFTER UPDATE ON session_resource_occurrences BEGIN
    UPDATE session_resource_catalog_state SET revision = revision + 1
    WHERE session_id = (SELECT session_id FROM session_resources WHERE id = NEW.resource_id);
  END
  `,
  `
  CREATE TRIGGER IF NOT EXISTS trg_session_resource_catalog_occurrence_delete
  AFTER DELETE ON session_resource_occurrences BEGIN
    UPDATE session_resource_catalog_state SET revision = revision + 1
    WHERE session_id = (SELECT session_id FROM session_resources WHERE id = OLD.resource_id);
  END
  `,
  SESSION_RESOURCE_BACKFILL_SCHEMA_STATEMENT,
  SESSION_RESOURCE_CLEANUP_QUEUE_SCHEMA_STATEMENT,
  SESSION_OUTPUT_RETRY_SCHEMA_STATEMENT,
] as const
