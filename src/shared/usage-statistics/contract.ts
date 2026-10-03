/**
 * Wire contract for OpenWaggle Usage statistics (ADR 0044, 0045, 0046).
 *
 * This module is the single definition of every event and field the app may send and the
 * statistics endpoint may accept. The published field list is
 * docs/specs/usage-statistics-fields.md; a change here must change that document.
 *
 * It is deliberately dependency-free and uses no path aliases, because the Cloudflare Pages
 * Function under functions/ bundles it directly.
 */

export const USAGE_STATISTICS_SCHEMA_VERSION = 1

/** Origin that serves the statistics endpoint, the error-report tunnel and the website. */
export const USAGE_STATISTICS_ORIGIN = 'https://openwaggle.ai'
export const USAGE_STATISTICS_EVENTS_PATH = '/api/v1/events'
export const USAGE_STATISTICS_ERROR_TUNNEL_PATH = '/api/v1/errors'
export const USAGE_STATISTICS_WEB_PATH = '/api/v1/web'
export const USAGE_STATISTICS_SNAPSHOT_PATH = '/api/v1/snapshot'

/** Upper bound on events in one request; the app batches below it. */
export const USAGE_STATISTICS_MAX_EVENTS_PER_REQUEST = 200
/** Upper bound on one request body in bytes. */
export const USAGE_STATISTICS_MAX_REQUEST_BYTES = 262_144
/** Oldest day, relative to the endpoint's current UTC day, that it still accepts. */
export const USAGE_STATISTICS_MAX_EVENT_AGE_DAYS = 35

export const USAGE_STATISTICS_MAX_IDENTIFIER_LENGTH = 128
export const USAGE_STATISTICS_MAX_VERSION_LENGTH = 64
export const USAGE_STATISTICS_MAX_LIST_ITEMS = 32
const SECONDS_PER_WEEK = 604_800
const MAX_TOKEN_TOTAL = 1_000_000_000_000

export const USAGE_STATISTICS_BUILD_CHANNELS = ['stable', 'beta', 'rc', 'alpha'] as const
export const USAGE_STATISTICS_UPDATE_CHANNELS = ['stable', 'beta', 'alpha'] as const
export const USAGE_STATISTICS_OPERATING_SYSTEMS = ['darwin', 'win32', 'linux'] as const
export const USAGE_STATISTICS_ARCHITECTURES = ['x64', 'arm64'] as const
export const USAGE_STATISTICS_ENTRY_POINTS = ['app', 'cli', 'agent'] as const
export const USAGE_STATISTICS_INSTALL_AGES = [
  '0-7d',
  '8-30d',
  '31-90d',
  '91-365d',
  '>365d',
] as const
export const USAGE_STATISTICS_EXTENSION_BUCKETS = ['0', '1', '2-5', '>5'] as const
export const USAGE_STATISTICS_THINKING_LEVELS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const
export const USAGE_STATISTICS_ACCESS_MODES = ['ask-for-approval', 'yolo'] as const
export const USAGE_STATISTICS_RUN_RESULTS = ['completed', 'failed', 'interrupted'] as const
export const USAGE_STATISTICS_COMPACTION_MECHANISMS = ['native', 'fallback'] as const

/** The value the app sends for any identifier outside a public catalog. */
export const USAGE_STATISTICS_CUSTOM_IDENTIFIER = 'custom'

/** Daily feature flags, reported as booleans with `install.active`. */
export const USAGE_STATISTICS_FEATURE_FLAGS = [
  'worker_session',
  'waggle',
  'worktree',
  'terminal',
  'browser_preview',
  'browser_agent_driven',
  'project_action',
  'inline_visualization',
  'attachment',
  'voice',
  'fork_or_handoff',
] as const

export type UsageStatisticsFeatureFlag = (typeof USAGE_STATISTICS_FEATURE_FLAGS)[number]

export type UsageStatisticsFieldSpec =
  | { readonly kind: 'boolean' }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'enum-list'; readonly values: readonly string[] }
  | { readonly kind: 'identifier' }
  | { readonly kind: 'identifier-list' }
  | { readonly kind: 'integer'; readonly min: number; readonly max: number }
  | { readonly kind: 'version' }

const BOOLEAN = { kind: 'boolean' } as const satisfies UsageStatisticsFieldSpec
const IDENTIFIER = { kind: 'identifier' } as const satisfies UsageStatisticsFieldSpec
const IDENTIFIER_LIST = { kind: 'identifier-list' } as const satisfies UsageStatisticsFieldSpec
const VERSION = { kind: 'version' } as const satisfies UsageStatisticsFieldSpec

