import type { ActionCatalog, ProjectTaskDiscovery } from '@shared/types/action-definitions'
import type {
  ActionManagementRequest,
  ActionManagementResult,
} from '@shared/types/action-management'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { taskReferenceKey } from '../../../lib/action-panel-scripts'
import { useActionPanelStore } from '../../../state/action-panel-store'
import {
  scriptCommandMemoryKey,
  useScriptCommandMemory,
} from '../../../state/script-command-memory-store'
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

const scope = { projectPath: '/repo' }
let discovery: ProjectTaskDiscovery = { tasks: [TEST_TASK], diagnostics: [] }
function serve(catalog: ActionCatalog) {
  mocks.manage.mockImplementation(async ({ operation }) => {
    if (operation.type === 'catalog' || operation.type === 'edit')
      return { type: 'catalog', catalog }
    if (operation.type === 'discover') return { type: 'discovery', discovery }
    throw new Error(`Unexpected operation ${operation.type}`)
  })
}
function edits() {
  return mocks.manage.mock.calls.flatMap(([request]) =>
    request.operation.type === 'edit' ? [request.operation.edit] : [],
  )
}
function PanelHost() {
  const request = useActionPanelStore((state) => state.request)
  return request ? <ActionPanel request={request} /> : null
}
async function openEditor(actionId: string | null) {
  useActionPanelStore.getState().openPanel({ kind: 'action', scope, actionId, origin: 'settings' })
  renderWithQueryClient(<PanelHost />)
  const panel = within(await screen.findByTestId('action-panel'))
  await panel.findByLabelText('Name')
  return panel
}
const linkedTest = {
  ...TEST_ACTION,
  invocation: { type: 'task' as const, task: TEST_TASK.reference },
}

describe('guided action editor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Linux')
    discovery = { tasks: [TEST_TASK], diagnostics: [] }
    useActionPanelStore.setState({ request: null, drafts: {}, recentlySaved: null })
    useScriptCommandMemory.setState({ commands: {} })
    serve(actionCatalog())
  })

  it('pins a one-line summary that expands into the full sentence', async () => {
    const panel = await openEditor(null)
    fireEvent.click(await panel.findByRole('button', { name: /test.*vitest run/i }))
    const summary = panel.getByRole('button', { name: /^Runs pnpm run test/ })
    expect(summary).toHaveAttribute('aria-expanded', 'false')
    expect(summary).toHaveTextContent('Runs pnpm run test · stops when done · only you')
    fireEvent.click(summary)
    expect(summary).toHaveTextContent(
      'Clicking “Run tests (website)” in + Action runs pnpm run test',
    )
  })

  it('moves a choice with the arrow keys, keeping one tab stop per question', async () => {
    const panel = await openEditor(null)
    const script = await panel.findByRole('radio', { name: /A script from this project/ })
    const command = panel.getByRole('radio', { name: /A command I type myself/ })
    expect(script).toHaveAttribute('tabindex', '0')
    expect(command).toHaveAttribute('tabindex', '-1')
    fireEvent.keyDown(script, { key: 'ArrowDown' })
    expect(command).toBeChecked()
    expect(command).toHaveFocus()
    expect(panel.getByLabelText('Command')).toBeInTheDocument()
  })

  it('closes on Escape from inside the panel and keeps the draft', async () => {
    const panel = await openEditor(null)
    const name = panel.getByLabelText('Name')
    fireEvent.change(name, { target: { value: 'Half done' } })
    name.focus()
    fireEvent.keyDown(name, { key: 'Escape' })
    await waitFor(() => expect(useActionPanelStore.getState().request).toBeNull())
    expect(useActionPanelStore.getState().drafts['/repo']).toBeDefined()
  })

  it('explains a linked script that is missing here and offers the last command it ran', async () => {
    discovery = { tasks: [], diagnostics: [] }
    serve({ ...actionCatalog(), actions: [{ source: 'local', definition: linkedTest }] })
    useScriptCommandMemory.setState({
      commands: {
        [scriptCommandMemoryKey('/repo', taskReferenceKey(TEST_TASK.reference))]: 'pnpm run test',
      },
    })
    const panel = await openEditor(TEST_ACTION.id)
    expect(await panel.findByText(/script isn’t in this workspace’s/)).toBeInTheDocument()
    expect(panel.getByRole('button', { name: 'Keep it linked' })).toBeEnabled()
    fireEvent.click(panel.getByRole('button', { name: 'Use the last known command instead' }))
    expect(panel.getByLabelText('Command')).toHaveValue('pnpm run test')
  })

  it('says when it has never seen the missing script’s command', async () => {
    discovery = { tasks: [], diagnostics: [] }
    serve({ ...actionCatalog(), actions: [{ source: 'local', definition: linkedTest }] })
    const panel = await openEditor(TEST_ACTION.id)
    expect(await panel.findByText(/hasn’t seen the command this script ran/)).toBeInTheDocument()
    expect(panel.queryByRole('button', { name: 'Use the last known command instead' })).toBeNull()
  })

  it('removes a shared action only after spelling out what removal means', async () => {
    serve({ ...actionCatalog(), actions: [{ source: 'project', definition: TEST_ACTION }] })
    const panel = await openEditor(TEST_ACTION.id)
    fireEvent.click(panel.getByRole('button', { name: 'Remove this action' }))
    expect(panel.getByRole('alert')).toHaveTextContent(
      'Everyone on the project loses this action once you commit.',
    )
    expect(panel.getByRole('button', { name: 'Keep it' })).toHaveFocus()
    fireEvent.click(panel.getByRole('button', { name: 'Remove' }))
    await waitFor(() =>
      expect(edits()).toEqual([{ type: 'delete-action', id: TEST_ACTION.id, storage: 'project' }]),
    )
  })

  it('restores the shared version of a locally overridden action', async () => {
    serve({ ...actionCatalog(), actions: [{ source: 'override', definition: TEST_ACTION }] })
    const panel = await openEditor(TEST_ACTION.id)
    expect(panel.getByRole('button', { name: /Who should get these changes/ })).toBeInTheDocument()
    fireEvent.click(panel.getByRole('button', { name: 'Restore shared version' }))
    expect(panel.getByRole('alert')).toHaveTextContent('you’ll use the shared “Test” again')
    fireEvent.click(panel.getByRole('button', { name: 'Restore shared version' }))
    await waitFor(() =>
      expect(edits()).toEqual([{ type: 'delete-action', id: TEST_ACTION.id, storage: 'local' }]),
    )
  })
})
