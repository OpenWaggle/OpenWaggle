/** Invalidate the Host's distinct-project search cache only when membership can change. */
export const SESSION_PROJECT_CATALOG_GENERATION_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS session_project_catalog_generation (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    database_id TEXT NOT NULL,
    generation INTEGER NOT NULL DEFAULT 0
  )`,
  `INSERT OR IGNORE INTO session_project_catalog_generation (singleton, database_id, generation)
   VALUES (1, lower(hex(randomblob(16))), 0)`,
  `CREATE TRIGGER IF NOT EXISTS session_project_catalog_generation_insert
   AFTER INSERT ON sessions BEGIN
     UPDATE session_project_catalog_generation SET generation = generation + 1 WHERE singleton = 1;
   END`,
  `CREATE TRIGGER IF NOT EXISTS session_project_catalog_generation_delete
   AFTER DELETE ON sessions BEGIN
     UPDATE session_project_catalog_generation SET generation = generation + 1 WHERE singleton = 1;
   END`,
  `CREATE TRIGGER IF NOT EXISTS session_project_catalog_generation_update
   AFTER UPDATE OF archived, project_path ON sessions BEGIN
     UPDATE session_project_catalog_generation SET generation = generation + 1 WHERE singleton = 1;
   END`,
] as const
