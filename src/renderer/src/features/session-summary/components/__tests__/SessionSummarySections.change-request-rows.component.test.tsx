import { SessionId } from '@shared/types/brand'
import type { VcsStatus } from '@shared/types/git'
import type { SessionResource } from '@shared/types/session-resource'
import { fireEvent, render, screen } from '@testing-library/react'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import type { ChangeRequestOpener } from '../ChangeRequestLinkRow'
import { EnvironmentSummarySection, SessionChangeRequestsSection } from '../SessionSummarySections'

vi.mock('@/shared/lib/ipc', () => ({ api: { configureSourceControl: vi.fn() } }))

function opener(destination: ChangeRequestOpener['destination'] = 'inspector') {
  return {
    destination,
    openInInspector: vi.fn<(url: string) => void>(),
    openOnWebsite: vi.fn<(url: string) => void>(),
  } satisfies ChangeRequestOpener
}

const EXISTING_REQUEST = {
  title: 'Lifecycle',
  url: 'https://github.com/o/r/pull/7',
  baseRef: 'main',
  headRef: 'feature',
  state: 'open',
} as const

const GITHUB_STATUS = fromPartial<VcsStatus>({
  isRepo: true,
  sourceControlProvider: { id: 'github', host: 'github.com' },
  sourceControlAttention: null,
  sourceControlRepositoryUrl: 'https://github.com/o/r',
  changeRequestAttention: null,
  changeRequest: null,
})

function input(
  remoteVcsState: 'loading' | 'loaded' | 'error' | 'unavailable',
  onCreateChangeRequest = vi.fn(),
  onRefreshVcsStatus = vi.fn(),
  changeRequestOpener: ChangeRequestOpener = opener(),
) {
  return {
    expanded: true,
    environmentMode: 'local' as const,
    workingPath: null,
    gitStatus: null,
    vcsStatus: GITHUB_STATUS,
    remoteVcsState,
    localVcsState: 'loaded' as const,
    branches: [],
    branchBusy: false,
    branchError: null,
    onExpandedChange: vi.fn(),
    onOpenDiff: vi.fn(),
    onCreateChangeRequest,
    changeRequestOpener,
    sourceControlTerminal: null,
    onToggleTerminal: vi.fn(),
    onRefreshBranches: vi.fn(),
    onRefreshVcsStatus,
    onRecheckSourceControl: vi.fn(async () => undefined),
    onSelectBranch: vi.fn().mockResolvedValue(true),
    onCreateBranch: vi.fn().mockResolvedValue(true),
    quickAction: {
      kind: 'show_hint' as const,
      label: 'Commit or push',
      disabled: true,
      hint: 'Unavailable',
    },
    onQuickAction: vi.fn(),
  }
}

