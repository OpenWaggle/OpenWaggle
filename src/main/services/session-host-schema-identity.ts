export const SESSION_HOST_SCHEMA_REVISION = 19
export const SESSION_HOST_BASELINE_MIGRATION_ID = 49
export const SESSION_HOST_BASELINE_MIGRATION_NAME = 'session-host-v2-target-schema'
export const SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION_ID = 50
export const SESSION_HOST_LAZY_SEMANTIC_SCOPE_MIGRATION_NAME =
  'session-host-lazy-semantic-scope-invalidation'
export const SESSION_HOST_TRANSCRIPT_TERM_NORMALIZATION_MIGRATION_ID = 51
export const SESSION_HOST_TRANSCRIPT_TERM_NORMALIZATION_MIGRATION_NAME =
  'session-host-query-time-transcript-term-normalization'
export const SESSION_HOST_EXPORT_SELECTED_PATH_MIGRATION_ID = 52
export const SESSION_HOST_EXPORT_SELECTED_PATH_MIGRATION_NAME =
  'session-host-export-path-checkpoints'
export const SESSION_HOST_NODE_DELETE_MIGRATION_ID = 53
export const SESSION_HOST_NODE_DELETE_MIGRATION_NAME = 'session-host-cascade-safe-node-deletion'
export const SESSION_HOST_DISCOVERY_TERM_MIGRATION_ID = 54
export const SESSION_HOST_DISCOVERY_TERM_MIGRATION_NAME = 'session-host-native-discovery-signatures'
export const SESSION_HOST_DESKTOP_FENCE_MIGRATION_ID = 55
export const SESSION_HOST_BROWSER_ATTACHMENT_MIGRATION_ID = 56
export const SESSION_HOST_PROJECT_CATALOG_GENERATION_MIGRATION_ID = 57
export const SESSION_HOST_TURN_CHECKPOINT_STARTED_AT_MIGRATION_ID = 58
export const SESSION_RESOURCE_LOCAL_IMAGE_BACKFILL_MIGRATION_ID = 59
export const SESSION_HOST_FRESH_REVISION = 'fresh-v16'
export const SESSION_HOST_CUTOVER_REVISION = 'session-host-v2'

// Older binaries must fail closed when a newer migration has touched the target.
// Newer binaries may still open the baseline and apply their remaining migrations.
export const SESSION_HOST_SUPPORTED_MAX_MIGRATION_ID =
  SESSION_RESOURCE_LOCAL_IMAGE_BACKFILL_MIGRATION_ID
