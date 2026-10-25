import type {
  ActionManagementRequest,
  ActionManagementResult,
} from '@shared/types/action-management'
import type { GitWorktreeInfo } from '@shared/types/git'
import type { WorktreeRemovalPreview, WorktreeUsage } from '@shared/types/worktree-usage'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const WORKTREE_COUNT = 400

const mocks = vi.hoisted(() => ({
  manage: vi.fn<(request: ActionManagementRequest) => Promise<ActionManagementResult>>(),
  remove: vi.fn(),
  list: vi.fn<() => Promise<{ readonly worktrees: readonly GitWorktreeInfo[] }>>(),
}))
vi.mock('@/features/settings/state/preferences-store', () => ({
  usePreferencesStore: (select: (value: unknown) => unknown) =>
    select({ settings: { projectPath: '/project', defaultSessionEnvironmentMode: 'local' } }),
}))
vi.mock('@/shared/lib/ipc', () => ({
  api: {
    manageProjectActions: mocks.manage,
    removeGitWorktree: mocks.remove,
    listGitWorktrees: mocks.list,
  },
}))

import { WorktreesSection } from '../WorktreesSection'

const MAIN: GitWorktreeInfo = { path: '/project', branch: 'main', head: 'a', isMain: true }
const FREE: GitWorktreeInfo = { path: '/wt/free', branch: 'ow/free', head: 'b', isMain: false }
const OWNED: GitWorktreeInfo = { path: '/wt/owned', branch: 'ow/owned', head: 'c', isMain: false }

const OWNED_USAGE: WorktreeUsage = {
  path: OWNED.path,
  sessions: [
    {
      sessionId: 'session-1',
      title: 'Fix the login bug',
      archived: false,
      running: true,
      owner: true,
    },
  ],
  blockers: [
    {
      kind: 'session',
      message: 'The Session “Fix the login bug” works in it. Archive that Session first.',
    },
  ],
}

function respond(options: {
  readonly usage?: readonly WorktreeUsage[]
  readonly preview?: Partial<WorktreeRemovalPreview>
  readonly previewError?: Error
}) {
  mocks.manage.mockImplementation(async ({ operation }) => {
    if (operation.type === 'worktree-usage')
      return { type: 'worktree-usage', worktrees: options.usage ?? [] }
    if (operation.type === 'worktree-removal-preview') {
      if (options.previewError) throw options.previewError
      return {
        type: 'worktree-removal-preview',
        usage: { path: operation.path, sessions: [], blockers: [] },
        branch: 'ow/free',
        unpublishedCommitCount: 0,
        ...options.preview,
      }
    }
    return { type: 'retained-preparation', workspaces: [] }
  })
}

async function rowFor(path: string) {
  const row = (await screen.findByText(path)).closest('li')
  if (!row) throw new Error(`no row for ${path}`)
  return within(row)
}

beforeEach(() => {
  mocks.manage.mockReset()
  mocks.remove.mockReset().mockResolvedValue({ ok: true, message: 'Worktree removed.' })
  mocks.list.mockReset().mockResolvedValue({ worktrees: [MAIN, FREE, OWNED] })
})

