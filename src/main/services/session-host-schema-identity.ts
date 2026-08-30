export const SESSION_HOST_SCHEMA_REVISION = 6
export const SESSION_HOST_BASELINE_MIGRATION_ID = 26
export const SESSION_HOST_BASELINE_MIGRATION_NAME = 'session-host-v2-target-schema'
export const SESSION_HOST_FRESH_REVISION = 'fresh-v6'
export const SESSION_HOST_CUTOVER_REVISION = 'session-host-v2'

// Older binaries must fail closed when a newer migration has touched the target.
// Newer binaries may still open the baseline and apply their remaining migrations.
export const SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID = SESSION_HOST_BASELINE_MIGRATION_ID
