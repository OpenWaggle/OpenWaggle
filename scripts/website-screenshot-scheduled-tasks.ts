import type { Page } from '@playwright/test'
import type { ScheduledTaskInput } from '@shared/types/scheduled-task'
import type { OpenWaggleApi } from '@shared/types/ipc'

declare global {
  interface Window {
    readonly api: OpenWaggleApi
  }
}

const HEARTBEAT_EVERY_MINUTES = 60
const MORNING_TRIAGE_AT = '09:00'
const LATE_MORNING_TRIAGE_AT = '10:00'
const MINUTES_PER_HOUR = 60
/** Keep a daily Launch schedule this far from now, so it cannot fire during a capture run. */
const LAUNCH_SAFETY_MINUTES = 45
const WEEKDAYS = [1, 2, 3, 4, 5] as const

function minutesOfDay(hhmm: string) {
  const [hours = 0, minutes = 0] = hhmm.split(':').map(Number)
  return hours * MINUTES_PER_HOUR + minutes
}

/** The morning triage time, moved an hour later when the capture runs right around it. */
export function morningTriageTime(now: Date) {
  const current = now.getHours() * MINUTES_PER_HOUR + now.getMinutes()
  const distance = Math.abs(minutesOfDay(MORNING_TRIAGE_AT) - current)
  return distance < LAUNCH_SAFETY_MINUTES ? LATE_MORNING_TRIAGE_AT : MORNING_TRIAGE_AT
}

/**
 * Scheduled tasks the Scheduled panel and the Queen's Summary show. Created through the app's own
 * API, so the Host validates and schedules them as it would a user's; none is due during a run.
 */
export function scheduledTaskFixtures(input: {
  readonly queenSessionId: string
  readonly projectPath: string
  readonly now: Date
}): readonly ScheduledTaskInput[] {
  return [
    {
      name: 'Check CI on the release branch',
      prompt: 'Check the CI run for the release branch and tell me when every job is green.',
      enabled: true,
      schedule: { kind: 'interval', everyMinutes: HEARTBEAT_EVERY_MINUTES },
      target: { kind: 'heartbeat', sessionId: input.queenSessionId },
    },
    {
      name: 'Morning issue triage',
      prompt: 'Triage the issues opened since yesterday and label the ones ready for an agent.',
      enabled: true,
      schedule: { kind: 'daily', at: morningTriageTime(input.now), weekdays: WEEKDAYS },
      target: {
        kind: 'launch',
        projectPath: input.projectPath,
        workspace: 'new-worktree',
        archiveFinishedSessions: true,
      },
    },
    {
      name: 'Watch the docs deploy',
      prompt: 'Check that the documentation site deployed and its links resolve.',
      enabled: false,
      schedule: { kind: 'interval', everyMinutes: HEARTBEAT_EVERY_MINUTES },
      target: { kind: 'heartbeat', sessionId: input.queenSessionId },
    },
  ]
}

export async function createScheduledTasks(page: Page, tasks: readonly ScheduledTaskInput[]) {
  console.info('[website-shots] creating scheduled tasks')
  const rejections = await page.evaluate(async (inputs) => {
    const refused: string[] = []
    for (const input of inputs) {
      const outcome = await window.api.executeScheduledTasks({ operation: 'create', input })
      if (outcome.effect !== 'created') refused.push(`${input.name}: ${JSON.stringify(outcome)}`)
    }
    return refused
  }, tasks)
  if (rejections.length > 0) {
    throw new Error(`The Host refused the Scheduled task fixtures: ${rejections.join(' | ')}`)
  }
}
