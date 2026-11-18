/**
 * The top-level Sessions an agent made: created, launched or forked by a Session agent, a client
 * profile or a Session agent's Scheduled task (`sqlite-worker-run-admission.ts`). Their Runs count
 * toward Active Workers with the Workers' (ADR 0030, amended 2026-11-09). A Worker is known by its
 * `session_spawn_lineage` row instead, and a Session the person made has no row.
 */
export const SESSION_AGENT_ORIGIN_TABLE_STATEMENT = `
  CREATE TABLE IF NOT EXISTS session_agent_origins (
    session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    caller_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`

export const SESSION_AGENT_ORIGIN_SCHEMA_STATEMENTS = [SESSION_AGENT_ORIGIN_TABLE_STATEMENT]
