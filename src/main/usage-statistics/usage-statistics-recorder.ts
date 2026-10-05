/**
 * Records Usage statistics observations for this process.
 *
 * Merging design: each process that observes something owns one file and is its only writer, so
 * no file is ever written by two processes and no lock is needed.
 * - The Session Host owns `host-state.json`: Install markers, the reported-day watermark and its
 *   own observations (Runs, compactions, MCP, skills, extensions, project actions and so on).
 * - The GUI main process owns `gui-observations.json`: what only it sees (app opened, terminal,
 *   browser preview, voice, provider sign-in). The GUI is a single instance per user-data
 *   directory, so this file also has one writer.
 * The Session Host is the only sender. It merges the GUI file into its own day when it reports a
 * completed day and then closes that day. GUI entries for closed days are ignored and age out, so
 * a day is never counted twice, even if the GUI keeps an old day on disk. A process with no
 * recorder configured (CLI commands, tests) records nothing.
 */
import path from 'node:path'
import { usageStatisticsDay } from '@shared/usage-statistics/validation'
import {
  INITIAL_USAGE_STATISTICS_HOST_STATE,
  recoveredUsageStatisticsHostState,
  type UsageStatisticsHostState,
} from '../domain/usage-statistics/usage-statistics-host-state'
import {
  pruneUsageStatisticsDays,
  recordUsageStatisticsObservation,
  type UsageStatisticsObservation,
} from '../domain/usage-statistics/usage-statistics-observations'
import { isUsageStatisticsVersionUpgrade } from '../domain/usage-statistics/usage-statistics-version'
import {
  currentUsageStatisticsEnablement,
  isUsageStatisticsEnabled,
  onUsageStatisticsEnablementChange,
} from './usage-statistics-enablement'
import {
  openUsageStatisticsJsonFile,
  type UsageStatisticsJsonFile,
} from './usage-statistics-json-file'
import {
  decodeUsageStatisticsGuiSpool,
  decodeUsageStatisticsHostState,
  EMPTY_USAGE_STATISTICS_GUI_SPOOL,
  type UsageStatisticsGuiSpool,
} from './usage-statistics-state-schema'

export const USAGE_STATISTICS_DIRECTORY_NAME = 'usage-statistics'
const HOST_STATE_FILE_NAME = 'host-state.json'
export const USAGE_STATISTICS_GUI_SPOOL_FILE_NAME = 'gui-observations.json'

type Recorder =
  | {
      readonly role: 'host'
      readonly file: UsageStatisticsJsonFile<UsageStatisticsHostState>
      readonly directory: string
      readonly appVersion: string
      readonly now: () => number
      readonly unsubscribe: () => void
    }
  | {
      readonly role: 'gui'
      readonly file: UsageStatisticsJsonFile<UsageStatisticsGuiSpool>
      readonly directory: string
      readonly now: () => number
      readonly unsubscribe: () => void
    }

let recorder: Recorder | null = null

export function usageStatisticsGuiSpoolPath(directory: string) {
  return path.join(directory, USAGE_STATISTICS_GUI_SPOOL_FILE_NAME)
}

/** Disabled on purpose (Setting, environment, Dev build), as opposed to Settings not loaded yet. */
function isExplicitlyDisabled() {
  const enablement = currentUsageStatisticsEnablement()
  return !enablement.enabled && enablement.reason !== 'settings-unavailable'
}

/**
 * Turning statistics off deletes everything queued. Install markers stay, because they are never
 * sent on their own and losing them would count this Install as new when statistics return.
 */
function clearHostQueue(state: UsageStatisticsHostState): UsageStatisticsHostState {
  if (Object.keys(state.days).length === 0 && state.install.lastLaunchedVersion === null) {
    return state
  }
  return { ...state, days: {}, install: { ...state.install, lastLaunchedVersion: null } }
}

/**
 * Starts this launch. Only a higher version than the previous launch is an `update.installed`:
 * a downgrade, or a channel switch that installs an older build, is not.
 */
function startHostInstall(state: UsageStatisticsHostState, today: string, appVersion: string) {
  const { install } = state
  const previous = install.lastLaunchedVersion
  const days =
    previous !== null && isUsageStatisticsVersionUpgrade(previous, appVersion)
      ? recordUsageStatisticsObservation(state.days, today, {
          kind: 'update-installed',
          previousVersion: previous,
        })
      : state.days
  return {
    ...state,
    days: pruneUsageStatisticsDays(days, today),
    install: {
      ...install,
      firstSeenDay: install.firstSeenDay ?? today,
      lastLaunchedVersion: appVersion,
    },
  }
}

