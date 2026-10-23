import type { SessionsToolScheduleAction } from './sessions-tool-schedule'
import type { ToolLabel, Verbs } from './tool-label-parts'

const TASK_NOUN = 'scheduled task'

/** Each Scheduled task action (`sessions-tool-schedule-parameters.ts`) by what it does to a task. */
const SCHEDULE_VERBS: Readonly<
  Record<Exclude<SessionsToolScheduleAction, 'schedule_list'>, Verbs>
> = {
  schedule_read: { running: 'Reading', done: 'Read' },
  schedule_runs: { running: 'Reading the runs of', done: 'Read the runs of' },
  schedule_create: { running: 'Creating', done: 'Created' },
  schedule_update: { running: 'Updating', done: 'Updated' },
  schedule_delete: { running: 'Deleting', done: 'Deleted' },
  schedule_run_now: { running: 'Running', done: 'Ran' },
}

export const SCHEDULE_ACTION_NAMES: readonly string[] = [
  'schedule_list',
  ...Object.keys(SCHEDULE_VERBS),
]

function requested(running: string) {
  return `Requested: ${running.charAt(0).toLowerCase()}${running.slice(1)}`
}

/**
 * "Created scheduled task · Morning triage": the task an action acts on, by the name its result,
 * the task list or its arguments give, and a bare "scheduled task" while none does.
 */
export function scheduleLabel(action: SessionsToolScheduleAction, name: string | null): ToolLabel {
  if (action === 'schedule_list') {
    return {
      running: 'Listing scheduled tasks...',
      done: 'Listed scheduled tasks',
      requested: requested('Listing scheduled tasks'),
    }
  }
  const verbs = SCHEDULE_VERBS[action]
  const phrase = name ? `${TASK_NOUN} · ${name}` : TASK_NOUN
  const running = `${verbs.running} ${phrase}`
  return {
    running: `${running}...`,
    done: `${verbs.done} ${phrase}`,
    requested: requested(running),
  }
}
