import { WORKSPACE_FILES } from '@shared/constants/resource-limits'
import { screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const searchWorkspaceFilesMock = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: { searchWorkspaceFiles: searchWorkspaceFilesMock },
}))

import { WorkspaceFileBrowser, workspaceExplorerSearch } from '../WorkspaceFileBrowser'

describe('workspace file explorer search', () => {
  beforeEach(() => {
    searchWorkspaceFilesMock.mockReset()
    searchWorkspaceFilesMock.mockResolvedValue([
      { path: 'src/example.ts', basename: 'example.ts' },
      { path: 'README.md', basename: 'README.md' },
    ])
  })

  it('uses a server-backed query so files beyond the initial tree remain discoverable', () => {
    expect(workspaceExplorerSearch(' deep/target.ts ')).toEqual({
      query: 'deep/target.ts',
      limit: WORKSPACE_FILES.PICKER_RESULT_LIMIT,
    })
    expect(workspaceExplorerSearch('')).toEqual({
      query: '',
      limit: WORKSPACE_FILES.EXPLORER_RESULT_LIMIT + 1,
    })
  })

  it('exposes standard navigation controls without claiming a tree keyboard model', async () => {
    renderWithQueryClient(
      <WorkspaceFileBrowser
        projectPath="/worktree-a"
        currentPath="src/example.ts"
        onOpenFile={vi.fn()}
        onMoveEntry={vi.fn()}
      />,
    )

    const navigation = await screen.findByRole('navigation', { name: 'Workspace files' })
    expect(screen.queryByRole('tree')).not.toBeInTheDocument()
    expect(await within(navigation).findByRole('button', { name: 'src' })).toBeInTheDocument()
    expect(within(navigation).getByRole('button', { name: 'example.ts' })).toBeInTheDocument()
  })
})
