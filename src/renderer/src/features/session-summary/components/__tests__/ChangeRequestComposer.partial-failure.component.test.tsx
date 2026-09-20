import { SessionId, WorkingPath } from '@shared/types/brand'
import type { GitStatusSummary, SourceControlProviderId, VcsStatus } from '@shared/types/git'
import type { SessionDetail } from '@shared/types/session'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { ChangeRequestComposer } from '../ChangeRequestComposer'

const runStackedGitAction = vi.hoisted(() => vi.fn())
const openExternal = vi.hoisted(() => vi.fn())
const recordSessionChangeRequest = vi.hoisted(() => vi.fn())
const useChangeRequestPreflight = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({
  api: { runStackedGitAction, openExternal, recordSessionChangeRequest },
}))

vi.mock('../use-change-request-preflight', () => ({
  useChangeRequestPreflight,
}))

const SESSION: SessionDetail = {
  id: SessionId('session-1'),
  title: 'Explore image hub parity',
  projectPath: '/project',
  messages: [],
  createdAt: 1000,
  updatedAt: 1000,
}

const GIT_STATUS: GitStatusSummary = {
  branch: 'main',
  additions: 30,
  deletions: 0,
  filesChanged: 1,
  changedFiles: [
    {
      path: 'src/hub.tsx',
      status: 'modified',
      staged: false,
      unstaged: true,
      additions: 30,
      deletions: 0,
    },
  ],
  clean: false,
  ahead: 0,
  behind: 0,
}

function vcsStatus(provider: SourceControlProviderId, isDefaultRef: boolean): VcsStatus {
  return fromPartial<VcsStatus>({
    isRepo: true,
    sourceControlProvider: { id: provider, host: `${provider}.com` },
    hasPrimaryRemote: true,
    defaultRef: 'main',
    isDefaultRef,
    refName: isDefaultRef ? 'main' : 'codex/existing-branch',
    pushTargetRef: isDefaultRef ? 'main' : 'codex/existing-branch',
    pushTargetIsDefaultRef: isDefaultRef,
    hasWorkingTreeChanges: true,
    workingTree: { files: [], insertions: 0, deletions: 0 },
    hasUpstream: true,
    aheadCount: 1,
    behindCount: 0,
    aheadOfDefaultCount: isDefaultRef ? null : 1,
    changeRequest: null,
  })
}

function renderComposer(
  input: {
    readonly isDefaultRef?: boolean
    readonly gitStatus?: GitStatusSummary | null
    readonly vcs?: VcsStatus
  } = {},
) {
  return renderWithQueryClient(
    <ChangeRequestComposer
      session={SESSION}
      workingPath={WorkingPath('/project')}
      gitStatus={input.gitStatus === undefined ? GIT_STATUS : input.gitStatus}
      vcsStatus={input.vcs ?? vcsStatus('github', input.isDefaultRef ?? true)}
      onClose={vi.fn()}
      onCompleted={vi.fn()}
    />,
  )
}

describe('ChangeRequestComposer partial failures', () => {
  beforeEach(() => {
    useUIStore.setState({ toastMessage: null, toastData: null })
    runStackedGitAction.mockReset()
    openExternal.mockReset().mockResolvedValue(undefined)
    recordSessionChangeRequest.mockReset().mockResolvedValue({})
    useChangeRequestPreflight
      .mockReset()
      .mockImplementation(
        (
          _sessionId: string,
          _workingPath: WorkingPath,
          _provider: SourceControlProviderId,
          payload: { readonly headRef: string },
        ) => ({
          status: 'ready',
          message: 'GitHub CLI ready as openwaggle.',
          nativeCreationBlocked: false,
          browserUrl: 'https://github.com/openwaggle/openwaggle/compare/main...branch',
          plannedHeadRef: payload.headRef,
        }),
      )
  })

  it('keeps provider failures in the composer for correction', async () => {
    runStackedGitAction.mockResolvedValue({
      ok: false,
      phase: 'pr',
      code: 'change-request-failed',
      message: 'GitHub authentication is required.',
    })
    renderComposer({ gitStatus: null, isDefaultRef: false })

    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub authentication is required.')
  })

  it('reuses a prepared branch after partial failure and exposes the browser fallback', async () => {
    runStackedGitAction
      .mockResolvedValueOnce({
        ok: false,
        phase: 'pr',
        code: 'change-request-failed',
        message: 'GitHub CLI is unavailable.',
        branch: { status: 'created', name: 'codex/explore-image-hub-parity-2' },
        fallbackUrl:
          'https://github.com/openwaggle/openwaggle/compare/main...codex%2Fexplore-image-hub-parity-2?expand=1',
      })
      .mockResolvedValueOnce({
        ok: true,
        action: 'create_pr',
        branch: { status: 'unchanged', name: 'codex/explore-image-hub-parity-2' },
        changeRequest: null,
      })
    renderComposer({
      gitStatus: null,
      vcs: { ...vcsStatus('github', true), hasWorkingTreeChanges: false },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub CLI is unavailable.')
    expect(screen.getByLabelText('New branch name')).toHaveValue('codex/explore-image-hub-parity-2')
    fireEvent.click(screen.getByRole('button', { name: 'Open PR in browser' }))
    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/openwaggle/openwaggle/compare/main...codex%2Fexplore-image-hub-parity-2?expand=1',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))
    await waitFor(() => expect(runStackedGitAction).toHaveBeenCalledTimes(2))
    expect(useChangeRequestPreflight).toHaveBeenLastCalledWith(
      'session-1',
      WorkingPath('/project'),
      'github',
      expect.objectContaining({
        headRef: 'codex/explore-image-hub-parity-2',
        createFeatureBranch: true,
      }),
      null,
    )
    expect(runStackedGitAction.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        createFeatureBranch: true,
        featureBranchName: 'codex/explore-image-hub-parity-2',
        exactFeatureBranchName: true,
      }),
    )
  })
})
