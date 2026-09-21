import type { ActionCatalog } from '@shared/types/action-definitions'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useProjectActionStore } from '../../state/project-action-store'
import { actionCatalog, TEST_ACTION } from './native-action-fixtures'

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
  it('launches the selected native action and remembers selection separately per project', () => {
    const lint = { ...TEST_ACTION, id: 'lint', name: 'Lint' }
    mocks.catalog = {
      ...actionCatalog(),
      actions: [
        { definition: TEST_ACTION, source: 'local' },
        { definition: lint, source: 'local' },
      ],
    }
    useProjectActionStore.getState().rememberInvoked('/repo', lint.id)
    render(<ProjectActionsControl projectPath="/repo" />)
    fireEvent.click(screen.getByRole('button', { name: 'Run Lint' }))
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith(lint)
  })
  it('falls back to a surviving action without a special setup action', () => {
    useProjectActionStore.getState().rememberInvoked('/repo', 'removed')
    render(<ProjectActionsControl projectPath="/repo" />)
    expect(screen.getByRole('button', { name: 'Run Test' })).toBeInTheDocument()
  })
})
