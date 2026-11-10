import { match } from '@diegogbrisa/ts-match'
import type {
  DesktopNotificationCategory,
  DesktopNotificationReason,
  DesktopNotificationSettings,
} from '@shared/types/desktop-notification'
import { DESKTOP_NOTIFICATION_CATEGORY_PRIORITY } from '@shared/types/desktop-notification'
import type { ScheduledTaskNotificationPolicy } from '@shared/types/scheduled-task'
import type { SessionRunTerminalStatus } from '@shared/types/session-host-event'

/**
 * Who started a Run, by its Message provenance: the person (in the app, or from their own CLI
 * outside an agent Run), a Scheduled task, or another agent, which is waiting for the result.
 */
export type DesktopNotificationRunOrigin =
  | { readonly kind: 'person' }
  | { readonly kind: 'agent' }
  | { readonly kind: 'scheduled-task'; readonly policy: ScheduledTaskNotificationPolicy }

export interface DesktopNotificationCandidate {
  readonly category: DesktopNotificationCategory
  readonly reason: DesktopNotificationReason
}

/** What a notification is about, for mutes: its Session and that Session's project. */
export interface DesktopNotificationSubject {
  readonly sessionId: string | null
  readonly projectPath: string | null
}

const GUI_CALLER_ID = 'gui:local-user'
const LOCAL_USER_CALLER_PREFIX = 'local-user:'

/**
 * The person is the desktop app's caller or the plain local-user credential (their own CLI). An
 * agent inside OpenWaggle, an MCP client and anything with a named access profile is an agent.
 */
export function desktopNotificationOriginOfCaller(
  callerId: string,
): Exclude<DesktopNotificationRunOrigin, { readonly kind: 'scheduled-task' }> {
  return callerId === GUI_CALLER_ID || callerId.startsWith(LOCAL_USER_CALLER_PREFIX)
    ? { kind: 'person' }
    : { kind: 'agent' }
}

function candidate(
  category: DesktopNotificationCategory,
  reason: DesktopNotificationReason,
): DesktopNotificationCandidate {
  return { category, reason }
}

/** The notification a settled Run is due, before settings and origin; null for none. */
export function runSettlementCandidate(
  terminalStatus: SessionRunTerminalStatus | 'interrupted-by-host-loss',
): DesktopNotificationCandidate | null {
  return (
    match(terminalStatus)
      .with('completed', () => candidate('ready-to-read', 'completed'))
      .with('failed', () => candidate('failed-or-interrupted', 'failed'))
      .with('interrupted-by-interaction-timeout', () =>
        candidate('failed-or-interrupted', 'interaction-timeout'),
      )
      .with('interrupted-by-host-loss', () => candidate('failed-or-interrupted', 'host-loss'))
      // The person stopped it, so they were there.
      .with('interrupted', () => null)
      .exhaustive()
  )
}

function isMuted(settings: DesktopNotificationSettings, subject: DesktopNotificationSubject) {
  return (
    (subject.sessionId !== null && settings.mutedSessionIds.includes(subject.sessionId)) ||
    (subject.projectPath !== null && settings.mutedProjectPaths.includes(subject.projectPath))
  )
}

/**
 * Whether the person's settings let a candidate through. A category switched off is silent
 * everywhere; a Notification mute silences everything but Needs you.
 */
export function desktopNotificationPermitted(
  settings: DesktopNotificationSettings,
  candidate: DesktopNotificationCandidate,
  subject: DesktopNotificationSubject,
) {
  if (!settings.enabled || !settings.categories[candidate.category]) return false
  return candidate.category === 'needs-you' || !isMuted(settings, subject)
}

/**
 * Whether who started the Run lets a candidate through. Needs you notifies whoever started it;
 * the rest only for the person and Scheduled tasks, whose "failures only" policy silences Ready
 * to read. An authority skip is not a Run and is not filtered here.
 */
export function desktopNotificationOriginPermits(
  origin: DesktopNotificationRunOrigin,
  candidate: DesktopNotificationCandidate,
) {
  if (candidate.category === 'needs-you') return true
  if (origin.kind === 'agent') return false
  if (origin.kind === 'scheduled-task' && origin.policy === 'failures-only') {
    return candidate.category !== 'ready-to-read'
  }
  return true
}

/**
 * A newer notification replaces the one standing for the same target, so it always says what
 * happened last, except that nothing less urgent displaces a Needs you: it stands until its
 * request is answered or its Worker is no longer Stuck.
 */
export function desktopNotificationReplaces(
  standing: DesktopNotificationCategory | null,
  next: DesktopNotificationCategory,
) {
  if (standing !== 'needs-you') return true
  return (
    DESKTOP_NOTIFICATION_CATEGORY_PRIORITY[next] >= DESKTOP_NOTIFICATION_CATEGORY_PRIORITY[standing]
  )
}

/** A notification read by visiting its Session: everything except a request still parked. */
export function desktopNotificationReadByVisit(category: DesktopNotificationCategory) {
  return category !== 'needs-you'
}

/** What still runs in a root Session's Hive, as Ready to read needs it (ADR 0065). */
export interface ReadyToReadHiveWork {
  readonly rootRunning: boolean
  readonly workersRunning: boolean
  readonly wakeComing: boolean
  readonly runStartedWhileWorkersRan: boolean
}

/**
 * When a root Session's completed Run is Ready to read (ADR 0065):
 * - `now`: nothing runs in its Hive and no Hive wake is coming, so the work is finished;
 * - `mid-work-answer`: the person asked while Workers ran, so the reply answers that question
 *   now, and the request the Workers serve still waits;
 * - `after-workers`: Workers still run or a wake is coming, so it waits for the Hive to settle.
 *   A Hive wake Run never notifies on its own.
 */
export type ReadyToReadTiming = 'now' | 'mid-work-answer' | 'after-workers'

/** Nothing runs in the Hive and no Hive wake is still coming: the work the person asked is done. */
export function readyToReadHiveSettled(work: ReadyToReadHiveWork) {
  return !work.rootRunning && !work.workersRunning && !work.wakeComing
}

export function readyToReadTiming(
  work: ReadyToReadHiveWork,
  run: { readonly hiveWake: boolean },
): ReadyToReadTiming {
  if (readyToReadHiveSettled(work)) return 'now'
  if (!run.hiveWake && work.runStartedWhileWorkersRan) return 'mid-work-answer'
  return 'after-workers'
}
