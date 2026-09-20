import { SessionId } from '@shared/types/brand'
import type { SessionSummary } from '@shared/types/session'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGitStore } from '@/features/git'
import { api } from '@/shared/lib/ipc'
import { useSessionGitIndicators } from '../useSessionGitIndicators'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getGitStatus: vi.fn(() => new Promise(() => {})),
    onGitWorkingTreeChanged: vi.fn(() => () => {}),
  },
}))

const session: SessionSummary = {
  id: SessionId('git-refresh'),
  title: 'Git refresh',
  projectPath: '/git-refresh-project',
  createdAt: 1,
  updatedAt: 1,
}

describe('Session Git indicator refresh work', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.getGitStatus).mockImplementation(() => new Promise(() => {}))
    useGitStore.setState({ statusByWorkingPath: {} })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('does not enqueue another pending Git read when Sidebar rebuilds the same Session list', async () => {
    const view = renderHook(({ listedSessions }) => useSessionGitIndicators(listedSessions), {
      initialProps: { listedSessions: [session] },
    })
    // Sidebar rebuilds this list when its subscribed Git loading state changes.
    // Cap the reproduction explicitly; no real child process is launched.
    for (let index = 0; index < 10; index += 1) {
      await act(async () => view.rerender({ listedSessions: [{ ...session }] }))
    }
    view.unmount()
    expect(api.getGitStatus).toHaveBeenCalledTimes(1)
    expect(api.onGitWorkingTreeChanged).toHaveBeenCalledTimes(1)
  })

  it('ignores order and duplicate changes but refreshes genuine path changes and tracked events', async () => {
    const other = { ...session, id: SessionId('other'), projectPath: '/other-project' }
    const view = renderHook(({ listedSessions }) => useSessionGitIndicators(listedSessions), {
      initialProps: { listedSessions: [session, other] },
    })
    expect(api.getGitStatus).toHaveBeenCalledTimes(2)
    view.rerender({ listedSessions: [other, { ...session }, other] })
    expect(api.getGitStatus).toHaveBeenCalledTimes(2)

    view.rerender({ listedSessions: [other] })
    expect(api.getGitStatus).toHaveBeenCalledTimes(3)
    const listener = vi.mocked(api.onGitWorkingTreeChanged).mock.calls[0]?.[0]
    if (!listener) throw new Error('Working-tree change listener was not registered.')
    await act(async () => listener({ workingPath: session.projectPath ?? '' }))
    expect(api.getGitStatus).toHaveBeenCalledTimes(3)
    await act(async () => listener({ workingPath: other.projectPath }))
    expect(api.getGitStatus).toHaveBeenCalledTimes(4)
    expect(api.getGitStatus).toHaveBeenLastCalledWith('/other-project')
    expect(api.onGitWorkingTreeChanged).toHaveBeenCalledTimes(1)

    view.rerender({ listedSessions: [] })
    view.rerender({ listedSessions: [session] })
    expect(api.getGitStatus).toHaveBeenCalledTimes(5)
    expect(api.getGitStatus).toHaveBeenLastCalledWith('/git-refresh-project')
  })
})
