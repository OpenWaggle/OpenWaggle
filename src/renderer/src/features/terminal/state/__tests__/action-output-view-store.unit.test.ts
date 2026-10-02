import type { ActionRun } from '@shared/types/action-runs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ manage: vi.fn() }))
vi.mock('@/shared/lib/ipc', () => ({ api: { manageProjectActions: mocks.manage } }))

import { openActionOutputTerminalView } from '../../lib/open-action-output-terminal-view'
import {
  hasActionOutputViews,
  MAX_ACTION_OUTPUT_VIEWS_PER_OWNER,
  showLatestActionOutputView,
  shownActionOutputView,
  useActionOutputViewStore,
} from '../action-output-view-store'
import { useTerminalStore } from '../terminal-store'

const OWNER = 'session-1'

function views() {
  return useActionOutputViewStore.getState().views[OWNER] ?? []
}

function shown() {
  const activeTabId = useTerminalStore.getState().groups[OWNER]?.activeTabId ?? null
  return shownActionOutputView(useActionOutputViewStore.getState(), OWNER, activeTabId)
}

function run(
  id: string,
  status: ActionRun['status'],
  startedAt: number,
  actionId = 'dev',
): Pick<ActionRun, 'id' | 'action' | 'startedAt' | 'status'> {
  return {
    id,
    status,
    startedAt,
    action: {
      id: actionId,
      name: actionId,
      icon: 'play',
      invocation: { type: 'command', command: 'pnpm dev', directory: '.' },
      kind: 'service',
      allowConcurrent: false,
      autoOpenPreview: false,
    },
  }
}

function open(runId: string, actionId = 'dev') {
  return openActionOutputTerminalView({
    ownerKey: OWNER,
    projectPath: '/repo',
    actionId,
    runId,
    label: actionId,
  })
}

describe('Action output terminal views', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useActionOutputViewStore.setState({ views: {}, active: {} })
    useTerminalStore.setState({ groups: {}, activity: {}, portPreviews: {}, exits: {} })
  })

  it('keeps exactly one view per Project action and owner; opening again focuses it', () => {
    expect(open('run-1')).toBe(true)
    useActionOutputViewStore.getState().deactivate(OWNER)
    expect(shown()).toBeNull()

    expect(open('run-1')).toBe(true)

    expect(views()).toHaveLength(1)
    expect(views()[0]).toMatchObject({ actionId: 'dev', label: 'dev', runIds: ['run-1'] })
    expect(shown()?.actionId).toBe('dev')
    // The bottom drawer opens without creating a shell terminal.
    expect(useTerminalStore.getState().groups[OWNER]).toMatchObject({ panelOpen: true, tabs: [] })
    open('lint-1', 'lint')
    expect(views().map((view) => view.actionId)).toEqual(['dev', 'lint'])
  })

  it('never opens a view for a draft owner or starts anything', () => {
    expect(
      openActionOutputTerminalView({
        ownerKey: 'draft:/repo',
        projectPath: '/repo',
        actionId: 'dev',
        runId: 'run-1',
        label: 'dev',
      }),
    ).toBe(false)
    open('run-1')
    expect(mocks.manage).not.toHaveBeenCalled()
  })

  it('follows a restart to the replacement run, keeping the earlier run above a divider', () => {
    open('run-1')
    const store = useActionOutputViewStore.getState()
    // While the run is active a newer concurrent run does not take the view over.
    store.syncRuns(OWNER, [run('run-1', 'running', 1), run('run-2', 'running', 2)])
    expect(views()[0]?.runIds).toEqual(['run-1'])

    store.syncRuns(OWNER, [
      run('run-1', 'stopped', 1),
      run('run-2', 'running', 2),
      run('other', 'running', 3, 'lint'),
    ])
    expect(views()[0]?.runIds).toEqual(['run-1', 'run-2'])

    // Several restarts while the view was hidden chain in start order.
    store.syncRuns(OWNER, [
      run('run-1', 'stopped', 1),
      run('run-2', 'stopped', 2),
      run('run-4', 'running', 4),
      run('run-3', 'stopped', 3),
    ])
    expect(views()[0]?.runIds).toEqual(['run-1', 'run-2', 'run-3', 'run-4'])
  })

  it('starts the view over on a concurrent run chosen explicitly', () => {
    open('run-1')
    open('run-1')
    expect(views()[0]?.runIds).toEqual(['run-1'])
    open('run-2')
    expect(views()).toHaveLength(1)
    expect(views()[0]?.runIds).toEqual(['run-2'])
  })

  it('shows the latest view when the drawer has no terminal tab', () => {
    open('run-1')
    open('lint-1', 'lint')
    useActionOutputViewStore.getState().deactivate(OWNER)
    showLatestActionOutputView(OWNER)
    expect(shown()?.actionId).toBe('lint')
  })

  it('keeps an ended run as the view’s final output', () => {
    open('run-1')
    useActionOutputViewStore.getState().syncRuns(OWNER, [run('run-1', 'completed', 1)])
    expect(views()).toHaveLength(1)
    expect(views()[0]?.runIds).toEqual(['run-1'])
    expect(shown()?.runIds).toEqual(['run-1'])
  })

  it('closing the tab closes only the view and never stops the run', () => {
    open('run-1')
    useActionOutputViewStore.getState().close(OWNER, 'dev')
    expect(views()).toHaveLength(0)
    expect(hasActionOutputViews(OWNER)).toBe(false)
    expect(shown()).toBeNull()
    expect(mocks.manage).not.toHaveBeenCalled()
  })

  it('shows terminal tabs again once another terminal tab is selected', () => {
    useTerminalStore.getState().createTerminal(OWNER, '/repo')
    open('run-1')
    expect(shown()?.actionId).toBe('dev')
    useTerminalStore.getState().createTerminal(OWNER, '/repo')
    expect(shown()).toBeNull()
    expect(views()).toHaveLength(1)
  })

  it('bounds the views an owner keeps', () => {
    for (let index = 0; index <= MAX_ACTION_OUTPUT_VIEWS_PER_OWNER; index += 1)
      open(`run-${String(index)}`, `action-${String(index)}`)
    expect(views()).toHaveLength(MAX_ACTION_OUTPUT_VIEWS_PER_OWNER)
    expect(views()[0]?.actionId).toBe('action-1')
  })
})
