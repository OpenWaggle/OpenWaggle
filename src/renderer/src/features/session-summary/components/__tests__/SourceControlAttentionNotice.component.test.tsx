import type { SourceControlAttention } from '@shared/types/git'
import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@/features/settings/state'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { SourceControlAttentionNotice } from '../SourceControlAttentionNotice'

const mocks = vi.hoisted(() => ({
  configureSourceControl: vi.fn(),
  copyToClipboard: vi.fn(),
  openExternal: vi.fn(),
  runSessionTerminalCommand: vi.fn(),
  watchSessionTerminalCommand: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    configureSourceControl: mocks.configureSourceControl,
    copyToClipboard: mocks.copyToClipboard,
    openExternal: mocks.openExternal,
  },
}))

vi.mock('@/features/terminal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/terminal')>()),
  runSessionTerminalCommand: mocks.runSessionTerminalCommand,
  watchSessionTerminalCommand: mocks.watchSessionTerminalCommand,
}))

const TERMINAL = { ownerKey: 'session-a', cwd: '/repo/session-a' }

const NOT_SIGNED_IN = {
  kind: 'not-signed-in',
  provider: 'github',
  host: 'github.example.com',
  cli: 'gh',
  environmentTokenIgnored: true,
  ignoredTokenVariables: ['GITHUB_TOKEN', 'GH_TOKEN'],
} as const satisfies SourceControlAttention

function renderNotice(
  attention: SourceControlAttention,
  options: {
    readonly terminal?: typeof TERMINAL | null
    readonly websiteUrl?: string
    readonly onRecheck?: () => Promise<void>
  } = {},
) {
  const onRecheck = vi.fn(options.onRecheck ?? (() => Promise.resolve()))
  renderWithQueryClient(
    <SourceControlAttentionNotice
      label="Change request setup"
      attention={attention}
      terminal={options.terminal === undefined ? TERMINAL : options.terminal}
      websiteUrl={options.websiteUrl ?? null}
      onRecheck={onRecheck}
    />,
  )
  return { onRecheck }
}

function finishTerminalCommand() {
  const finished = mocks.watchSessionTerminalCommand.mock.calls.at(-1)?.[2]
  act(() => finished?.())
}

