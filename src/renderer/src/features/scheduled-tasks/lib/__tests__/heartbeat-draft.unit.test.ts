import { describe, expect, it } from 'vitest'
import { heartbeatSettings, heartbeatTask } from '@/test-utils/scheduled-task-fixtures'
import { STOP_CONDITION_DRAFT_ERROR } from '../heartbeat-draft'
import { draftFromTask, newTaskDraft, taskInputFromDraft, taskPatchFromDraft } from '../task-draft'

const base = {
  ...newTaskDraft({ kind: 'heartbeat', timeZone: 'UTC' }),
  name: 'Babysit CI',
  prompt: 'Fix failing checks.',
  sessionId: 'session-1',
}

describe('Heartbeat editor draft', () => {
  it('needs a way to finish: a Stop condition, an end, a run limit, or Runs indefinitely', () => {
    expect(taskInputFromDraft(base)).toEqual({ ok: false, error: STOP_CONDITION_DRAFT_ERROR })
    for (const end of [
      { stopWhen: 'PR 42 merged' },
      { indefinite: true },
      { maxRuns: '4' },
      { endDate: '2030-01-01' },
    ]) {
      expect(taskInputFromDraft({ ...base, ...end }).ok).toBe(true)
    }
  })

  it('sends the Wake check, idle threshold and the Heartbeat own model', () => {
    const result = taskInputFromDraft({
      ...base,
      stopWhen: ' PR 42 merged ',
      wakeCommand: ' gh pr checks 42 | grep fail ',
      wakeOnFailure: 'skip',
      idlePauseAfter: '5',
      modelId: 'anthropic/haiku',
      thinkingLevel: 'low',
    })
    expect(result.ok && result.value).toMatchObject({
      target: {
        kind: 'heartbeat',
        sessionId: 'session-1',
        modelId: 'anthropic/haiku',
        thinkingLevel: 'low',
      },
      heartbeat: {
        stopWhen: 'PR 42 merged',
        indefinite: false,
        idlePauseAfter: 5,
        wakeCheck: { command: 'gh pr checks 42 | grep fail', onFailure: 'skip' },
      },
    })
    expect(taskInputFromDraft({ ...base, stopWhen: 'x', idlePauseAfter: '21' })).toMatchObject({
      ok: false,
      error: expect.stringContaining('1 to 20'),
    })
  })

  it('never sends an unchanged Wake check, so an edit does not approve one it did not touch', () => {
    const task = heartbeatTask({
      heartbeat: heartbeatSettings({
        wakeCheck: {
          command: 'gh pr checks 42',
          onFailure: 'wake',
          approval: 'pending',
          pendingSince: 1,
        },
      }),
    })
    const draft = draftFromTask(task)
    expect(draft).toMatchObject({ wakeCommand: 'gh pr checks 42', stopWhen: 'CI is green on main' })
    const renamed = taskPatchFromDraft({ ...draft, name: 'Renamed' }, task)
    expect(renamed.ok && renamed.value.heartbeat).not.toHaveProperty('wakeCheck')
    const changed = taskPatchFromDraft({ ...draft, wakeCommand: 'gh pr checks 43' }, task)
    expect(changed.ok && changed.value.heartbeat?.wakeCheck).toEqual({
      command: 'gh pr checks 43',
      onFailure: 'wake',
    })
    const removed = taskPatchFromDraft({ ...draft, wakeCommand: '' }, task)
    expect(removed.ok && removed.value.heartbeat?.wakeCheck).toBeNull()
  })
})
