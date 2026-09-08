import type { ProjectAction } from '@shared/types/project-actions'
import { DEFAULT_SHORTCUT_BINDINGS } from '@shared/types/shortcuts'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectActionStore } from '../../state/project-action-store'

const mocks = vi.hoisted(() => {
  const actions: ProjectAction[] = []
  return {
    actions,
    run: vi.fn(),
    showToast: vi.fn(),
  }
})

vi.mock('../../hooks/useProjectActions', () => ({
  useProjectActions: () => ({ data: mocks.actions }),
  useT3ProjectActions: () => ({
    data: { status: 'missing', scripts: [], candidates: [] },
  }),
  useProjectActionMutations: () => ({
    add: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    importT3: vi.fn(),
    isSaving: false,
  }),
}))
vi.mock('../../hooks/useRunProjectAction', () => ({ useRunProjectAction: () => mocks.run }))
vi.mock('@/features/settings/state', () => ({
  usePreferencesStore: (
    selector: (state: {
      settings: { shortcutBindings: typeof DEFAULT_SHORTCUT_BINDINGS }
    }) => unknown,
  ) => selector({ settings: { shortcutBindings: DEFAULT_SHORTCUT_BINDINGS } }),
}))
vi.mock('@/shell/ui-store', () => ({
  useUIStore: (selector: (state: { showToast: typeof mocks.showToast }) => unknown) =>
    selector({ showToast: mocks.showToast }),
}))

import { ProjectActionsControl } from '../ProjectActionsControl'

const SETUP: ProjectAction = {
  id: 'setup',
  name: 'Setup',
  command: 'pnpm install',
  icon: 'configure',
  runOnWorktreeCreate: true,
}
const TEST: ProjectAction = {
  id: 'test',
  name: 'Test',
  command: 'pnpm test',
  icon: 'test',
  runOnWorktreeCreate: false,
}
const LINT: ProjectAction = {
  id: 'lint',
  name: 'Lint',
  command: 'pnpm lint',
  icon: 'lint',
  runOnWorktreeCreate: false,
}

describe('ProjectActionsControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actions = [SETUP, TEST, LINT]
    useProjectActionStore.setState({ lastInvokedByProject: {} })
  })

  it('promotes the surviving last-invoked action to the header button', () => {
    useProjectActionStore.getState().rememberInvoked('/repo', 'lint')
    render(<ProjectActionsControl projectPath="/repo" />)

    const run = screen.getByRole('button', { name: 'Run Lint' })
    fireEvent.click(run)
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith(LINT)
  })

  it('falls back to the first non-setup action when the remembered action is gone', () => {
    useProjectActionStore.getState().rememberInvoked('/repo', 'removed')
    render(<ProjectActionsControl projectPath="/repo" />)

    expect(screen.getByRole('button', { name: 'Run Test' })).toBeInTheDocument()
  })
})
