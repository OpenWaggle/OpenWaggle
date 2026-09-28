import { SessionId, SupportedModelId } from '@shared/types/brand'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../broadcast', () => ({ broadcastToWindows: vi.fn() }))

import {
  clearStreamBuffer,
  projectWorktreeLaunchProgress,
  startStreamBuffer,
} from '../stream-bridge'

const SESSION_ID = SessionId('session-launch')

function stepsAfter(...progress: Parameters<typeof projectWorktreeLaunchProgress>[1][]) {
  let launch: ReturnType<typeof projectWorktreeLaunchProgress> | null = null
  for (const entry of progress) launch = projectWorktreeLaunchProgress(SESSION_ID, entry)
  return (launch?.steps ?? []).map((step) => [step.label, step.completedAt !== undefined])
}

describe('launch steps', () => {
  beforeEach(() => {
    clearStreamBuffer(SESSION_ID)
    startStreamBuffer(SESSION_ID, SupportedModelId('openai/gpt-5.5'), 'classic')
  })

  it('closes the previous step when a sequential worktree step starts', () => {
    expect(
      stepsAfter(
        { stage: 'preparing-workspace', label: 'Preparing', details: [] },
        { stage: 'fetching-base', label: 'Pulling latest main from origin', details: [] },
        { stage: 'checking-out-files', label: 'Creating worktree', details: [] },
      ),
    ).toEqual([
      ['Preparing', true],
      ['Pulling latest main from origin', true],
      ['Creating worktree', false],
    ])
  })

  it('keeps parallel local steps open until each one reports it finished', () => {
    const progress = [
      { stage: 'syncing-branch', label: 'Pulling', parallel: true, details: [] },
      { stage: 'connecting-tools', label: 'Connecting', parallel: true, details: [] },
      { stage: 'connecting-tools', completesStep: true, details: [] },
    ] as const
    expect(stepsAfter(...progress)).toEqual([
      ['Pulling', false],
      ['Connecting', true],
    ])
  })

  it('closes every open step on a completion stage and does not repeat a step', () => {
    expect(
      stepsAfter(
        { stage: 'checking-out-files', label: 'Creating worktree', details: ['a'] },
        { stage: 'checking-out-files', label: 'Creating worktree', details: ['b'] },
        { stage: 'worktree-created', details: [] },
      ),
    ).toEqual([['Creating worktree', true]])
  })

  it('keeps the latest started stage when a parallel step closes', () => {
    projectWorktreeLaunchProgress(SESSION_ID, {
      stage: 'syncing-branch',
      label: 'Pulling',
      parallel: true,
      details: [],
    })
    projectWorktreeLaunchProgress(SESSION_ID, {
      stage: 'connecting-tools',
      label: 'Connecting',
      parallel: true,
      details: [],
    })
    const launch = projectWorktreeLaunchProgress(SESSION_ID, {
      stage: 'syncing-branch',
      completesStep: true,
      details: [],
    })
    expect(launch.stage).toBe('connecting-tools')
    expect(launch.status).toBe('running')
  })
})