describe('removing a worktree from Settings', () => {
  it('asks first, and Cancel removes nothing', async () => {
    respond({})
    renderWithQueryClient(<WorktreesSection />)

    fireEvent.click((await rowFor(FREE.path)).getByRole('button', { name: 'Remove' }))

    const dialog = await screen.findByRole('dialog', { name: 'Remove this worktree?' })
    expect(mocks.remove).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  it('warns about commits that are on no remote, then removes once confirmed', async () => {
    respond({ preview: { unpublishedCommitCount: 3 } })
    renderWithQueryClient(<WorktreesSection />)

    fireEvent.click((await rowFor(FREE.path)).getByRole('button', { name: 'Remove' }))

    const dialog = await screen.findByRole('dialog', { name: 'Remove this worktree?' })
    expect(
      await within(dialog).findByText(/ow\/free has 3 commits that are not on any remote/),
    ).toBeInTheDocument()
    const confirm = within(dialog).getByRole('button', { name: 'Remove worktree' })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('/project', { path: FREE.path }))
  })

  it('disables Remove for a worktree in use and names the Session that owns it', async () => {
    respond({ usage: [OWNED_USAGE] })
    renderWithQueryClient(<WorktreesSection />)

    const row = await rowFor(OWNED.path)
    expect(await row.findByText('Session: Fix the login bug (running)')).toBeInTheDocument()
    expect(row.getByText(/In use: The Session “Fix the login bug” works in it/)).toBeInTheDocument()
    expect(row.getByRole('button', { name: 'Remove' })).toBeDisabled()
    expect(row.queryByText('Force remove…')).not.toBeInTheDocument()
    expect((await rowFor(FREE.path)).getByRole('button', { name: 'Remove' })).toBeEnabled()
  })

  it('keeps the confirmation closed to a worktree that came into use after the list loaded', async () => {
    respond({ preview: { usage: { ...OWNED_USAGE, path: FREE.path } } })
    renderWithQueryClient(<WorktreesSection />)

    fireEvent.click((await rowFor(FREE.path)).getByRole('button', { name: 'Remove' }))

    const dialog = await screen.findByRole('dialog', { name: 'Remove this worktree?' })
    expect(await within(dialog).findByText(/It cannot be removed now/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Remove worktree' })).toBeDisabled()
  })

  it('does not allow the removal when the worktree cannot be checked', async () => {
    respond({ previewError: new Error('Host unavailable') })
    renderWithQueryClient(<WorktreesSection />)

    fireEvent.click((await rowFor(FREE.path)).getByRole('button', { name: 'Remove' }))

    const dialog = await screen.findByRole('dialog', { name: 'Remove this worktree?' })
    expect(
      await within(dialog).findByText('Could not check this worktree: Host unavailable'),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Remove worktree' })).toBeDisabled()
  })

  it('confirms a force removal in its own words', async () => {
    respond({})
    renderWithQueryClient(<WorktreesSection />)

    fireEvent.click((await rowFor(FREE.path)).getByText('Force remove…'))
    fireEvent.click((await rowFor(FREE.path)).getByRole('button', { name: 'Force remove' }))

    const dialog = await screen.findByRole('dialog', { name: 'Force remove this worktree?' })
    const confirm = within(dialog).getByRole('button', { name: 'Force remove worktree' })
    await waitFor(() => expect(confirm).toBeEnabled())
    fireEvent.click(confirm)
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith('/project', {
        path: FREE.path,
        skipCleanup: true,
        force: true,
      }),
    )
  })
})

describe('a repository with hundreds of worktrees', () => {
  it('finds a worktree by path, branch or Session title', async () => {
    const many = Array.from({ length: WORKTREE_COUNT }, (_, index) => ({
      path: `/wt/session-${String(index)}`,
      branch: `ow/session-${String(index)}`,
      head: 'h',
      isMain: false,
    }))
    mocks.list.mockResolvedValue({ worktrees: [MAIN, ...many, OWNED] })
    respond({ usage: [OWNED_USAGE] })
    renderWithQueryClient(<WorktreesSection />)

    expect(await screen.findByText(`${String(WORKTREE_COUNT + 2)} worktrees`)).toBeInTheDocument()
    const search = screen.getByRole('searchbox', { name: 'Search worktrees' })

    fireEvent.change(search, { target: { value: 'session-399' } })
    expect(screen.getByText(`1 of ${String(WORKTREE_COUNT + 2)} worktrees`)).toBeInTheDocument()
    expect(screen.getByText('/wt/session-399')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'login bug' } })
    expect(screen.getByText(OWNED.path)).toBeInTheDocument()
    expect(screen.queryByText('/wt/session-1')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'nothing like this' } })
    expect(screen.getByText('No worktrees match this search.')).toBeInTheDocument()
  })
})
