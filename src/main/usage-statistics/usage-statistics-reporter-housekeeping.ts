/**
 * Housekeeping around the Usage statistics reporter's sends: closing a day a previous Host left
 * in flight, pruning the host state, and reading the local evidence of earlier use.
 */
import type {
  UsageStatisticsContext,
  UsageStatisticsRequest,
} from '@shared/usage-statistics/contract'
import { usageStatisticsDay } from '@shared/usage-statistics/validation'
import * as Effect from 'effect/Effect'
import * as Either from 'effect/Either'
import {
  closeUsageStatisticsDay,
  isUsageStatisticsDayClosed,
  isUsageStatisticsDayExpired,
  observationsForDay,
  pruneUsageStatisticsHostState,
  type UsageStatisticsHostState,
} from '../domain/usage-statistics/usage-statistics-host-state'
import {
  recordUsageStatisticsEvidenceFailure,
  seedUsageStatisticsInstall,
} from '../domain/usage-statistics/usage-statistics-install-evidence'
import {
  pruneUsageStatisticsDays,
  type UsageStatisticsDay,
} from '../domain/usage-statistics/usage-statistics-observations'
import { buildUsageStatisticsDayReport } from '../domain/usage-statistics/usage-statistics-report'
import { createLogger } from '../logger'
import type { UsageStatisticsDelivery } from '../ports/usage-statistics-transport'
import type { UsageStatisticsJsonFile } from './usage-statistics-json-file'

const logger = createLogger('usage-statistics')

export interface UsageStatisticsReporterDependencies {
  readonly file: UsageStatisticsJsonFile<UsageStatisticsHostState>
  readonly readGuiDays: () => Readonly<Record<string, UsageStatisticsDay>>
  readonly send: (request: UsageStatisticsRequest) => Effect.Effect<UsageStatisticsDelivery>
  /** The request context, or `undefined` when this platform or build cannot be described. */
  readonly context: () => Effect.Effect<UsageStatisticsContext | undefined, unknown>
  /** When this profile was first used according to data it already keeps (ms), or `null`. */
  readonly installEvidenceTime: () => Effect.Effect<number | null, unknown>
  readonly isEnabled: () => boolean
  readonly now: () => number
}

export function dayReport(
  state: UsageStatisticsHostState,
  guiDays: Readonly<Record<string, UsageStatisticsDay>>,
  day: string,
) {
  return buildUsageStatisticsDayReport({
    day,
    observations: observationsForDay(state.days, guiDays, day),
    install: state.install,
  })
}

/**
 * A marker left by a Host that stopped mid-request: the endpoint may have stored that batch, so
 * the day is closed without sending it again, as if it had been sent.
 */
function abandonInFlightDay(
  state: UsageStatisticsHostState,
  guiDays: Readonly<Record<string, UsageStatisticsDay>>,
  today: string,
) {
  const day = state.reporting.inFlightDay
  if (day === null) return state
  const sendable = !isUsageStatisticsDayClosed(state.reporting, day)
  const report =
    sendable && !isUsageStatisticsDayExpired(day, today) ? dayReport(state, guiDays, day) : null
  logger.warn(
    'A Usage statistics day was in flight when the Session Host stopped; not resending it',
  )
  return closeUsageStatisticsDay(state, day, report)
}

/**
 * Run once when the reporter starts, before any send of its own: closes the day a previous Host
 * left in flight. A marker this Host sets is always cleared or closed by the same attempt.
 */
export function abandonInterruptedUsageStatisticsDay(
  dependencies: Pick<UsageStatisticsReporterDependencies, 'file' | 'readGuiDays' | 'now'>,
) {
  return Effect.gen(function* () {
    if (dependencies.file.read().reporting.inFlightDay === null) return
    const today = usageStatisticsDay(dependencies.now())
    const guiDays = pruneUsageStatisticsDays(dependencies.readGuiDays(), today)
    dependencies.file.update((state) => abandonInFlightDay(state, guiDays, today))
    yield* Effect.tryPromise(() => dependencies.file.flush()).pipe(
      Effect.catchAll(() => Effect.void),
    )
  })
}

/** Housekeeping before a report: prune, and read the local evidence of earlier use. */
export function prepareHostState(dependencies: UsageStatisticsReporterDependencies, today: string) {
  return Effect.gen(function* () {
    dependencies.file.update((state) => pruneUsageStatisticsHostState(state, today))
    const evidence = yield* readInstallEvidence(dependencies, today)
    const saved = yield* Effect.tryPromise(() => dependencies.file.flush()).pipe(
      Effect.as(true),
      Effect.catchAll(() => Effect.succeed(false)),
    )
    return { saved, evidencePending: evidence === 'pending' }
  })
}

/**
 * Reads the local evidence of earlier use until it is known. While a read fails, the reporter
 * sends nothing, so `install.new` and onboarding wait instead of going out for an Install that
 * may predate statistics; after a few failed reads it gives up and treats the evidence as absent.
 */
function readInstallEvidence(dependencies: UsageStatisticsReporterDependencies, today: string) {
  return Effect.gen(function* () {
    if (dependencies.file.read().install.evidenceChecked) return 'known' as const
    const read = yield* dependencies.installEvidenceTime().pipe(Effect.either)
    if (Either.isRight(read)) {
      dependencies.file.update((state) => seedUsageStatisticsInstall(state, read.right, today))
      return 'known' as const
    }
    logger.warn('Could not read when this Install was first used', {
      cause: String(read.left),
    })
    dependencies.file.update(recordUsageStatisticsEvidenceFailure)
    return dependencies.file.read().install.evidenceChecked
      ? ('known' as const)
      : ('pending' as const)
  })
}
