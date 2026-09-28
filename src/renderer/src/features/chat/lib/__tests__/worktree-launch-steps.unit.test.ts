import type { WorktreeLaunchSnapshot } from '@shared/types/background-run'
import { describe, expect, it } from 'vitest'
import { launchStepAnnouncement, launchStepViews } from '../worktree-launch-steps'

function launch(overrides: Partial<WorktreeLaunchSnapshot>): WorktreeLaunchSnapshot {
  return {
    status: 'running',
    stage: 'fetching-base',
    startedAt: 1,
    updatedAt: 1,
    details: [],
    steps: [
      {
        stage: 'preparing-workspace',
        label: 'Preparing the session worktree',
        startedAt: 1,
        completedAt: 2,
      },
      { stage: 'fetching-base', label: 'Pulling latest main from origin', startedAt: 2 },
    ],
    ...overrides,
  }
}

const states = (value: WorktreeLaunchSnapshot) =>
  launchStepViews(value)?.map((step) => [step.label, step.state])

describe('launchStepViews', () => {
  it('lists every reported step with open ones active and the task pending', () => {
    expect(states(launch({}))).toEqual([
      ['Preparing the session worktree', 'complete'],
      ['Pulling latest main from origin', 'active'],
      ['Starting task', 'pending'],
    ])
  })

  it('shows parallel steps in progress together', () => {
    expect(
      states(
        launch({
          stage: 'connecting-tools',
          steps: [
            { stage: 'syncing-branch', label: 'Pulling', startedAt: 1 },
            { stage: 'connecting-tools', label: 'Connecting', startedAt: 1 },
          ],
        }),
      ),
    ).toEqual([
      ['Pulling', 'active'],
      ['Connecting', 'active'],
      ['Starting task', 'pending'],
    ])
  })

  it('makes starting the task current once no step is open', () => {
    const closed = launch({
      stage: 'worktree-created',
      steps: [{ stage: 'fetching-base', label: 'Pulling', startedAt: 1, completedAt: 2 }],
    })
    expect(states(closed)?.at(-1)).toEqual(['Starting task', 'active'])
    expect(states({ ...closed, status: 'failed' })?.at(-1)).toEqual(['Starting task', 'failed'])
  })

  it('fails the step that was running and leaves the task pending', () => {
    expect(states(launch({ status: 'failed' }))?.slice(1)).toEqual([
      ['Pulling latest main from origin', 'failed'],
      ['Starting task', 'pending'],
    ])
  })

  it('completes every step when the launch is complete', () => {
    expect(
      states(launch({ status: 'complete', stage: 'starting-task' }))?.every(
        ([, state]) => state === 'complete',
      ),
    ).toBe(true)
  })

  it('leaves unlabelled snapshots from an older Host to the legacy presentation', () => {
    expect(launchStepViews(launch({ steps: undefined }))).toBeNull()
  })

  it('announces the active step, or the failure with its reason', () => {
    const running = launchStepViews(launch({})) ?? []
    expect(launchStepAnnouncement(running, 'Worktree setup failed', '')).toBe(
      'Pulling latest main from origin',
    )
    const failed = launchStepViews(launch({ status: 'failed' })) ?? []
    expect(launchStepAnnouncement(failed, 'Worktree setup failed', 'offline')).toBe(
      'Worktree setup failed: offline',
    )
  })
})
