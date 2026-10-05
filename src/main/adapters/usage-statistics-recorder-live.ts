/**
 * The Usage statistics recorder port, backed by this process's recorder (see
 * usage-statistics-recorder.ts). At Run start it reads the Session's facts in one indexed
 * lookup, so classic Runs and explicit Waggles report the same flags. Their start mode takes the
 * Run override, Session mode, execution ceiling and global default from here; the project default
 * joins later, from the project config (`noteUsageStatisticsRunProjectDefault`: the Run executor
 * for classic Runs, the Pi adapter for explicit Waggles).
 */
import * as SqlClient from '@effect/sql/SqlClient'
import { isAgentAuthorizationMode } from '@shared/types/agent-authorization'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import {
  UsageStatisticsRecorder,
  type UsageStatisticsRecorderShape,
  type UsageStatisticsRunStart,
} from '../ports/usage-statistics-recorder'
import { AppDatabaseLive } from '../services/database-service'
import { getSettings } from '../store/settings'
import { isUsageStatisticsEnabled } from '../usage-statistics/usage-statistics-enablement'
import { recordUsageStatistics } from '../usage-statistics/usage-statistics-recorder'
import {
  markUsageStatisticsRunStart,
  recordUsageStatisticsRunFinished,
  recordUsageStatisticsRunStarted,
} from '../usage-statistics/usage-statistics-runs'
import { FetchUsageStatisticsTransportLive } from './fetch-usage-statistics-transport'
import {
  loadUsageStatisticsSessionFacts,
  type UsageStatisticsSessionFacts,
} from './sqlite-usage-statistics-facts'

/** The global default from the in-memory Settings; never reads the database or a file. */
function globalDefaultAuthorizationMode() {
  try {
    const mode = getSettings().defaultAuthorizationMode
    return isAgentAuthorizationMode(mode) ? mode : null
  } catch {
    return null
  }
}

function recordStart(start: UsageStatisticsRunStart, facts: UsageStatisticsSessionFacts | null) {
  recordUsageStatisticsRunStarted({
    runId: start.runId,
    originCallerId: start.originCallerId,
    waggle: start.waggle,
    attachments: start.attachments,
    access: {
      ceiling: facts?.authorizationCeiling ?? null,
      runOverride: start.runAuthorizationOverride,
      sessionMode: facts?.sessionAuthorizationMode ?? null,
      globalDefault: globalDefaultAuthorizationMode(),
    },
    worktree: facts?.worktree ?? false,
    workerSession: facts?.workerSession ?? false,
  })
}

export function makeUsageStatisticsRecorder(
  sql: SqlClient.SqlClient,
): UsageStatisticsRecorderShape {
  return {
    record: (observation) => Effect.sync(() => recordUsageStatistics(observation)),
    runStarted: (start) =>
      Effect.suspend(() => {
        if (!isUsageStatisticsEnabled()) return Effect.void
        markUsageStatisticsRunStart(start.runId)
        return loadUsageStatisticsSessionFacts(start.sessionId).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
          Effect.catchAllCause(() => Effect.succeed(null)),
          Effect.map((facts) => recordStart(start, facts)),
        )
      }).pipe(Effect.catchAllCause(() => Effect.void)),
    runFinished: (finish) =>
      Effect.sync(() => recordUsageStatisticsRunFinished(finish)).pipe(
        Effect.catchAllCause(() => Effect.void),
      ),
  }
}

export const UsageStatisticsRecorderLive = Layer.effect(
  UsageStatisticsRecorder,
  Effect.map(SqlClient.SqlClient, makeUsageStatisticsRecorder),
).pipe(Layer.provide(AppDatabaseLive))

/** Everything the app provides for Usage statistics: the recorder and the endpoint transport. */
export const UsageStatisticsServicesLive = Layer.mergeAll(
  UsageStatisticsRecorderLive,
  FetchUsageStatisticsTransportLive,
)