function enumField(values: readonly string[]): UsageStatisticsFieldSpec {
  return { kind: 'enum', values }
}

function featureFlagFields() {
  const fields: Record<string, UsageStatisticsFieldSpec> = {}
  for (const flag of USAGE_STATISTICS_FEATURE_FLAGS) fields[flag] = BOOLEAN
  return fields
}

/** Fields every request carries once, in its `context`. */
export const USAGE_STATISTICS_CONTEXT_FIELDS = {
  version: VERSION,
  build_channel: enumField(USAGE_STATISTICS_BUILD_CHANNELS),
  update_channel: enumField(USAGE_STATISTICS_UPDATE_CHANNELS),
  os: enumField(USAGE_STATISTICS_OPERATING_SYSTEMS),
  arch: enumField(USAGE_STATISTICS_ARCHITECTURES),
} as const satisfies Record<string, UsageStatisticsFieldSpec>

/**
 * Every event name and the only properties it may carry. Every listed property is required,
 * except the feature fields of `install.active`, which are sent only when true or non-empty.
 */
export const USAGE_STATISTICS_EVENT_FIELDS = {
  'install.active': {
    first_this_week: BOOLEAN,
    first_this_month: BOOLEAN,
    install_age: enumField(USAGE_STATISTICS_INSTALL_AGES),
    entry_points: { kind: 'enum-list', values: USAGE_STATISTICS_ENTRY_POINTS },
    ...featureFlagFields(),
    mcp_servers: IDENTIFIER_LIST,
    skills: IDENTIFIER_LIST,
    extensions_enabled: enumField(USAGE_STATISTICS_EXTENSION_BUCKETS),
  },
  'install.new': {},
  'install.onboarding': {
    provider_within_first_day: BOOLEAN,
    run_within_first_day: BOOLEAN,
    project_within_first_day: BOOLEAN,
  },
  'app.opened': {},
  'update.installed': { previous_version: VERSION },
  'run.finished': {
    entry_point: enumField(USAGE_STATISTICS_ENTRY_POINTS),
    provider: IDENTIFIER,
    model: IDENTIFIER,
    thinking_level: enumField(USAGE_STATISTICS_THINKING_LEVELS),
    access_mode: enumField(USAGE_STATISTICS_ACCESS_MODES),
    waggle: BOOLEAN,
    result: enumField(USAGE_STATISTICS_RUN_RESULTS),
    duration_s: { kind: 'integer', min: 0, max: SECONDS_PER_WEEK },
    input_tokens: { kind: 'integer', min: 0, max: MAX_TOKEN_TOTAL },
    output_tokens: { kind: 'integer', min: 0, max: MAX_TOKEN_TOTAL },
  },
  'run.compacted': { mechanism: enumField(USAGE_STATISTICS_COMPACTION_MECHANISMS) },
} as const satisfies Record<string, Record<string, UsageStatisticsFieldSpec>>

export type UsageStatisticsEventName = keyof typeof USAGE_STATISTICS_EVENT_FIELDS

/** `install.active` fields that are optional: feature flags and catalog lists. */
export const USAGE_STATISTICS_OPTIONAL_INSTALL_ACTIVE_FIELDS: ReadonlySet<string> = new Set([
  ...USAGE_STATISTICS_FEATURE_FLAGS,
  'mcp_servers',
  'skills',
])

export type UsageStatisticsValue = boolean | number | string | readonly string[]

export interface UsageStatisticsEvent {
  readonly name: UsageStatisticsEventName
  /** UTC day the event describes, `YYYY-MM-DD`. There is never a time of day. */
  readonly day: string
  readonly properties: Readonly<Record<string, UsageStatisticsValue>>
}

export interface UsageStatisticsContext {
  readonly version: string
  readonly build_channel: (typeof USAGE_STATISTICS_BUILD_CHANNELS)[number]
  readonly update_channel: (typeof USAGE_STATISTICS_UPDATE_CHANNELS)[number]
  readonly os: (typeof USAGE_STATISTICS_OPERATING_SYSTEMS)[number]
  readonly arch: (typeof USAGE_STATISTICS_ARCHITECTURES)[number]
}

/** The JSON body the app POSTs to {@link USAGE_STATISTICS_EVENTS_PATH}. */
export interface UsageStatisticsRequest {
  readonly schema: typeof USAGE_STATISTICS_SCHEMA_VERSION
  readonly context: UsageStatisticsContext
  readonly events: readonly UsageStatisticsEvent[]
}
