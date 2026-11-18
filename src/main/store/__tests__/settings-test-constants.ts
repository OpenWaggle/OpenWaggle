export interface SettingsStoreRow {
  readonly key: string
}

export interface TableRow {
  readonly name: string
}

export interface TableColumnRow {
  readonly name: string
}

export const REMOVED_PERSISTENCE_MIGRATION_IDS = [8, 11] as const
export const REMOVED_PERSISTENCE_TABLES = [
  'session_message_parts',
  'pinned_context',
  'session_messages',
  'orchestration_run_tasks',
  'orchestration_runs',
  'orchestration_events',
  'provider_session_runtime',
  'team_presets',
  'waggle_presets',
  'team_runtime_state',
  'auth_tokens',
] as const
export const REMOVED_SETTINGS_KEYS = [
  'providers',
  'executionMode',
  'qualityPreset',
  'mcpServers',
] as const
