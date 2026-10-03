/**
 * The Session Host's Usage statistics reporter: at startup and then hourly, while statistics are
 * on, it sends every completed UTC day as one batch, at most once.
 *
 * At most once: a batch is sent only after its day is saved on disk as in flight; when that
 * write fails, the marker is rolled back and the day waits for a later attempt. The day is
 * closed, and never sent again, once the endpoint stored the batch, rejected it, or the outcome
 * is unknown (a timeout, a reset, or a Host that stopped mid-request, whose marker the next Host
 * finds when it starts). Only an answer saying nothing was stored (5xx or 429), or a request that
 * never left this machine, keeps the day for a retry with backoff.
 */
import {
  USAGE_STATISTICS_MAX_REQUEST_BYTES,
  USAGE_STATISTICS_SCHEMA_VERSION,
  type UsageStatisticsContext,
  type UsageStatisticsEvent,
  type UsageStatisticsRequest,
} from '@shared/usage-statistics/contract'
import {
  usageStatisticsDay,
  usageStatisticsEpochDay,
  validateUsageStatisticsEvent,
} from '@shared/usage-statistics/validation'
import * as Effect from 'effect/Effect'
import {
  clearUsageStatisticsInFlightDay,
  closeUsageStatisticsDay,
  markUsageStatisticsDayInFlight,
  reportableUsageStatisticsDays,
  type UsageStatisticsHostState,
} from '../domain/usage-statistics/usage-statistics-host-state'
import { pruneUsageStatisticsDays } from '../domain/usage-statistics/usage-statistics-observations'
import type { UsageStatisticsDayReport } from '../domain/usage-statistics/usage-statistics-report'
import { createLogger } from '../logger'
import type { UsageStatisticsDelivery } from '../ports/usage-statistics-transport'
import {
  abandonInterruptedUsageStatisticsDay,
  dayReport,
  prepareHostState,
  type UsageStatisticsReporterDependencies,
} from './usage-statistics-reporter-housekeeping'

const logger = createLogger('usage-statistics')

export const USAGE_STATISTICS_REPORT_INTERVAL_MS = 3_600_000
export const USAGE_STATISTICS_INITIAL_RETRY_DELAY_MS = 60_000
const RETRY_BACKOFF_FACTOR = 2

export {
  abandonInterruptedUsageStatisticsDay,
  type UsageStatisticsReporterDependencies,
} from './usage-statistics-reporter-housekeeping'

export type UsageStatisticsReportOutcome =
  | { readonly status: 'disabled' }
  | { readonly status: 'unsupported' }
  | { readonly status: 'done'; readonly sentDays: number }
  | { readonly status: 'retry'; readonly sentDays: number; readonly reason: string }

function withinRequestLimit(
  events: readonly UsageStatisticsEvent[],
  context: UsageStatisticsContext,
) {
  const fitted = [...events]
  const size = () =>
    Buffer.byteLength(
      JSON.stringify({ schema: USAGE_STATISTICS_SCHEMA_VERSION, context, events: fitted }),
    )
  // Run events are the only open-ended part of a day; drop the latest ones first.
  while (size() > USAGE_STATISTICS_MAX_REQUEST_BYTES && fitted.at(-1)?.name.startsWith('run.')) {
    fitted.pop()
  }
  return fitted
}

function acceptedEvents(report: UsageStatisticsDayReport, today: string) {
  const todayEpochDay = usageStatisticsEpochDay(today) ?? 0
  return report.events.filter((event) => {
    const validated = validateUsageStatisticsEvent(event, todayEpochDay)
    if (!validated.ok) {
      logger.warn('Dropping a Usage statistics event that fails the contract', {
        event: event.name,
        field: validated.field,
        reason: validated.reason,
      })
    }
    return validated.ok
  })
}

/** Applies `change` and waits until it is on disk; `false` when it could not be saved. */
function persist(
  dependencies: UsageStatisticsReporterDependencies,
  change: (state: UsageStatisticsHostState) => UsageStatisticsHostState,
) {
  dependencies.file.update(change)
  return Effect.tryPromise(() => dependencies.file.flush()).pipe(
    Effect.as(true),
    Effect.catchAll(() => Effect.succeed(false)),
  )
}

