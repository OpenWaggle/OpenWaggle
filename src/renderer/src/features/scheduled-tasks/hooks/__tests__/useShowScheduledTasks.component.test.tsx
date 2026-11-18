import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHookWithQueryClient } from '@/test-utils/query-test-utils'
import { heartbeatTask, scheduledTask } from '@/test-utils/scheduled-task-fixtures'

const mocks = vi.hoisted(() => {
  const state: { pathname: string; projectPath: string | null; controller: boolean } = {
    pathname: '/sessions/session-1',
    projectPath: '/projects/alpha',
    controller: true,
  }
  return Object.assign(state, { navigate: vi.fn(), showSurface: vi.fn() })
})

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  // The hook reads the location when it opens a task, not when it renders.
  useRouter: () => ({
    state: {
      location: {
        get pathname() {
          return mocks.pathname
        },
      },
    },
  }),
}))
vi.mock('@/features/sessions/hooks', () => ({ useSessionProjectPath: () => mocks.projectPath }))
vi.mock('@/shared/lib/right-panel-surfaces', () => ({
  hasRightPanelController: () => mocks.controller,
  showRightPanelSurface: mocks.showSurface,
}))

import { scheduledTasksListQueryOptions } from '@/queries/scheduled-tasks'
import { useScheduledTasksNavigationStore } from '../../state/scheduled-tasks-navigation-store'
import { useShowScheduledTasks } from '../useShowScheduledTasks'

const TASKS = [heartbeatTask(), scheduledTask({ id: 'beta', projectPath: '/projects/beta' })]
const SETTINGS = { to: '/settings/$tab', params: { tab: 'scheduled' } }

function renderShow(withTasks = true) {
  const rendered = renderHookWithQueryClient(() => useShowScheduledTasks())
  if (withTasks) rendered.client.setQueryData(scheduledTasksListQueryOptions().queryKey, TASKS)
  return rendered.result
}

describe('opening a Scheduled task where the user is', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.pathname = '/sessions/session-1'
    mocks.projectPath = '/projects/alpha'
    mocks.controller = true
    useScheduledTasksNavigationStore.setState({
      panel: { kind: 'list' },
      settings: { kind: 'list' },
    })
  })

  it('uses the Right panel for a task of the open chat’s project', () => {
    const show = renderShow()
    act(() => show.current({ kind: 'task', taskId: 'heartbeat-1' }))
    expect(mocks.showSurface).toHaveBeenCalledWith('scheduled-tasks')
    expect(useScheduledTasksNavigationStore.getState().panel).toEqual({
      kind: 'task',
      taskId: 'heartbeat-1',
    })
    expect(mocks.navigate).not.toHaveBeenCalled()
  })

  it('uses Settings for another project’s task, a task the list does not know, or no chat', () => {
    const show = renderShow()
    act(() => show.current({ kind: 'task', taskId: 'beta' }))
    expect(mocks.navigate).toHaveBeenLastCalledWith(SETTINGS)
    expect(useScheduledTasksNavigationStore.getState().settings).toEqual({
      kind: 'task',
      taskId: 'beta',
    })

    act(() => show.current({ kind: 'task', taskId: 'not-loaded' }))
    expect(mocks.navigate).toHaveBeenCalledTimes(2)

    mocks.pathname = '/usage'
    act(() => show.current({ kind: 'new', defaults: { kind: 'launch' } }))
    expect(mocks.navigate).toHaveBeenCalledTimes(3)
    expect(mocks.showSurface).not.toHaveBeenCalled()
  })
})
