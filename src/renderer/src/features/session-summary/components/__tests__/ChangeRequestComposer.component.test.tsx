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
    readonly provider?: SourceControlProviderId
    readonly isDefaultRef?: boolean
    readonly gitStatus?: GitStatusSummary | null
    readonly vcs?: VcsStatus
  } = {},
) {
  const onClose = vi.fn()
  const onCompleted = vi.fn()
  const renderResult = renderWithQueryClient(
    <ChangeRequestComposer
      session={SESSION}
      workingPath={WorkingPath('/project')}
      gitStatus={input.gitStatus === undefined ? GIT_STATUS : input.gitStatus}
      vcsStatus={input.vcs ?? vcsStatus(input.provider ?? 'github', input.isDefaultRef ?? true)}
      onClose={onClose}
      onCompleted={onCompleted}
    />,
  )
  return { onClose, onCompleted, queryClient: renderResult.client }
}

describe('ChangeRequestComposer', () => {
  beforeEach(() => {
    useUIStore.setState({ toastMessage: null, toastData: null })
    runStackedGitAction.mockReset().mockResolvedValue({
      ok: true,
      action: 'commit_push_pr',
      branch: { status: 'created', name: 'codex/explore-image-hub-parity' },
      changeRequest: {
        title: SESSION.title,
        url: 'https://github.com/openwaggle/openwaggle/pull/1',
        baseRef: 'main',
        headRef: 'codex/explore-image-hub-parity',
        state: 'open',
      },
      changeRequestOutput: { ok: true },
    })
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

  it('creates a GitHub PR from a new Codex branch and can commit local changes', async () => {
    const callbacks = renderComposer()
    const invalidateQueries = vi.spyOn(callbacks.queryClient, 'invalidateQueries')

    expect(screen.getByText('New branch → main')).toBeInTheDocument()
    expect(screen.getByLabelText('New branch name')).toHaveValue('codex/explore-image-hub-parity')
    expect(screen.getByRole('button', { name: 'Create draft PR' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))

    await waitFor(() =>
      expect(runStackedGitAction).toHaveBeenCalledWith(
        WorkingPath('/project'),
        expect.objectContaining({
          action: 'commit_push_pr',
          paths: ['src/hub.tsx'],
          createFeatureBranch: true,
          featureBranchName: 'codex/explore-image-hub-parity',
          exactFeatureBranchName: true,
          baseRef: 'main',
          draft: false,
        }),
      ),
    )
    expect(callbacks.onCompleted).toHaveBeenCalledOnce()
    expect(callbacks.onClose).toHaveBeenCalledOnce()
    expect(openExternal).not.toHaveBeenCalled()
    expect(recordSessionChangeRequest).not.toHaveBeenCalled()
    expect(invalidateQueries).toHaveBeenCalledOnce()
    expect(invalidateQueries).toHaveBeenCalledWith({ predicate: expect.any(Function) })
  })

  it('creates the normal request with the Codex modifier-enter shortcut', async () => {
    renderComposer({ gitStatus: null, isDefaultRef: false })

    fireEvent.keyDown(screen.getByDisplayValue(SESSION.title), {
      key: 'Enter',
      ctrlKey: true,
    })

    await waitFor(() =>
      expect(runStackedGitAction).toHaveBeenCalledWith(
        WorkingPath('/project'),
        expect.objectContaining({ action: 'create_pr', draft: false }),
      ),
    )
  })

  it('does not dismiss on Escape while request creation is running', async () => {
    runStackedGitAction.mockReturnValue(new Promise(() => {}))
    const callbacks = renderComposer({ isDefaultRef: false })
    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))
    await waitFor(() => expect(runStackedGitAction).toHaveBeenCalledOnce())

    const dialog = screen.getByRole('dialog', { name: 'Create pull request' })
    const cancelEvent = new Event('cancel', { bubbles: false, cancelable: true })
    fireEvent(dialog, cancelEvent)

    expect(cancelEvent.defaultPrevented).toBe(true)
    expect(dialog).toHaveAttribute('open')
    expect(callbacks.onClose).not.toHaveBeenCalled()
  })

  it('uses GitLab MR terminology and creates a draft without a new branch off default', async () => {
    runStackedGitAction.mockResolvedValue({
      ok: true,
      action: 'create_pr',
      branch: { status: 'unchanged', name: null },
      changeRequest: null,
    })
    renderComposer({ provider: 'gitlab', isDefaultRef: false, gitStatus: null })

    expect(screen.getByText('Create merge request')).toBeInTheDocument()
    expect(screen.queryByLabelText('New branch name')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Create draft MR' }))

    await waitFor(() =>
      expect(runStackedGitAction).toHaveBeenCalledWith(
        WorkingPath('/project'),
        expect.objectContaining({
          action: 'create_pr',
          createFeatureBranch: false,
          draft: true,
        }),
      ),
    )
  })

  it('uses the push-and-create workflow for a clean branch without an upstream', async () => {
    renderComposer({
      gitStatus: { ...GIT_STATUS, filesChanged: 0, changedFiles: [], clean: true, ahead: 2 },
      vcs: {
        ...vcsStatus('github', false),
        hasWorkingTreeChanges: false,
        hasUpstream: false,
        aheadCount: 2,
      },
    })

    expect(screen.queryByText('Commit and push local changes')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))

    await waitFor(() =>
      expect(runStackedGitAction).toHaveBeenCalledWith(
        WorkingPath('/project'),
        expect.objectContaining({ action: 'create_pr', createFeatureBranch: false }),
      ),
    )
  })

  it('does not create an empty feature branch when local changes are excluded', () => {
    renderComposer({
      vcs: { ...vcsStatus('github', true), aheadCount: 0 },
    })

    fireEvent.click(screen.getByRole('checkbox', { name: /Commit and push local changes/ }))

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Commit the local changes before creating a pull request from a new branch.',
    )
    expect(screen.getByRole('button', { name: 'Create draft PR' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Create PR' })).toBeDisabled()
    expect(runStackedGitAction).not.toHaveBeenCalled()
  })

  it('does not describe working changes when they are excluded from the request', async () => {
    renderComposer({
      vcs: { ...vcsStatus('github', true), aheadCount: 1 },
    })

    fireEvent.click(screen.getByRole('checkbox', { name: /Commit and push local changes/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))

    await waitFor(() => expect(runStackedGitAction).toHaveBeenCalledOnce())
    const options = runStackedGitAction.mock.calls[0]?.[1]
    expect(options.changeRequestBody).toContain(`- ${SESSION.title}`)
    expect(options.changeRequestBody).not.toContain('changed files')
    expect(options.changeRequestBody).not.toContain('+30 / -0')
  })

  it('does not create a second branch when the default ref is unknown', async () => {
    renderComposer({
      gitStatus: null,
      vcs: {
        ...vcsStatus('github', false),
        defaultRef: null,
        isDefaultRef: true,
        refName: 'feature/local-only',
      },
    })

    expect(screen.queryByLabelText('New branch name')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Create PR' }))

    await waitFor(() =>
      expect(runStackedGitAction).toHaveBeenCalledWith(
        WorkingPath('/project'),
        expect.objectContaining({ action: 'create_pr', createFeatureBranch: false }),
      ),
    )
  })
})
