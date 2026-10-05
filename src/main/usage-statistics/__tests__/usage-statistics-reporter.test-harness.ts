/** Shared fixtures for the Usage statistics reporter tests: an in-memory state file and fakes. */
import {
  USAGE_STATISTICS_SCHEMA_VERSION,
  type UsageStatisticsContext,
  type UsageStatisticsRequest,
} from '@shared/usage-statistics/contract'
import {
  usageStatisticsEpochDay,
  validateUsageStatisticsContext,
  validateUsageStatisticsEvent,
} from '@shared/usage-statistics/validation'
import * as Effect from 'effect/Effect'
import { expect } from 'vitest'
import {
  INITIAL_USAGE_STATISTICS_HOST_STATE,
  type UsageStatisticsHostState,
} from '../../domain/usage-statistics/usage-statistics-host-state'
import {
  applyUsageStatisticsObservation,
  EMPTY_USAGE_STATISTICS_DAY,
  type UsageStatisticsDay,
  type UsageStatisticsObservation,
} from '../../domain/usage-statistics/usage-statistics-observations'
import type { UsageStatisticsDelivery } from '../../ports/usage-statistics-transport'
import type { UsageStatisticsJsonFile } from '../usage-statistics-json-file'
import {
  reportCompletedUsageStatisticsDays,
  type UsageStatisticsReporterDependencies,
} from '../usage-statistics-reporter'

export const CONTEXT: UsageStatisticsContext = {
  version: '1.0.0',
  build_channel: 'stable',
  update_channel: 'stable',
  os: 'linux',
  arch: 'x64',
}
export const NOW = Date.parse('2026-10-03T08:00:00.000Z')
export const ACCEPTED: UsageStatisticsDelivery = { outcome: 'accepted', status: 202 }

export function day(observations: readonly UsageStatisticsObservation[]): UsageStatisticsDay {
  return observations.reduce<UsageStatisticsDay>(
    applyUsageStatisticsObservation,
    EMPTY_USAGE_STATISTICS_DAY,
  )
}

export const ACTIVE = day([{ kind: 'run-started', entryPoint: 'app' }])
export const OPENED = day([{ kind: 'app-opened' }])

/** In-memory file whose `persisted()` is what a crash would leave on disk. */
export function memoryFile(
  initial: UsageStatisticsHostState,
  options: { readonly failingFlush?: (flushNumber: number) => boolean } = {},
): UsageStatisticsJsonFile<UsageStatisticsHostState> & {
  readonly persisted: () => UsageStatisticsHostState
} {
  let current = initial
  let persisted = initial
  let flushes = 0
  return {
    read: () => current,
    update: (change) => {
      current = change(current)
    },
    flush: async () => {
      flushes += 1
      if (options.failingFlush?.(flushes)) throw new Error('disk full')
      persisted = current
    },
    flushSync: () => {
      persisted = current
    },
    persisted: () => persisted,
  }
}

export function harness(input: {
  readonly state: UsageStatisticsHostState
  readonly guiDays?: Readonly<Record<string, UsageStatisticsDay>>
  readonly deliveries?: readonly UsageStatisticsDelivery[]
  /** When local data says the profile was first used; a day means its noon UTC. */
  readonly evidenceDay?: string | null
  readonly now?: number
  readonly failingFlush?: (flushNumber: number) => boolean
}) {
  const file = memoryFile(
    input.state,
    input.failingFlush ? { failingFlush: input.failingFlush } : {},
  )
  const requests: UsageStatisticsRequest[] = []
  const inFlightOnDisk: (string | null)[] = []
  const deliveries = [...(input.deliveries ?? [])]
  const dependencies: UsageStatisticsReporterDependencies = {
    file,
    readGuiDays: () => input.guiDays ?? {},
    send: (request) =>
      Effect.sync(() => {
        requests.push(request)
        inFlightOnDisk.push(file.persisted().reporting.inFlightDay)
        return deliveries.shift() ?? ACCEPTED
      }),
    context: () => Effect.succeed(CONTEXT),
    installEvidenceTime: () =>
      Effect.succeed(input.evidenceDay ? Date.parse(`${input.evidenceDay}T12:00:00.000Z`) : null),
    isEnabled: () => true,
    now: () => input.now ?? NOW,
  }
  return { file, requests, inFlightOnDisk, dependencies }
}

export function report(dependencies: UsageStatisticsReporterDependencies) {
  return Effect.runPromise(reportCompletedUsageStatisticsDays(dependencies))
}

export function names(requests: readonly UsageStatisticsRequest[]) {
  return requests.map((request) => request.events.map((event) => `${event.name}@${event.day}`))
}

export function expectValidRequests(
  requests: readonly UsageStatisticsRequest[],
  today = '2026-10-03',
) {
  const todayEpochDay = usageStatisticsEpochDay(today) ?? 0
  for (const request of requests) {
    expect(request.schema).toBe(USAGE_STATISTICS_SCHEMA_VERSION)
    expect(validateUsageStatisticsContext(request.context).ok).toBe(true)
    for (const event of request.events) {
      expect(validateUsageStatisticsEvent(event, todayEpochDay).ok).toBe(true)
    }
  }
}

export function hostState(input: {
  readonly install?: Partial<UsageStatisticsHostState['install']>
  readonly reporting?: Partial<UsageStatisticsHostState['reporting']>
  readonly days?: UsageStatisticsHostState['days']
}): UsageStatisticsHostState {
  return {
    ...INITIAL_USAGE_STATISTICS_HOST_STATE,
    install: {
      ...INITIAL_USAGE_STATISTICS_HOST_STATE.install,
      firstSeenDay: '2026-10-01',
      evidenceChecked: true,
      ...input.install,
    },
    reporting: { ...INITIAL_USAGE_STATISTICS_HOST_STATE.reporting, ...input.reporting },
    days: input.days ?? {},
  }
}

export const REPORTED = { newReported: true, onboardingReported: true }
