import type { ProjectAction, T3ProjectActionScript } from '@shared/types/project-actions'
import { DEFAULT_SHORTCUT_BINDINGS } from '@shared/types/shortcuts'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { ProjectActionsSettings } from '../ProjectActionsSettings'

interface DiscoveryFixture {
  status: 'missing' | 'invalid' | 'valid'
  scripts: T3ProjectActionScript[]
  candidates: T3ProjectActionScript[]
  error: string | undefined
}

const mocks = vi.hoisted(() => {
  const actions: ProjectAction[] = []
  const discovery: DiscoveryFixture = {
    status: 'missing',
    scripts: [],
    candidates: [],
    error: undefined,
  }
  return {
    actions,
    discovery,
    add: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    importT3: vi.fn(),
    list: vi.fn(),
    discover: vi.fn(),
    showConfirm: vi.fn(),
    showToast: vi.fn(),
  }
})

vi.mock('@/features/sessions/hooks', () => ({
  useProject: () => ({ projectPath: '/repo' }),
}))
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
vi.mock('@/shared/lib/ipc', () => ({
  api: {
    listProjectActions: mocks.list,
    discoverT3ProjectActions: mocks.discover,
    addProjectAction: mocks.add,
    updateProjectAction: mocks.update,
    deleteProjectAction: mocks.delete,
    importT3ProjectAction: mocks.importT3,
    showConfirm: mocks.showConfirm,
  },
}))

const TEST_ACTION: ProjectAction = {
  id: 'test',
  name: 'Test',
  command: 'pnpm test',
  icon: 'test',
  runOnWorktreeCreate: false,
}

function resetApi() {
  mocks.actions = [TEST_ACTION]
  mocks.discovery = { status: 'missing', scripts: [], candidates: [], error: undefined }
  mocks.list.mockImplementation(async () => [...mocks.actions])
  mocks.discover.mockImplementation(async () => ({ ...mocks.discovery }))
  mocks.add.mockImplementation(async (_projectPath, input) => {
    mocks.actions = [
      ...mocks.actions,
      {
        id: 'added',
        name: input.name,
        command: input.command,
        icon: input.icon ?? 'play',
        runOnWorktreeCreate: input.runOnWorktreeCreate ?? false,
        ...(input.previewUrl ? { previewUrl: input.previewUrl } : {}),
        ...(input.autoOpenPreview ? { autoOpenPreview: true } : {}),
        ...(input.shortcutRules && input.shortcutRules.length > 0
          ? { shortcutRules: input.shortcutRules }
          : {}),
      },
    ]
    return [...mocks.actions]
  })
  mocks.update.mockImplementation(async (_projectPath, actionId, update) => {
    mocks.actions = mocks.actions.map((action) =>
      action.id === actionId
        ? {
            ...action,
            ...update,
            previewUrl: update.previewUrl ?? undefined,
            shortcutRules: update.shortcutRules ?? undefined,
          }
        : action,
    )
    return [...mocks.actions]
  })
  mocks.delete.mockImplementation(async (_projectPath, actionId) => {
    mocks.actions = mocks.actions.filter((action) => action.id !== actionId)
    return [...mocks.actions]
  })
  mocks.importT3.mockImplementation(async (_projectPath, sourceIndex) => {
    mocks.actions = [
      ...mocks.actions,
      {
        id: `imported-${sourceIndex}`,
        name: 'Build',
        command: 'pnpm build',
        icon: 'build',
        runOnWorktreeCreate: false,
      },
    ]
    return [...mocks.actions]
  })
}

describe('ProjectActionsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetApi()
    mocks.showConfirm.mockResolvedValue(true)
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Linux x86_64',
    })
  })

  it('distinguishes invalid t3.json from a missing file', async () => {
    mocks.discovery = {
      status: 'invalid',
      scripts: [],
      candidates: [],
      error: 'scripts[0].command must be a string',
    }
    const invalid = renderWithQueryClient(<ProjectActionsSettings />)

    expect(await screen.findByText('t3.json is invalid')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('scripts[0].command must be a string')
    invalid.unmount()

    mocks.discovery = { status: 'missing', scripts: [], candidates: [], error: undefined }
    renderWithQueryClient(<ProjectActionsSettings />)
    expect(await screen.findByText(/No t3.json found/)).toBeInTheDocument()
  })

  it('supports explicit import and complete add, edit, and confirmed delete flows', async () => {
    mocks.discovery = {
      status: 'valid',
      scripts: [],
      candidates: [
        {
          sourceIndex: 2,
          name: 'Build',
          command: 'pnpm build',
          icon: 'build',
          runOnWorktreeCreate: false,
        },
      ],
      error: undefined,
    }
    renderWithQueryClient(<ProjectActionsSettings />)

    fireEvent.click(await screen.findByRole('button', { name: 'Import Build' }))
    await waitFor(() => expect(mocks.importT3).toHaveBeenCalledExactlyOnceWith('/repo', 2))
    expect(await screen.findByRole('button', { name: 'Edit Build' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add action' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dev' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'pnpm dev' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save action' }))
    await waitFor(() => expect(mocks.add).toHaveBeenCalledOnce())
    expect(await screen.findByRole('button', { name: 'Edit Dev' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit Dev' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Develop' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith(
        '/repo',
        'added',
        expect.objectContaining({ name: 'Develop', command: 'pnpm dev' }),
      ),
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Test' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(mocks.showConfirm).toHaveBeenCalledOnce())
    expect(mocks.delete).toHaveBeenCalledExactlyOnceWith('/repo', 'test')
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Edit Test' })).not.toBeInTheDocument(),
    )
  })
})