describe('Session Summary change request rows', () => {
  it('opens an existing request in the inspector by default and the website on request', () => {
    const open = opener('inspector')
    render(
      <EnvironmentSummarySection
        input={{
          ...input('loaded', vi.fn(), vi.fn(), open),
          vcsStatus: { ...GITHUB_STATUS, changeRequest: EXISTING_REQUEST },
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'View PR' }))
    expect(open.openInInspector).toHaveBeenCalledWith('https://github.com/o/r/pull/7')
    fireEvent.click(screen.getByRole('button', { name: 'Open on GitHub' }))
    fireEvent.click(screen.getByRole('button', { name: 'View PR' }), { metaKey: true })
    fireEvent.click(screen.getByRole('button', { name: 'View PR' }), { ctrlKey: true })
    expect(open.openOnWebsite).toHaveBeenCalledTimes(3)
    expect(open.openInInspector).toHaveBeenCalledOnce()
  })

  it('flips both actions when the provider website is the open destination', () => {
    const open = opener('website')
    render(
      <EnvironmentSummarySection
        input={{
          ...input('loaded', vi.fn(), vi.fn(), open),
          vcsStatus: {
            ...GITHUB_STATUS,
            sourceControlProvider: { id: 'gitlab', host: 'gitlab.com' },
            changeRequest: {
              ...EXISTING_REQUEST,
              url: 'https://gitlab.com/o/r/-/merge_requests/3',
            },
          },
        }}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'View MR' }))
    expect(open.openOnWebsite).toHaveBeenCalledWith('https://gitlab.com/o/r/-/merge_requests/3')
    fireEvent.click(screen.getByRole('button', { name: 'Open in OpenWaggle' }))
    fireEvent.click(screen.getByRole('button', { name: 'View MR' }), { ctrlKey: true })
    expect(open.openInInspector).toHaveBeenCalledTimes(2)
    expect(open.openOnWebsite).toHaveBeenCalledOnce()
  })

  it('shows a source-control attention row even before a provider is known', () => {
    renderWithQueryClient(
      <EnvironmentSummarySection
        input={{
          ...input('loaded'),
          vcsStatus: fromPartial<VcsStatus>({
            ...GITHUB_STATUS,
            sourceControlProvider: null,
            sourceControlAttention: { kind: 'choose-provider', host: 'git.corp.example' },
          }),
        }}
      />,
    )

    expect(screen.getByText('Is git.corp.example GitHub or GitLab?')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create PR' })).toBeNull()
  })

  it('shows why the remote cannot find change requests instead of offering creation', () => {
    renderWithQueryClient(
      <EnvironmentSummarySection
        input={{
          ...input('loaded'),
          vcsStatus: fromPartial<VcsStatus>({
            ...GITHUB_STATUS,
            changeRequestAttention: {
              kind: 'not-signed-in',
              provider: 'github',
              host: 'github.com',
              cli: 'gh',
              environmentTokenIgnored: false,
              ignoredTokenVariables: [],
            },
          }),
        }}
      />,
    )

    expect(screen.getByText('Not signed in to github.com')).toBeInTheDocument()
    expect(
      screen.getByText(
        'env -u GITHUB_TOKEN -u GH_TOKEN -u GITHUB_ENTERPRISE_TOKEN -u GH_ENTERPRISE_TOKEN gh auth login --hostname github.com',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create PR' })).toBeNull()
  })

  it('discovers only additional Session-owned requests without duplicating the current one', () => {
    const open = opener('inspector')
    const resource = (id: string, title: string, locator: string) =>
      fromPartial<SessionResource>({
        id,
        sessionId: SessionId('session-a'),
        kind: 'change-request',
        title,
        locator,
        isOutput: true,
      })
    render(
      <SessionChangeRequestsSection
        resources={[
          resource('current', 'Current', 'https://github.com/o/r/pull/7?diff=split'),
          resource('other', 'Another Session request', 'https://github.com/o/r/pull/8'),
          fromPartial<SessionResource>({
            id: 'foreign-kind',
            sessionId: SessionId('session-a'),
            kind: 'link',
            title: 'Not a request',
            locator: 'https://github.com/o/r/pull/9',
            isOutput: true,
          }),
        ]}
        currentUrl="https://github.com/o/r/pull/7"
        remote={{ id: 'github', host: 'github.com' }}
        expanded
        onExpandedChange={vi.fn()}
        opener={open}
      />,
    )

    expect(screen.getByRole('button', { name: 'Other pull requests 1' })).toBeInTheDocument()
    expect(screen.queryByText('Current')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Another Session request' }))
    expect(open.openInInspector).toHaveBeenCalledWith('https://github.com/o/r/pull/8')
    fireEvent.click(screen.getByRole('button', { name: 'Open on GitHub' }))
    expect(open.openOnWebsite).toHaveBeenCalledWith('https://github.com/o/r/pull/8')
  })

  it('names the provider of a request that lives on another host', () => {
    const open = opener('inspector')
    render(
      <SessionChangeRequestsSection
        resources={[
          fromPartial<SessionResource>({
            id: 'upstream',
            sessionId: SessionId('session-a'),
            kind: 'change-request',
            title: 'Upstream request',
            locator: 'https://gitlab.com/o/r/-/merge_requests/9',
            isOutput: true,
          }),
        ]}
        currentUrl={null}
        remote={{ id: 'github', host: 'github.com' }}
        expanded
        onExpandedChange={vi.fn()}
        opener={open}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open on GitLab' }))
    expect(open.openOnWebsite).toHaveBeenCalledWith('https://gitlab.com/o/r/-/merge_requests/9')
  })

  it('links the repository site from an attention row', () => {
    renderWithQueryClient(
      <EnvironmentSummarySection
        input={{
          ...input('loaded'),
          vcsStatus: fromPartial<VcsStatus>({
            ...GITHUB_STATUS,
            sourceControlProvider: null,
            sourceControlAttention: { kind: 'choose-provider', host: 'git.corp.example' },
            sourceControlRepositoryUrl: 'https://git.corp.example/o/r',
          }),
        }}
      />,
    )

    expect(screen.getByRole('button', { name: 'Open on git.corp.example' })).toBeInTheDocument()
  })
})