describe('SourceControlAttentionNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.configureSourceControl.mockResolvedValue({ ok: true })
    mocks.openExternal.mockResolvedValue(undefined)
    mocks.runSessionTerminalCommand.mockReturnValue('terminal-1')
    mocks.watchSessionTerminalCommand.mockReturnValue(() => undefined)
    usePreferencesStore.setState({
      settings: { ...DEFAULT_SETTINGS, browserLinkTarget: 'system' },
      isLoaded: true,
    })
  })

  it('names its landmark per surface', () => {
    renderNotice({ kind: 'choose-provider', host: 'git.corp.example' })

    expect(screen.getByRole('region', { name: 'Change request setup' })).toBeInTheDocument()
  })

  it.each([
    ['GitHub', 'github'],
    ['GitLab', 'gitlab'],
    ['Neither', 'unsupported'],
  ] as const)('records %s as the provider of an unknown host', async (label, provider) => {
    const { onRecheck } = renderNotice({ kind: 'choose-provider', host: 'git.corp.example' })

    expect(screen.getByText('Is git.corp.example GitHub or GitLab?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: label }))

    await waitFor(() => expect(onRecheck).toHaveBeenCalledOnce())
    expect(mocks.configureSourceControl).toHaveBeenCalledWith({
      kind: 'set-host-provider',
      host: 'git.corp.example',
      provider,
    })
    expect(screen.getByRole('region', { name: 'Change request setup' })).toHaveFocus()
  })

  it('shows why a configuration change failed, keeping focus on the choice', async () => {
    mocks.configureSourceControl.mockResolvedValue({ ok: false, message: 'Settings are locked.' })
    const { onRecheck } = renderNotice({ kind: 'choose-provider', host: 'git.corp.example' })
    const github = screen.getByRole('button', { name: 'GitHub' })
    github.focus()

    fireEvent.click(github)

    expect(await screen.findByRole('alert')).toHaveTextContent('Settings are locked.')
    expect(onRecheck).not.toHaveBeenCalled()
    expect(github).toHaveFocus()
  })

  it.each([
    ['Allow', 'approved'],
    ['Ignore', 'declined'],
  ] as const)('records %s for a project host declaration', async (label, decision) => {
    const hosts = { 'git.corp.example': 'gitlab' } as const
    const { onRecheck } = renderNotice({
      kind: 'approve-declaration',
      projectPath: '/repo',
      hosts,
    })

    expect(screen.getByText('This project says git.corp.example is GitLab.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: label }))

    await waitFor(() => expect(onRecheck).toHaveBeenCalledOnce())
    expect(mocks.configureSourceControl).toHaveBeenCalledWith({
      kind: 'decide-project-declaration',
      projectPath: '/repo',
      decision,
      hosts,
    })
    expect(screen.getByRole('region', { name: 'Change request setup' })).toHaveFocus()
  })

  it('links the install guide and re-checks with a visible status on window focus', async () => {
    let finish: () => void = () => undefined
    const { onRecheck } = renderNotice(
      { kind: 'cli-missing', provider: 'gitlab', host: 'gitlab.com', cli: 'glab' },
      { onRecheck: () => new Promise<void>((resolve) => (finish = resolve)) },
    )

    expect(screen.getByText('Install glab to see merge requests')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Install guide' }))
    await waitFor(() =>
      expect(mocks.openExternal).toHaveBeenCalledWith(
        'https://gitlab.com/gitlab-org/cli#installation',
      ),
    )
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(onRecheck).toHaveBeenCalledOnce()
    expect(screen.getByRole('status')).toHaveTextContent('Checking…')
    await act(async () => finish())
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('signs in through one fresh Session terminal and re-checks when the command ends', async () => {
    const { onRecheck } = renderNotice(NOT_SIGNED_IN)

    expect(
      screen.getByText("OpenWaggle uses gh's stored sign-in, not GITHUB_TOKEN or GH_TOKEN."),
    ).toBeInTheDocument()
    const signIn = screen.getByRole('button', { name: 'Sign in to github.example.com' })
    fireEvent.click(signIn)
    fireEvent.click(signIn)

    expect(mocks.runSessionTerminalCommand).toHaveBeenCalledOnce()
    expect(mocks.runSessionTerminalCommand).toHaveBeenCalledWith({
      ownerKey: 'session-a',
      cwd: '/repo/session-a',
      command:
        'env -u GITHUB_TOKEN -u GH_TOKEN -u GITHUB_ENTERPRISE_TOKEN -u GH_ENTERPRISE_TOKEN gh auth login --hostname github.example.com',
      title: 'Sign in · github.example.com',
    })
    expect(signIn).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Finish signing in in the terminal.')
    expect(mocks.watchSessionTerminalCommand).toHaveBeenCalledWith(
      'session-a',
      'terminal-1',
      expect.any(Function),
    )

    finishTerminalCommand()

    expect(onRecheck).toHaveBeenCalledOnce()
    await waitFor(() => expect(signIn).not.toHaveAttribute('aria-disabled'))
  })

  it('shows the sign-in command when no Session terminal is available', () => {
    renderNotice(
      {
        ...NOT_SIGNED_IN,
        provider: 'gitlab',
        host: 'gitlab.example.com',
        cli: 'glab',
        environmentTokenIgnored: false,
        ignoredTokenVariables: [],
      },
      { terminal: null },
    )

    expect(
      screen.getByText(
        'env -u GITLAB_TOKEN -u GITLAB_ACCESS_TOKEN -u GITLAB_PRIVATE_TOKEN glab auth login --hostname gitlab.example.com',
      ),
    ).toBeInTheDocument()
    expect(screen.queryByText(/stored sign-in/)).toBeNull()
  })

  it('offers another account when none can see the repository', () => {
    renderNotice({
      kind: 'no-account-access',
      provider: 'github',
      host: 'github.com',
      cli: 'gh',
      repository: 'acme/secret',
      accounts: ['me'],
    })

    expect(screen.getByText('None of your GitHub accounts can see acme/secret')).toBeInTheDocument()
    expect(screen.getByText('Tried @me.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with another account' }))
    expect(mocks.runSessionTerminalCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        command:
          'env -u GITHUB_TOKEN -u GH_TOKEN -u GITHUB_ENTERPRISE_TOKEN -u GH_ENTERPRISE_TOKEN gh auth login --hostname github.com',
      }),
    )
  })

  it.each([
    ['https://gitlab.com/o/r', 'Open on GitLab'],
    ['https://git.corp.example/o/r', 'Open on git.corp.example'],
  ])('always leaves the provider site open as a way out (%s)', async (url, label) => {
    renderNotice({ kind: 'choose-provider', host: 'git.corp.example' }, { websiteUrl: url })

    fireEvent.click(screen.getByRole('button', { name: label }))
    await waitFor(() => expect(mocks.openExternal).toHaveBeenCalledWith(url))
  })
})
