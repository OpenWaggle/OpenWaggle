import type { ActionCatalog, CommandRepairProposal } from '@shared/types/action-definitions'
import type {
  ActionManagementRequest,
  ActionManagementResult,
} from '@shared/types/action-management'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useRightSidebarCoordinator } from '@/shared/lib/right-sidebar-coordinator'
import { installMatchMedia } from '@/shared/ui/__tests__/right-sidebar-layout.test-harness'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { useActionPanelStore } from '../../../state/action-panel-store'
import { actionCatalog, TEST_ACTION, TEST_TASK } from '../../__tests__/native-action-fixtures'

const mocks = vi.hoisted(() => ({
  manage: vi.fn<(request: ActionManagementRequest) => Promise<ActionManagementResult>>(),
  navigate: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@/features/chat/hooks', () => ({
  useChat: () => ({ activeSession: { id: 'session', projectPath: '/repo' } }),
}))
vi.mock('@/shared/lib/ipc', () => ({ api: { manageProjectActions: mocks.manage } }))

import { ActionPanel } from '../ActionPanel'
import { ActionPanelLayout } from '../ActionPanelLayout'
import { CommandRepairProposalCard } from '../CommandRepairProposalCard'

const scope = { projectPath: '/repo', sessionId: 'session' }
function serve(catalog: ActionCatalog = actionCatalog()) {
  mocks.manage.mockImplementation(async ({ operation }) => {
    if (operation.type === 'catalog' || operation.type === 'edit')
      return { type: 'catalog', catalog }
    if (operation.type === 'discover')
      return { type: 'discovery', discovery: { tasks: [TEST_TASK], diagnostics: [] } }
    if (operation.type === 'runs') return { type: 'runs', runs: [] }
    throw new Error(`Unexpected operation ${operation.type}`)
  })
}
function openNewAction() {
  act(() =>
    useActionPanelStore
      .getState()
      .openPanel({ kind: 'action', scope, actionId: null, origin: 'session' }),
  )
}

describe('guided action panel in the right-sidebar slot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    installMatchMedia(false)
    useRightSidebarCoordinator.setState({ activeClaim: null })
    useActionPanelStore.setState({
      request: null,
      drafts: {},
      lastSeenScriptCommands: {},
      recentlySaved: null,
    })
    serve()
  })

  it('restores the sidebar it replaced when it closes', async () => {
    useRightSidebarCoordinator.getState().claimWorkspace('session')
    renderWithQueryClient(
      <ActionPanelLayout>
        <main>Session</main>
      </ActionPanelLayout>,
    )
    openNewAction()
    const panel = within(await screen.findByTestId('action-panel'))
    await panel.findByLabelText('Name')
    expect(useRightSidebarCoordinator.getState().activeClaim).toMatchObject({
      kind: 'action-panel',
    })
    fireEvent.click(panel.getByRole('button', { name: 'Close. Anything unfinished is kept.' }))
    expect(useActionPanelStore.getState().request).toBeNull()
    expect(useRightSidebarCoordinator.getState().activeClaim).toEqual({
      kind: 'workspace',
      ownerKey: 'session',
    })
  })

  it('keeps the draft when another sidebar takes the slot', async () => {
    renderWithQueryClient(
      <ActionPanelLayout>
        <main>Session</main>
      </ActionPanelLayout>,
    )
    openNewAction()
    const panel = within(await screen.findByTestId('action-panel'))
    fireEvent.change(await panel.findByLabelText('Name'), { target: { value: 'Half done' } })
    act(() => useRightSidebarCoordinator.getState().claimRoute('diff', 'session'))
    await waitFor(() => expect(useActionPanelStore.getState().request).toBeNull())
    expect(useActionPanelStore.getState().drafts['/repo']).toMatchObject({
      kind: 'action',
      definition: { name: 'Half done' },
    })
  })

  it('reviews an agent’s repair proposal as a draft and saves only on request', async () => {
    const proposal: CommandRepairProposal = {
      type: 'command-repair-proposal',
      actionId: TEST_ACTION.id,
      actionName: TEST_ACTION.name,
      current: { command: 'pnpm test', directory: '.' },
      proposed: { command: 'pnpm test -- --run', directory: '.' },
      reason: 'Watch mode never exits here.',
    }
    renderWithQueryClient(
      <>
        <CommandRepairProposalCard content={{ content: [], details: proposal }} />
        <ActionPanelHost />
      </>,
    )
    expect(screen.getByText('Proposed fix for Test')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review and save' }))
    const panel = within(await screen.findByTestId('action-panel'))
    expect(await panel.findByText('The agent proposes this change')).toBeInTheDocument()
    expect(panel.getByText('Watch mode never exits here.')).toBeInTheDocument()
    expect(panel.getByLabelText('Command')).toHaveValue('pnpm test -- --run')
    expect(mocks.manage.mock.calls.some(([request]) => request.operation.type === 'edit')).toBe(
      false,
    )
    fireEvent.click(panel.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(mocks.manage).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: expect.objectContaining({
            edit: expect.objectContaining({
              type: 'save-action',
              definition: expect.objectContaining({
                id: TEST_ACTION.id,
                invocation: { type: 'command', command: 'pnpm test -- --run', directory: '.' },
              }),
            }),
          }),
        }),
      ),
    )
  })
})

function ActionPanelHost() {
  const request = useActionPanelStore((state) => state.request)
  return request ? <ActionPanel request={request} /> : null
}
