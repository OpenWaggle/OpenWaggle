import type {
  AutomaticWorktreeRemovalLog,
  AutomaticWorktreeRemovalRun,
} from '@shared/types/worktree-inventory'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { useAutomaticWorktreeRemovalNotice } from '../useAutomaticWorktreeRemovalNotice'

const { getLog, acknowledge, navigate } = vi.hoisted(() => ({
  getLog: vi.fn<() => Promise<AutomaticWorktreeRemovalLog>>(),
  acknowledge: vi.fn(async (_runId: string) => true),
  navigate: vi.fn(),
}))
vi.mock('@/shared/lib/ipc', () => ({
  api: { getAutomaticWorktreeRemovalLog: getLog, acknowledgeAutomaticWorktreeRemoval: acknowledge },
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

const MEGABYTE = 1024 * 1024

const RUN: AutomaticWorktreeRemovalRun = {
  id: 'run-1',
  startedAt: 1,
  finishedAt: 2,
  archivedDays: 30,
  removed: [
    {
      path: '/wt/a',
      projectPath: '/repo',
      branch: 'a',
      sessionTitles: ['A'],
      reclaimableBytes: MEGABYTE,
    },
    {
      path: '/wt/b',
      projectPath: '/repo',
      branch: 'b',
      sessionTitles: ['B'],
      reclaimableBytes: null,
    },
  ],
  failed: [],
}

beforeEach(() => {
  getLog.mockReset()
  acknowledge.mockClear()
  navigate.mockReset()
  useUIStore.getState().clearToast()
})

it('says once what Automatic worktree removal freed, and opens Settings > Worktrees', async () => {
  getLog.mockResolvedValue({ lastCheckedAt: 2, runs: [RUN], unannouncedRunId: 'run-1' })
  renderHook(() => useAutomaticWorktreeRemovalNotice())

  await waitFor(() =>
    expect(useUIStore.getState().toastData).toMatchObject({
      message: 'Automatic removal freed about 1.0 MB (2 worktrees).',
      variant: 'success',
    }),
  )
  expect(acknowledge).toHaveBeenCalledWith('run-1')
  useUIStore.getState().toastData?.action?.onClick?.()
  expect(navigate).toHaveBeenCalledWith({ to: '/settings/$tab', params: { tab: 'worktrees' } })
})

it('claims no size when none of the removed worktrees was measured', async () => {
  const unmeasured = {
    ...RUN,
    removed: RUN.removed.map((removed) => ({ ...removed, reclaimableBytes: null })),
  }
  getLog.mockResolvedValue({ lastCheckedAt: 2, runs: [unmeasured], unannouncedRunId: 'run-1' })
  renderHook(() => useAutomaticWorktreeRemovalNotice())

  await waitFor(() =>
    expect(useUIStore.getState().toastData).toMatchObject({
      message: 'Automatic removal removed 2 worktrees.',
    }),
  )
})

it('leaves the notice to the window that claimed the run', async () => {
  getLog.mockResolvedValue({ lastCheckedAt: 2, runs: [RUN], unannouncedRunId: 'run-1' })
  acknowledge.mockResolvedValueOnce(false)
  renderHook(() => useAutomaticWorktreeRemovalNotice())

  await waitFor(() => expect(acknowledge).toHaveBeenCalledWith('run-1'))
  expect(useUIStore.getState().toastData).toBeNull()
})

it('stays quiet when every run has been announced', async () => {
  getLog.mockResolvedValue({ lastCheckedAt: 2, runs: [RUN], unannouncedRunId: null })
  renderHook(() => useAutomaticWorktreeRemovalNotice())

  await waitFor(() => expect(getLog).toHaveBeenCalled())
  expect(acknowledge).not.toHaveBeenCalled()
  expect(useUIStore.getState().toastData).toBeNull()
})
