import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerActionStore } from '../../../stores/composer-action-store'
import { useComposerStore } from '../../../stores/composer-store'
import { useGitStore } from '../../../stores/git-store'
import { usePreferencesStore } from '../../../stores/preferences-store'
import { ComposerBranchRow } from '../ComposerBranchRow'

vi.mock('@/lib/ipc', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({ ok: true }),
    getGitStatus: vi.fn().mockResolvedValue(null),
    listGitBranches: vi.fn().mockResolvedValue(null),
    checkoutGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'Checked out' }),
    createGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    renameGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    deleteGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
    setGitBranchUpstream: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
  },
}))

describe('ComposerBranchRow', () => {
  beforeEach(() => {
    useComposerStore.setState(useComposerStore.getInitialState())
    useComposerActionStore.setState(useComposerActionStore.getInitialState())
    usePreferencesStore.setState({
      ...usePreferencesStore.getInitialState(),
      settings: { ...DEFAULT_SETTINGS, projectPath: '/test/project' },
      isLoaded: true,
    })
    useGitStore.setState({
      ...useGitStore.getInitialState(),
      status: {
        branch: 'main',
        additions: 0,
        deletions: 0,
        filesChanged: 0,
        changedFiles: [],
        clean: true,
        ahead: 0,
        behind: 0,
      },
      branches: { branches: [] },
    })
  })

  it('renders the branch picker in a right-aligned row when a project is selected', () => {
    const { container } = render(<ComposerBranchRow />)

    expect(screen.getByTitle('Manage branches')).toBeInTheDocument()
    expect(screen.getByText('main')).toBeInTheDocument()
    expect(container.firstElementChild).toHaveClass('justify-end')
  })

  it('renders no row when no project is selected', () => {
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, projectPath: null },
    })

    const { container } = render(<ComposerBranchRow />)

    expect(container.firstChild).toBeNull()
  })
})
