import { SessionId, WorkingPath } from '@shared/types/brand'
import type { GitStatusSummary, SourceControlProviderId, VcsStatus } from '@shared/types/git'
import type { OpenWaggleApi } from '@shared/types/openwaggle-api'
import type { SessionDetail } from '@shared/types/session'
import type { QueryClient } from '@tanstack/react-query'
import { screen } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { type Mock, vi } from 'vitest'
import { useUIStore } from '@/shell/ui-store'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'

const mocks = vi.hoisted(() => ({
  runStackedGitAction: vi.fn<OpenWaggleApi['runStackedGitAction']>(),
  preflightChangeRequest: vi.fn<OpenWaggleApi['preflightChangeRequest']>(),
  openExternal: vi.fn<OpenWaggleApi['openExternal']>(),
  recordSessionChangeRequest: vi.fn<OpenWaggleApi['recordSessionChangeRequest']>(),
}))

export const runStackedGitAction: Mock<OpenWaggleApi['runStackedGitAction']> =
  mocks.runStackedGitAction
export const preflightChangeRequest: Mock<OpenWaggleApi['preflightChangeRequest']> =
  mocks.preflightChangeRequest
export const openExternal: Mock<OpenWaggleApi['openExternal']> = mocks.openExternal
export const recordSessionChangeRequest: Mock<OpenWaggleApi['recordSessionChangeRequest']> =
  mocks.recordSessionChangeRequest

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    runStackedGitAction: mocks.runStackedGitAction,
    preflightChangeRequest: mocks.preflightChangeRequest,
    openExternal: mocks.openExternal,
    recordSessionChangeRequest: mocks.recordSessionChangeRequest,
  },
}))

import { ChangeRequestComposer } from '../ChangeRequestComposer'

export const SESSION: SessionDetail = {
  id: SessionId('session-1'),
  title: 'Explore image hub parity',
  projectPath: '/project',
  messages: [],
  createdAt: 1000,
  updatedAt: 1000,
}

export const GIT_STATUS: GitStatusSummary = {
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

export function vcsStatus(provider: SourceControlProviderId, isDefaultRef: boolean): VcsStatus {
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

interface ComposerRenderResult {
  readonly onClose: Mock<() => void>
  readonly onCompleted: Mock<() => void>
  readonly queryClient: QueryClient
}

export function renderComposer(
  input: {
    readonly provider?: SourceControlProviderId
    readonly isDefaultRef?: boolean
    readonly gitStatus?: GitStatusSummary | null
    readonly vcs?: VcsStatus
  } = {},
): ComposerRenderResult {
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

export function setupChangeRequestComposerMocks() {
  useUIStore.setState({ toastMessage: null, toastData: null })
  runStackedGitAction.mockReset().mockResolvedValue({
    ok: true,
    action: 'commit_push_pr',
    branch: { status: 'created', name: 'codex/explore-image-hub-parity' },
    commit: {
      commitHash: '0123456789abcdef0123456789abcdef01234567',
      summary: SESSION.title,
    },
    changeRequest: {
      title: SESSION.title,
      url: 'https://github.com/openwaggle/openwaggle/pull/1',
      baseRef: 'main',
      headRef: 'codex/explore-image-hub-parity',
      state: 'open',
    },
  })
  preflightChangeRequest.mockReset().mockResolvedValue({
    provider: { id: 'github', host: 'github.com' },
    readiness: {
      ok: true,
      status: { authenticated: true, account: 'octocat', host: 'github.com' },
    },
    browserUrl:
      'https://github.com/openwaggle/openwaggle/compare?expand=1&title=Explore+image+hub+parity',
  })
  openExternal.mockReset().mockResolvedValue(undefined)
  recordSessionChangeRequest.mockReset().mockResolvedValue(
    fromPartial({
      id: 'change-request-resource',
    }),
  )
}

export async function waitForNativeCreationReady(provider = 'GitHub') {
  await screen.findByText(`${provider} CLI ready as octocat.`)
}
