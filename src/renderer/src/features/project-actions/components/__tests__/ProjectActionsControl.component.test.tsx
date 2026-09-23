import type { ActionCatalog } from '@shared/types/action-definitions'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectActionStore } from '../../state/project-action-store'
import { actionCatalog, TEST_ACTION, TEST_TASK } from './native-action-fixtures'

const mocks = vi.hoisted(() => ({
  catalog: ((): ActionCatalog | null => null)(),
  run: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('../../hooks/useNativeActions', () => ({
  useActionScope: (projectPath: string | null) =>
    projectPath ? { projectPath, sessionId: 'session' } : null,
  useNativeActions: () => ({ data: mocks.catalog }),
  useActionRuns: () => ({ data: [] }),
  useActionDiscovery: () => ({ data: { tasks: [], diagnostics: [] } }),
}))
vi.mock('../../hooks/useRunProjectAction', () => ({ useRunProjectAction: () => mocks.run }))

import { ProjectActionsControl } from '../ProjectActionsControl'

describe('ProjectActionsControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.catalog = actionCatalog()
    useProjectActionStore.setState({ lastInvokedByProject: {}, previewOpenedRuns: [] })
  })
  it('keeps + Action as the entry point after saving and running an action', () => {
    const lint = { ...TEST_ACTION, id: 'lint', name: 'Lint' }
    mocks.catalog = { ...actionCatalog(), actions: [{ definition: lint, source: 'local' }] }
    useProjectActionStore.getState().rememberInvoked('/repo', lint.id)
    render(<ProjectActionsControl projectPath="/repo" />)
    const trigger = screen.getByRole('button', { name: 'Project actions' })
    expect(trigger).toHaveTextContent('Action')
    fireEvent.click(trigger)
    expect(mocks.run).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toHaveAttribute('popover', 'manual')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Run Lint' }))
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith(lint)
    expect(trigger).toHaveTextContent('Action')
    expect(trigger).not.toHaveTextContent('Lint')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
  it('uses the same entry point for an empty catalog and exposes Add action', () => {
    mocks.catalog = { ...actionCatalog(), actions: [] }
    render(<ProjectActionsControl projectPath="/repo" />)
    fireEvent.click(screen.getByRole('button', { name: 'Project actions' }))
    expect(screen.getByText('No saved actions yet.')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Add action' })).toBeEnabled()
  })
  it('runs a saved task even when the capped discovery page omits it', () => {
    const saved = {
      ...TEST_ACTION,
      invocation: { type: 'task' as const, task: TEST_TASK.reference },
    }
    mocks.catalog = { ...actionCatalog(), actions: [{ definition: saved, source: 'local' }] }
    render(<ProjectActionsControl projectPath="/repo" />)
    fireEvent.click(screen.getByRole('button', { name: 'Project actions' }))
    const run = screen.getByRole('menuitem', { name: 'Run Test' })
    expect(run).toBeEnabled()
    fireEvent.click(run)
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith(saved)
  })
  it('shows loading without hiding the entry point or allowing an unsafely stale save', () => {
    mocks.catalog = null
    render(<ProjectActionsControl projectPath="/repo" />)
    fireEvent.click(screen.getByRole('button', { name: 'Project actions' }))
    expect(screen.getByText('Loading actions…')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Add action' })).toBeDisabled()
  })
})