export function configureUsageStatisticsHostRecorder(input: {
  readonly userDataDirectory: string
  readonly appVersion: string
  readonly now?: () => number
}) {
  recorder?.unsubscribe()
  const directory = path.join(input.userDataDirectory, USAGE_STATISTICS_DIRECTORY_NAME)
  const now = input.now ?? Date.now
  const file = openUsageStatisticsJsonFile({
    filePath: path.join(directory, HOST_STATE_FILE_NAME),
    label: HOST_STATE_FILE_NAME,
    decode: decodeUsageStatisticsHostState,
    initial: INITIAL_USAGE_STATISTICS_HOST_STATE,
    recover: () => recoveredUsageStatisticsHostState(usageStatisticsDay(now())),
  })
  const applyEnablement = (enabled: boolean) => {
    if (enabled) {
      file.update((state) => startHostInstall(state, usageStatisticsDay(now()), input.appVersion))
      return
    }
    if (isExplicitlyDisabled()) file.update(clearHostQueue)
  }
  applyEnablement(isUsageStatisticsEnabled())
  const unsubscribe = onUsageStatisticsEnablementChange(applyEnablement)
  recorder = { role: 'host', file, directory, appVersion: input.appVersion, now, unsubscribe }
}

export function configureUsageStatisticsGuiRecorder(input: {
  readonly userDataDirectory: string
  readonly now?: () => number
}) {
  recorder?.unsubscribe()
  const directory = path.join(input.userDataDirectory, USAGE_STATISTICS_DIRECTORY_NAME)
  const file = openUsageStatisticsJsonFile({
    filePath: usageStatisticsGuiSpoolPath(directory),
    label: USAGE_STATISTICS_GUI_SPOOL_FILE_NAME,
    decode: decodeUsageStatisticsGuiSpool,
    initial: EMPTY_USAGE_STATISTICS_GUI_SPOOL,
  })
  const clear = () => file.update(() => EMPTY_USAGE_STATISTICS_GUI_SPOOL)
  if (isExplicitlyDisabled()) clear()
  const unsubscribe = onUsageStatisticsEnablementChange((enabled) => {
    if (!enabled && isExplicitlyDisabled()) clear()
  })
  recorder = { role: 'gui', file, directory, now: input.now ?? Date.now, unsubscribe }
}

function recordHostObservation(
  state: UsageStatisticsHostState,
  day: string,
  observation: UsageStatisticsObservation,
): UsageStatisticsHostState {
  const days = recordUsageStatisticsObservation(state.days, day, observation)
  if (days === state.days && state.install.firstSeenDay !== null) return state
  return {
    ...state,
    install: { ...state.install, firstSeenDay: state.install.firstSeenDay ?? day },
    days,
  }
}

function recordGuiObservation(
  spool: UsageStatisticsGuiSpool,
  day: string,
  observation: UsageStatisticsObservation,
): UsageStatisticsGuiSpool {
  const days = recordUsageStatisticsObservation(spool.days, day, observation)
  return days === spool.days ? spool : { ...spool, days }
}

/**
 * Records one observation for today, only while statistics are on. An observation that changes
 * nothing (a feature already used today) does not rewrite the file. Never throws.
 */
export function recordUsageStatistics(observation: UsageStatisticsObservation): void {
  const active = recorder
  if (!active || !isUsageStatisticsEnabled()) return
  const day = usageStatisticsDay(active.now())
  if (active.role === 'host') {
    active.file.update((state) => recordHostObservation(state, day, observation))
    return
  }
  active.file.update((spool) => recordGuiObservation(spool, day, observation))
}

/** The Session Host's state file, for its reporter; `null` in every other process. */
export function usageStatisticsHostRecorder() {
  return recorder?.role === 'host'
    ? {
        file: recorder.file,
        guiSpoolPath: usageStatisticsGuiSpoolPath(recorder.directory),
        appVersion: recorder.appVersion,
        now: recorder.now,
      }
    : null
}

/** Writes pending observations now. Logs a failure instead of throwing. */
export async function flushUsageStatistics(): Promise<void> {
  await recorder?.file.flush().catch(() => undefined)
}

/** Writes pending observations before the process exits. */
export function flushUsageStatisticsSync(): void {
  recorder?.file.flushSync()
}

export async function resetUsageStatisticsRecorderForTests(): Promise<void> {
  const active = recorder
  recorder = null
  active?.unsubscribe()
  await active?.file.flush().catch(() => undefined)
}
