import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { render, screen } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useComposerActionStore } from '@/features/composer/state/composer-action-store'
import { useComposerStore } from '@/features/composer/state/composer-store'
import type { SessionContextRowState } from '@/features/git'
import { useGitStore } from '@/features/git/state'
import { usePreferencesStore } from '@/features/settings/state'
import { ComposerBranchRow } from '../ComposerBranchRow'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn().mockResolvedValue({ ok: true }),
    getGitStatus: vi.fn().mockResolvedValue(null),
    listGitBranches: vi.fn().mockResolvedValue(null),
    checkoutGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'Checked out' }),
    createGitBranch: vi.fn().mockResolvedValue({ ok: true, message: 'ok' }),
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
      statusByWorkingPath: {
        '/test/project': {
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
          isLoading: false,
          error: null,
        },
      },
      branches: { currentBranch: null, branches: [] },
    })
  })

  it('renders the single run-target picker when a project is selected', () => {
    render(<ComposerBranchRow strip={null} />)

    expect(screen.getByRole('button', { name: 'Run target: main' })).toBeInTheDocument()
  })

  it('renders a disabled project-first placeholder when no project is selected', () => {
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, projectPath: null },
    })

    render(<ComposerBranchRow strip={null} />)

    expect(screen.getByRole('button', { name: 'Run target: Select project first' })).toBeDisabled()
  })

  it('keeps the run target disabled while branches are loading', () => {
    const loadingStrip = fromPartial<SessionContextRowState>({
      branchStatus: 'loading',
    })

    render(<ComposerBranchRow strip={loadingStrip} />)

    expect(screen.getByRole('button', { name: 'Run target: Loading branches…' })).toBeDisabled()
  })
})
