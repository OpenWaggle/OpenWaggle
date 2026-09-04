import { WorkingPath } from '@shared/types/brand'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runStackedGitAction: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: { runStackedGitAction: mocks.runStackedGitAction },
}))

vi.mock('@/shell/ui-store', () => ({
  useUIStore: (selector: (state: { readonly showToast: typeof mocks.showToast }) => unknown) =>
    selector({ showToast: mocks.showToast }),
}))

import { useStackedGitActions } from '../useStackedGitActions'

describe('useStackedGitActions commit output', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reports the created commit hash and message to the owning caller', async () => {
    mocks.runStackedGitAction.mockResolvedValue({
      ok: true,
      action: 'commit_push',
      branch: { status: 'unchanged', name: null },
      commitHash: '0123456789abcdef0123456789abcdef01234567',
      changeRequest: null,
    })
    const onCommitCreated = vi.fn()
    const { result } = renderHook(() =>
      useStackedGitActions({
        workingPath: WorkingPath('/repo'),
        onCommitCreated,
      }),
    )

    await act(() =>
      result.current.run('commit_push', {
        commitMessage: 'Preserve the owning session',
        paths: ['src/feature.ts'],
      }),
    )

    expect(onCommitCreated).toHaveBeenCalledWith({
      commitHash: '0123456789abcdef0123456789abcdef01234567',
      title: 'Preserve the owning session',
    })
  })

  it('reports a commit retained by a later failed phase', async () => {
    mocks.runStackedGitAction.mockResolvedValue({
      ok: false,
      phase: 'push',
      code: 'push-failed',
      message: 'Push failed.',
      commitHash: 'fedcba9876543210fedcba9876543210fedcba98',
    })
    const onCommitCreated = vi.fn()
    const { result } = renderHook(() =>
      useStackedGitActions({
        workingPath: WorkingPath('/repo'),
        onCommitCreated,
      }),
    )

    await act(() =>
      result.current.run('commit_push', {
        commitMessage: 'Commit survived push failure',
        paths: ['src/feature.ts'],
      }),
    )

    expect(onCommitCreated).toHaveBeenCalledWith({
      commitHash: 'fedcba9876543210fedcba9876543210fedcba98',
      title: 'Commit survived push failure',
    })
    expect(mocks.showToast).toHaveBeenCalledWith('Push failed.', 'error')
  })
})
