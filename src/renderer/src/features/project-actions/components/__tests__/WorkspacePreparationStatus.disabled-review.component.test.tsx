import type { ActionCatalog } from '@shared/types/action-definitions'
import type {
  ActionManagementRequest,
  ActionManagementResult,
} from '@shared/types/action-management'
import type {
  PreparationExecution,
  WorkspacePreparation,
} from '@shared/types/workspace-preparation'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { useActionPanelStore } from '../../state/action-panel-store'
import { ActionPanel } from '../action-panel/ActionPanel'

const mocks = vi.hoisted(() => ({
  manage: vi.fn<(request: ActionManagementRequest) => Promise<ActionManagementResult>>(),
}))
vi.mock('@/shared/lib/ipc', () => ({ api: { manageProjectActions: mocks.manage } }))
vi.mock('@/features/chat/hooks', () => ({
  useChat: () => ({ activeSession: { id: 'session', projectPath: '/repo' } }),
}))

/** The shell docks the panel; the test renders its content beside the status. */
function PanelHost() {
  const request = useActionPanelStore((state) => state.request)
  return request ? <ActionPanel request={request} /> : null
}

import { WorkspacePreparationStatus } from '../WorkspacePreparationStatus'

const execution: PreparationExecution = {
  status: 'skipped',
  attemptId: null,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  error: null,
  output: '',
  truncated: false,
}
const definition = {
  id: 'shared-setup',
  profileId: 'default',
  phase: 'setup',
  invocation: { type: 'command', command: 'pnpm install', directory: '.' },
} as const
const catalog: ActionCatalog = {
  revision: 'catalog-1',
  actions: [],
  profiles: [{ source: 'project', definition: { id: 'default', name: 'Default' } }],
  preparation: [{ source: 'project', review: 'disabled', definition }],
}

describe('Workspace preparation with a disabled shared setup', () => {
  it('offers a review decision before Run setup and enables the pinned definition', async () => {
    let state: WorkspacePreparation = {
      workspaceId: 'workspace',
      revision: 3,
      snapshot: {
        profile: { id: 'default', name: 'Default' },
        capturedAt: 1,
        definitions: catalog.preparation,
      },
      setup: execution,
      cleanup: execution,
      updateAvailable: false,
    }
    mocks.manage.mockImplementation(async ({ operation }) => {
      if (operation.type === 'catalog') return { type: 'catalog', catalog }
      if (operation.type === 'preparation') return { type: 'preparation', preparation: state }
      if (operation.type === 'review-snapshot') {
        state = {
          ...state,
          revision: state.revision + 1,
          snapshot: {
            ...state.snapshot,
            definitions: state.snapshot.definitions.map((entry) => ({
              ...entry,
              review: operation.enabled ? 'enabled' : 'disabled',
            })),
          },
        }
        return { type: 'preparation', preparation: state }
      }
      throw new Error(`Unexpected operation ${operation.type}`)
    })

    useActionPanelStore.setState({ request: null, drafts: {} })
    renderWithQueryClient(
      <>
        <WorkspacePreparationStatus scope={{ projectPath: '/repo', sessionId: 'session' }} />
        <PanelHost />
      </>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Check the setup' }))
    expect(screen.getByRole('button', { name: 'Run setup' })).toBeDisabled()
    expect(await screen.findByText('Check this shared setup')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Turn on this version' }))

    await waitFor(() =>
      expect(mocks.manage).toHaveBeenCalledWith({
        scope: { projectPath: '/repo', sessionId: 'session' },
        operation: {
          type: 'review-snapshot',
          definitionId: 'shared-setup',
          enabled: true,
          expectedRevision: 3,
        },
      }),
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run setup' })).toBeEnabled())
    expect(useActionPanelStore.getState().request).toBeNull()
  })

  it('opens a required review by itself once and never again after Keep it off', async () => {
    let state: WorkspacePreparation = {
      workspaceId: 'workspace',
      revision: 7,
      snapshot: {
        profile: { id: 'default', name: 'Default' },
        capturedAt: 1,
        definitions: [{ source: 'project', review: 'required', definition }],
      },
      setup: { ...execution, status: 'review-required' },
      cleanup: execution,
      updateAvailable: false,
    }
    mocks.manage.mockImplementation(async ({ operation }) => {
      if (operation.type === 'catalog') return { type: 'catalog', catalog }
      if (operation.type === 'preparation') return { type: 'preparation', preparation: state }
      if (operation.type === 'review-snapshot') {
        state = {
          ...state,
          revision: state.revision + 1,
          snapshot: {
            ...state.snapshot,
            definitions: state.snapshot.definitions.map((entry) => ({
              ...entry,
              review: 'disabled',
            })),
          },
        }
        return { type: 'preparation', preparation: state }
      }
      throw new Error(`Unexpected operation ${operation.type}`)
    })
    useActionPanelStore.setState({ request: null, drafts: {} })
    renderWithQueryClient(
      <>
        <WorkspacePreparationStatus scope={{ projectPath: '/repo', sessionId: 'session' }} />
        <PanelHost />
      </>,
    )
    expect(await screen.findByText('Check this shared setup')).toBeInTheDocument()
    expect(screen.getByText(/The new worktree is waiting for your choice/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep it off' }))
    await waitFor(() => expect(useActionPanelStore.getState().request).toBeNull())
    await waitFor(() => expect(state.revision).toBe(8))
    // The refetched, declined state renders without the panel coming back.
    await waitFor(() =>
      expect(
        mocks.manage.mock.calls.filter(([request]) => request.operation.type === 'preparation')
          .length,
      ).toBeGreaterThan(1),
    )
    await act(async () => {})
    expect(useActionPanelStore.getState().request).toBeNull()
    expect(screen.queryByText('Check this shared setup')).not.toBeInTheDocument()
  })
})
