import { describe, expect, it, vi } from 'vitest'
import { createWorktreeLaunchEventCollector } from '../worktree-launch-event'

describe('createWorktreeLaunchEventCollector', () => {
  it('retains post-creation details and Setup terminal metadata in the durable event', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_234)
    const collector = createWorktreeLaunchEventCollector()
    collector.record({
      stage: 'checking-out-files',
      details: ['Creating the worktree'],
      worktreePath: '/worktree',
      branch: 'ow/session-1',
      baseRef: 'main',
    })
    collector.record({
      stage: 'worktree-created',
      details: ['Created the worktree'],
      worktreePath: '/worktree',
    })
    collector.record({
      stage: 'worktree-created',
      details: ['Started Setup action "Install dependencies"'],
      setupAction: {
        terminalId: 'setup-install-deps',
        actionId: 'install-deps',
        actionName: 'Install dependencies',
        projectRoot: '/project',
        cwd: '/worktree',
      },
    })
    collector.record({
      stage: 'starting-task',
      details: ['Starting the task in the new worktree'],
    })

    expect(collector.createdEvent()).toEqual({
      type: 'custom',
      name: 'openwaggle.worktree-created',
      timestamp: 1_234,
      value: {
        stage: 'starting-task',
        status: 'complete',
        details: [
          'Creating the worktree',
          'Created the worktree',
          'Started Setup action "Install dependencies"',
          'Starting the task in the new worktree',
        ],
        worktreePath: '/worktree',
        branch: 'ow/session-1',
        baseRef: 'main',
        setupAction: {
          terminalId: 'setup-install-deps',
          actionId: 'install-deps',
          actionName: 'Install dependencies',
          projectRoot: '/project',
          cwd: '/worktree',
        },
      },
    })
    vi.restoreAllMocks()
  })

  it('does not create a durable event before worktree creation', () => {
    const collector = createWorktreeLaunchEventCollector()

    collector.record({ stage: 'preparing-workspace', details: ['Preparing'] })

    expect(collector.createdEvent()).toBeNull()
  })
})
