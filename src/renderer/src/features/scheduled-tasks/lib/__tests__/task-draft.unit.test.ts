import { describe, expect, it } from 'vitest'
import { heartbeatTask, scheduledTask } from '@/test-utils/scheduled-task-fixtures'
import {
  draftFromTask,
  nameFromPrompt,
  newTaskDraft,
  taskInputFromDraft,
  taskPatchFromDraft,
  withDraftKind,
} from '../task-draft'

describe('task editor draft', () => {
  it('defaults a Heartbeat to failures-only and a Launch schedule to every run', () => {
    const heartbeat = newTaskDraft({ kind: 'heartbeat', timeZone: 'Europe/Paris' })
    expect(heartbeat.notificationPolicy).toBe('failures-only')
    expect(heartbeat.schedule.preset).toBe('interval')
    expect(heartbeat.workspace).toBe('new-worktree')

    const launch = withDraftKind(heartbeat, 'launch')
    expect(launch.notificationPolicy).toBe('every-run')
    expect(launch.schedule.preset).toBe('weekdays')
  })

  it('builds a Launch schedule input with only the chosen options', () => {
    const draft = {
      ...newTaskDraft({ kind: 'launch', timeZone: 'Europe/Paris' }),
      name: '  Nightly audit ',
      prompt: 'Audit dependencies.',
      projectPath: '/projects/alpha',
      workspace: 'local' as const,
      thinkingLevel: 'high' as const,
      maxRuns: '10',
    }
    expect(taskInputFromDraft(draft)).toEqual({
      ok: true,
      value: {
        name: 'Nightly audit',
        prompt: 'Audit dependencies.',
        enabled: true,
        schedule: { kind: 'daily', at: '09:00', weekdays: [1, 2, 3, 4, 5] },
        timeZone: 'Europe/Paris',
        endsAt: null,
        maxRuns: 10,
        target: {
          kind: 'launch',
          projectPath: '/projects/alpha',
          workspace: 'local',
          thinkingLevel: 'high',
          archiveFinishedSessions: false,
        },
        notificationPolicy: 'every-run',
      },
    })
  })

  it('reports the first missing field', () => {
    const empty = newTaskDraft({ kind: 'heartbeat', timeZone: 'UTC' })
    expect(taskInputFromDraft(empty)).toEqual({ ok: false, error: 'Write the prompt to deliver.' })
    expect(taskInputFromDraft({ ...empty, name: 'Watch', prompt: 'Check CI' })).toEqual({
      ok: false,
      error: 'Choose the Session to deliver into.',
    })
    expect(
      taskInputFromDraft({
        ...empty,
        name: 'Watch',
        prompt: 'Check',
        sessionId: 's',
        maxRuns: '0',
      }),
    ).toEqual({ ok: false, error: 'Max runs must be a whole number of at least 1.' })
  })

  it('names an unnamed task from the start of its prompt', () => {
    const draft = {
      ...newTaskDraft({ kind: 'heartbeat', timeZone: 'UTC' }),
      prompt: 'Check CI on the PR and stop when it is green.',
      sessionId: 'session-1',
    }
    const result = taskInputFromDraft(draft)
    expect(result.ok && result.value.name).toBe('Check CI on the PR and…')
    expect(nameFromPrompt('Summarize open PRs.')).toBe('Summarize open PRs')
    expect(nameFromPrompt('...\nCheck CI')).toBe('...')
  })

  it('ends on the last moment of the chosen day in the task time zone', () => {
    const draft = {
      ...newTaskDraft({ kind: 'heartbeat', timeZone: 'Pacific/Kiritimati' }),
      name: 'Watch',
      prompt: 'Check CI',
      sessionId: 'session-1',
      endDate: '2026-04-30',
    }
    const result = taskInputFromDraft(draft)
    // Kiritimati is UTC+14, so its midnight starting 1 May is 10:00 UTC on 30 April.
    expect(result.ok && result.value.endsAt).toBe(Date.UTC(2026, 3, 30, 10) - 1)
    const reopened = draftFromTask(
      heartbeatTask({
        timeZone: 'Pacific/Kiritimati',
        endsAt: result.ok ? result.value.endsAt : null,
      }),
    )
    expect(reopened.endDate).toBe('2026-04-30')
  })

  it('round-trips a stored task and leaves a Heartbeat target out of its patch', () => {
    const task = heartbeatTask({ maxRuns: 3 })
    const draft = draftFromTask(task)
    expect(draft).toMatchObject({ sessionId: 'session-1', maxRuns: '3', kind: 'heartbeat' })

    const patch = taskPatchFromDraft({ ...draft, name: 'CI watch (daily)' })
    expect(patch.ok && patch.value).toMatchObject({
      name: 'CI watch (daily)',
      schedule: { kind: 'interval', everyMinutes: 30 },
      maxRuns: 3,
    })
    expect(patch.ok && 'target' in patch.value).toBe(false)
  })

  it('keeps a Launch schedule target in its patch', () => {
    const patch = taskPatchFromDraft(draftFromTask(scheduledTask()))
    expect(patch.ok && patch.value.target).toEqual({
      kind: 'launch',
      projectPath: '/projects/alpha',
      workspace: 'new-worktree',
      archiveFinishedSessions: false,
    })
  })
})