function deliverDay(
  dependencies: UsageStatisticsReporterDependencies,
  input: {
    readonly day: string
    readonly report: UsageStatisticsDayReport
    readonly request: UsageStatisticsRequest
  },
) {
  return Effect.gen(function* () {
    const { day, report } = input
    // Without the marker on disk a crash during the request could send the day twice. A marker
    // that could not be saved is rolled back, so no later attempt mistakes it for an interrupted
    // send; the file's own retry then writes the rolled-back state.
    if (!(yield* persist(dependencies, (state) => markUsageStatisticsDayInFlight(state, day)))) {
      dependencies.file.update(clearUsageStatisticsInFlightDay)
      return { kind: 'retry', reason: 'state not saved' } as const
    }
    // A transport defect may come after the request left: its outcome is unknown.
    const delivery = yield* dependencies.send(input.request).pipe(
      Effect.catchAllDefect(() =>
        Effect.succeed<UsageStatisticsDelivery>({
          outcome: 'unknown',
          reason: 'transport defect',
        }),
      ),
    )
    if (delivery.outcome === 'retry') {
      yield* persist(dependencies, clearUsageStatisticsInFlightDay)
      return { kind: 'retry', reason: delivery.reason } as const
    }
    if (delivery.outcome === 'rejected') {
      logger.warn('The statistics endpoint rejected a day; dropping it', {
        status: delivery.status,
        events: input.request.events.length,
      })
    }
    if (delivery.outcome === 'unknown') {
      logger.warn('A Usage statistics day may not have been delivered; not resending it', {
        reason: delivery.reason,
      })
    }
    // What the endpoint may have stored keeps its Install markers, so they are never sent twice.
    const stored = delivery.outcome === 'rejected' ? null : report
    yield* persist(dependencies, (state) => closeUsageStatisticsDay(state, day, stored))
    return { kind: 'closed', sent: delivery.outcome === 'accepted' } as const
  })
}

/** Sends every completed day not reported yet, oldest first. */
export function reportCompletedUsageStatisticsDays(
  dependencies: UsageStatisticsReporterDependencies,
): Effect.Effect<UsageStatisticsReportOutcome, unknown> {
  return Effect.gen(function* () {
    if (!dependencies.isEnabled()) return { status: 'disabled' } as const
    const today = usageStatisticsDay(dependencies.now())
    const guiDays = pruneUsageStatisticsDays(dependencies.readGuiDays(), today)
    const prepared = yield* prepareHostState(dependencies, today)
    if (!prepared.saved) return { status: 'retry', sentDays: 0, reason: 'state not saved' } as const
    if (prepared.evidencePending) {
      return { status: 'retry', sentDays: 0, reason: 'install evidence unavailable' } as const
    }
    const context = yield* dependencies.context()
    if (!context) return { status: 'unsupported' } as const
    const days = reportableUsageStatisticsDays({ state: dependencies.file.read(), guiDays, today })
    let sentDays = 0
    for (const day of days) {
      if (!dependencies.isEnabled()) return { status: 'disabled' } as const
      const report = dayReport(dependencies.file.read(), guiDays, day)
      const events = withinRequestLimit(acceptedEvents(report, today), context)
      if (events.length === 0) {
        yield* persist(dependencies, (state) => closeUsageStatisticsDay(state, day, null))
        continue
      }
      const result = yield* deliverDay(dependencies, {
        day,
        report,
        request: { schema: USAGE_STATISTICS_SCHEMA_VERSION, context, events },
      })
      if (result.kind === 'retry')
        return { status: 'retry', sentDays, reason: result.reason } as const
      if (result.sent) sentDays += 1
    }
    return { status: 'done', sentDays } as const
  })
}

/** Delay before the next attempt: hourly, or exponential backoff after a retryable failure. */
export function nextUsageStatisticsReportDelay(consecutiveFailures: number) {
  if (consecutiveFailures <= 0) return USAGE_STATISTICS_REPORT_INTERVAL_MS
  const backoff =
    USAGE_STATISTICS_INITIAL_RETRY_DELAY_MS * RETRY_BACKOFF_FACTOR ** (consecutiveFailures - 1)
  return Math.min(backoff, USAGE_STATISTICS_REPORT_INTERVAL_MS)
}

/** Reports now and then forever; a failure inside one attempt never stops the loop. */
export function runUsageStatisticsReporter(
  dependencies: UsageStatisticsReporterDependencies & {
    readonly sleep: (milliseconds: number) => Effect.Effect<void>
  },
): Effect.Effect<never> {
  return Effect.gen(function* () {
    yield* abandonInterruptedUsageStatisticsDay(dependencies).pipe(
      Effect.catchAllCause((cause) =>
        Effect.sync(() =>
          logger.warn('Could not close an interrupted Usage statistics day', {
            cause: String(cause),
          }),
        ),
      ),
    )
    let consecutiveFailures = 0
    while (true) {
      const outcome = yield* reportCompletedUsageStatisticsDays(dependencies).pipe(
        Effect.catchAllCause((cause) =>
          Effect.sync(() => {
            logger.warn('Usage statistics report failed', { cause: String(cause) })
            return { status: 'retry', sentDays: 0, reason: 'report failed' } as const
          }),
        ),
      )
      consecutiveFailures = outcome.status === 'retry' ? consecutiveFailures + 1 : 0
      yield* dependencies.sleep(nextUsageStatisticsReportDelay(consecutiveFailures))
    }
  })
}
