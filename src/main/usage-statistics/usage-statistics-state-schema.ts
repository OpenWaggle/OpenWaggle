/**
 * Decoders for the two local Usage statistics files. A file that fails to decode is not repaired
 * field by field: its owner logs the reason and starts again (see usage-statistics-json-file.ts).
 * Every day, whether a key or a value, must be a real `YYYY-MM-DD` UTC day.
 */
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import {
  USAGE_STATISTICS_ACCESS_MODES,
  USAGE_STATISTICS_COMPACTION_MECHANISMS,
  USAGE_STATISTICS_ENTRY_POINTS,
  USAGE_STATISTICS_FEATURE_FLAGS,
  USAGE_STATISTICS_RUN_RESULTS,
  USAGE_STATISTICS_THINKING_LEVELS,
} from '@shared/usage-statistics/contract'
import { usageStatisticsEpochDay } from '@shared/usage-statistics/validation'
import {
  USAGE_STATISTICS_STATE_SCHEMA_VERSION,
  type UsageStatisticsHostState,
} from '../domain/usage-statistics/usage-statistics-host-state'
import type { UsageStatisticsDay } from '../domain/usage-statistics/usage-statistics-observations'

const daySchema = Schema.String.pipe(
  Schema.filter(
    (value) => usageStatisticsEpochDay(value) !== undefined || 'expected a YYYY-MM-DD day',
  ),
)

const runFinishedPropertiesSchema = Schema.Struct({
  entry_point: Schema.Literal(...USAGE_STATISTICS_ENTRY_POINTS),
  provider: Schema.String,
  model: Schema.String,
  thinking_level: Schema.Literal(...USAGE_STATISTICS_THINKING_LEVELS),
  access_mode: Schema.Literal(...USAGE_STATISTICS_ACCESS_MODES),
  waggle: Schema.Boolean,
  result: Schema.Literal(...USAGE_STATISTICS_RUN_RESULTS),
  duration_s: Schema.Number,
  input_tokens: Schema.Number,
  output_tokens: Schema.Number,
})

const queuedEventSchema = Schema.Union(
  Schema.Struct({ name: Schema.Literal('run.finished'), properties: runFinishedPropertiesSchema }),
  Schema.Struct({
    name: Schema.Literal('run.compacted'),
    properties: Schema.Struct({
      mechanism: Schema.Literal(...USAGE_STATISTICS_COMPACTION_MECHANISMS),
    }),
  }),
)

const dayObservationsSchema = Schema.Struct({
  ranRun: Schema.Boolean,
  entryPoints: Schema.Array(Schema.Literal(...USAGE_STATISTICS_ENTRY_POINTS)),
  features: Schema.Array(Schema.Literal(...USAGE_STATISTICS_FEATURE_FLAGS)),
  mcpServers: Schema.Array(Schema.String),
  skills: Schema.Array(Schema.String),
  extensionsEnabled: Schema.NullOr(Schema.Number),
  appOpened: Schema.Number,
  updates: Schema.Array(Schema.String),
  events: Schema.Array(queuedEventSchema),
  providerConnected: Schema.Boolean,
  projectOpened: Schema.Boolean,
})

const daysSchema = Schema.Record({ key: daySchema, value: dayObservationsSchema })

const hostStateSchema = Schema.Struct({
  schemaVersion: Schema.Literal(USAGE_STATISTICS_STATE_SCHEMA_VERSION),
  install: Schema.Struct({
    firstSeenDay: Schema.NullOr(daySchema),
    evidenceChecked: Schema.Boolean,
    evidenceFailures: Schema.Number,
    newReported: Schema.Boolean,
    onboardingReported: Schema.Boolean,
    lastActiveDay: Schema.NullOr(daySchema),
    lastLaunchedVersion: Schema.NullOr(Schema.String),
  }),
  reporting: Schema.Struct({
    closedThroughDay: Schema.NullOr(daySchema),
    closedDays: Schema.Array(daySchema),
    inFlightDay: Schema.NullOr(daySchema),
  }),
  days: daysSchema,
})

const guiSpoolSchema = Schema.Struct({
  schemaVersion: Schema.Literal(USAGE_STATISTICS_STATE_SCHEMA_VERSION),
  days: daysSchema,
})

/** Observations the GUI main process recorded; only it writes this file. */
export interface UsageStatisticsGuiSpool {
  readonly schemaVersion: typeof USAGE_STATISTICS_STATE_SCHEMA_VERSION
  readonly days: Readonly<Record<string, UsageStatisticsDay>>
}

export const EMPTY_USAGE_STATISTICS_GUI_SPOOL: UsageStatisticsGuiSpool = {
  schemaVersion: USAGE_STATISTICS_STATE_SCHEMA_VERSION,
  days: {},
}

export function decodeUsageStatisticsHostState(value: unknown): UsageStatisticsHostState {
  return decodeUnknownOrThrow(hostStateSchema, value)
}

export function decodeUsageStatisticsGuiSpool(value: unknown): UsageStatisticsGuiSpool {
  return decodeUnknownOrThrow(guiSpoolSchema, value)
}
