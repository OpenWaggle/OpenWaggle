import type { Message } from '@shared/types/agent'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runPiAgentKernel } from '../pi-agent-kernel-run'
import {
  EMPTY_RUN_RESULT,
  kernelRunDependencies,
  kernelRunInput,
} from './pi-agent-kernel-run.test-harness'

const runMocks = vi.hoisted(() => ({
  runPiSession: vi.fn(),
  runPiWaggle: vi.fn(),
  sessionsExtensionFactory: vi.fn(),
  createSessionsToolExtension: vi.fn(),
  pullCurrentBranchFastForward: vi.fn(
    async (_path: string, _options?: { readonly signal?: AbortSignal }) => ({
      ok: true,
      message: 'Pulled latest changes.',
    }),
  ),
  resolveTrackedBranch: vi.fn(async () => ({ branch: 'main', upstream: 'origin/main' })),
}))

vi.mock('../../../utils/session-scratch-directory', () => ({
  prepareSessionScratchDirectory: async (sessionId: string) => `/scratch/${sessionId}`,
  retainSessionScratchDirectory: () => async () => undefined,
}))
vi.mock('../agent-kernel/classic-run', () => ({ runPiSession: runMocks.runPiSession }))
vi.mock('../agent-kernel/session-worktree-birth', () => ({
  ensureSessionWorktreeProjectPath: async () => '/repo/worktree',
}))
vi.mock('../agent-kernel/waggle-run', () => ({ runPiWaggle: runMocks.runPiWaggle }))
vi.mock('../sessions-tool-extension', () => ({
  createSessionsToolExtension: runMocks.createSessionsToolExtension,
}))
vi.mock('../../git/remote-sync', () => ({
  pullCurrentBranchFastForward: runMocks.pullCurrentBranchFastForward,
  resolveTrackedBranch: runMocks.resolveTrackedBranch,
}))

describe('runPiAgentKernel launch steps', () => {
  beforeEach(() => {
    for (const mock of Object.values(runMocks)) mock.mockReset()
    runMocks.createSessionsToolExtension.mockReturnValue(runMocks.sessionsExtensionFactory)
    runMocks.resolveTrackedBranch.mockResolvedValue({ branch: 'main', upstream: 'origin/main' })
    runMocks.pullCurrentBranchFastForward.mockResolvedValue({
      ok: true,
      message: 'Pulled latest changes.',
    })
  })

  it('pulls the checked-out branch first, reports it step by step and starts the task after it', async () => {
    runMocks.runPiSession.mockResolvedValue(EMPTY_RUN_RESULT)
    const pull = Promise.withResolvers<{ ok: boolean; message: string }>()
    runMocks.pullCurrentBranchFastForward.mockReturnValue(pull.promise)
    const onWorktreeLaunch = vi.fn()
    const input = kernelRunInput('session-local', { runId: 'run-local', onWorktreeLaunch })

    const running = Effect.runPromise(
      runPiAgentKernel(input, kernelRunDependencies('/visualizations/session-local')),
    )

    await vi.waitFor(() => expect(runMocks.pullCurrentBranchFastForward).toHaveBeenCalledOnce())
    expect(runMocks.pullCurrentBranchFastForward).toHaveBeenCalledWith(
      '/repo/worktree',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(runMocks.runPiSession).not.toHaveBeenCalled()
    pull.resolve({ ok: true, message: 'Pulled latest changes.' })
    await running

    const reported = onWorktreeLaunch.mock.calls.map(([progress]) => progress)
    expect(reported).toEqual(
      expect.arrayContaining([
        {
          stage: 'syncing-branch',
          environment: 'local',
          parallel: true,
          label: 'Pulling latest changes for main',
          details: ['Pulling origin/main into main'],
        },
        { stage: 'syncing-branch', environment: 'local', completesStep: true, details: [] },
      ]),
    )
    // The task starts only once the pull is done.
    expect(reported.at(-2)).toMatchObject({ stage: 'syncing-branch', completesStep: true })
    expect(reported.at(-1)).toEqual({
      stage: 'starting-task',
      environment: 'local',
      details: ['Starting the task'],
    })
  })

  it('reports no launch steps for a later local turn', async () => {
    runMocks.runPiSession.mockResolvedValue(EMPTY_RUN_RESULT)
    const onWorktreeLaunch = vi.fn()
    const input = kernelRunInput('session-local', {
      runId: 'run-later',
      session: { messages: [fromPartial<Message>({ id: 'm-1' })] },
      onWorktreeLaunch,
    })

    await Effect.runPromise(runPiAgentKernel(input, kernelRunDependencies(undefined)))

    expect(onWorktreeLaunch).not.toHaveBeenCalled()
  })
})
