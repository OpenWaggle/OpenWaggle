import type { SourceControlHostsOverview } from '@shared/types/git'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { SourceControlSection } from '../SourceControlSection'

const mocks = vi.hoisted(() => ({
  configureSourceControl: vi.fn(),
  copyToClipboard: vi.fn(),
  getChangeRequestOpenDestination: vi.fn(),
  getSourceControlHosts: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({ api: mocks }))

const OVERVIEW: SourceControlHostsOverview = {
  cliInstalled: { gh: true, glab: false },
  hosts: [
    {
      host: 'github.com',
      provider: 'github',
      source: 'public-host',
      cli: 'gh',
      unsupported: false,
      cliInstalled: true,
      accounts: [
        { login: 'me', active: true },
        { login: 'me-enterprise', active: false },
      ],
    },
    {
      host: 'git.corp.example',
      provider: 'gitlab',
      source: 'user-choice',
      cli: 'glab',
      unsupported: false,
      cliInstalled: false,
      accounts: [],
    },
    {
      host: 'ghe.corp.example',
      provider: 'github',
      source: 'cli-sign-in',
      cli: 'gh',
      unsupported: false,
      cliInstalled: true,
      accounts: [{ login: 'dev', active: true }],
    },
    {
      host: 'code.corp.example',
      provider: 'github',
      source: 'host-name',
      cli: 'gh',
      unsupported: false,
      cliInstalled: true,
      accounts: [],
    },
    {
      host: 'svn.corp.example',
      provider: null,
      unsupported: true,
      source: 'user-choice',
      cli: null,
      cliInstalled: false,
      accounts: [],
    },
  ],
}

function hostRow(host: string) {
  return screen.getByRole('listitem', { name: host })
}

describe('SourceControlSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSourceControlHosts.mockResolvedValue(OVERVIEW)
    mocks.getChangeRequestOpenDestination.mockResolvedValue({
      destination: 'inspector',
      source: 'default',
    })
    mocks.configureSourceControl.mockResolvedValue({ ok: true })
  })

  it('lists each host with its provider, how it was decided, and its sign-in state', async () => {
    renderWithQueryClient(<SourceControlSection />)

    const github = await screen.findByRole('listitem', { name: 'github.com' })
    expect(within(github).getByText('Public host')).toBeInTheDocument()
    expect(within(github).getByText('2 accounts')).toBeInTheDocument()
    const corp = hostRow('git.corp.example')
    expect(within(corp).getByText('Chosen by you')).toBeInTheDocument()
    expect(within(corp).getByText('glab not installed')).toBeInTheDocument()
    const enterprise = hostRow('ghe.corp.example')
    expect(within(enterprise).getByText('From your gh sign-in')).toBeInTheDocument()
    expect(within(enterprise).getByText('Signed in as @dev')).toBeInTheDocument()
    const named = hostRow('code.corp.example')
    expect(within(named).getByText('From the host name')).toBeInTheDocument()
    expect(within(named).getByText('Not signed in')).toBeInTheDocument()
    const unsupported = hostRow('svn.corp.example')
    expect(within(unsupported).getByText('Not GitHub or GitLab')).toBeInTheDocument()
    expect(within(unsupported).getByLabelText('Provider for svn.corp.example')).toHaveValue(
      'unsupported',
    )
  })

  it('marks a host as neither GitHub nor GitLab and resets it', async () => {
    renderWithQueryClient(<SourceControlSection />)
    await screen.findByRole('listitem', { name: 'github.com' })

    fireEvent.change(screen.getByLabelText('Provider for code.corp.example'), {
      target: { value: 'unsupported' },
    })
    await waitFor(() =>
      expect(mocks.configureSourceControl).toHaveBeenCalledWith({
        kind: 'set-host-provider',
        host: 'code.corp.example',
        provider: 'unsupported',
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Forget svn.corp.example' }))
    await waitFor(() =>
      expect(mocks.configureSourceControl).toHaveBeenLastCalledWith({
        kind: 'set-host-provider',
        host: 'svn.corp.example',
        provider: null,
      }),
    )
  })

  it('changes and forgets a host provider, then refreshes the list', async () => {
    renderWithQueryClient(<SourceControlSection />)
    await screen.findByRole('listitem', { name: 'github.com' })

    fireEvent.change(screen.getByLabelText('Provider for git.corp.example'), {
      target: { value: 'github' },
    })
    await waitFor(() =>
      expect(mocks.configureSourceControl).toHaveBeenCalledWith({
        kind: 'set-host-provider',
        host: 'git.corp.example',
        provider: 'github',
      }),
    )
    await waitFor(() => expect(mocks.getSourceControlHosts).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByRole('button', { name: 'Forget git.corp.example' }))
    await waitFor(() =>
      expect(mocks.configureSourceControl).toHaveBeenLastCalledWith({
        kind: 'set-host-provider',
        host: 'git.corp.example',
        provider: null,
      }),
    )
  })

  it('offers Forget only where it changes anything', async () => {
    renderWithQueryClient(<SourceControlSection />)
    await screen.findByRole('listitem', { name: 'github.com' })

    expect(screen.queryByRole('button', { name: 'Forget github.com' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Forget git.corp.example' })).toBeInTheDocument()
  })

  it('shows the sign-in command to run, since terminals belong to Sessions', async () => {
    renderWithQueryClient(<SourceControlSection />)
    await screen.findByRole('listitem', { name: 'github.com' })

    fireEvent.click(screen.getByRole('button', { name: 'Sign in to code.corp.example' }))
    expect(
      screen.getByText(
        'env -u GITHUB_TOKEN -u GH_TOKEN -u GITHUB_ENTERPRISE_TOKEN -u GH_ENTERPRISE_TOKEN gh auth login --hostname code.corp.example',
      ),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Add account for github.com' }))
    expect(
      screen.getByText(
        'env -u GITHUB_TOKEN -u GH_TOKEN -u GITHUB_ENTERPRISE_TOKEN -u GH_ENTERPRISE_TOKEN gh auth login --hostname github.com',
      ),
    ).toBeInTheDocument()
  })

  it('adds a host with its provider', async () => {
    renderWithQueryClient(<SourceControlSection />)
    await screen.findByRole('listitem', { name: 'github.com' })

    fireEvent.click(screen.getByRole('button', { name: 'Add host…' }))
    fireEvent.change(screen.getByLabelText('Hostname'), {
      target: { value: '  Git.New.Example ' },
    })
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'gitlab' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() =>
      expect(mocks.configureSourceControl).toHaveBeenCalledWith({
        kind: 'set-host-provider',
        host: 'git.new.example',
        provider: 'gitlab',
      }),
    )
    await waitFor(() => expect(screen.queryByLabelText('Hostname')).toBeNull())
  })

  it('keeps the add form open with the reason when the host is rejected', async () => {
    mocks.configureSourceControl.mockResolvedValue({ ok: false, message: 'Not a hostname.' })
    renderWithQueryClient(<SourceControlSection />)
    await screen.findByRole('listitem', { name: 'github.com' })

    fireEvent.click(screen.getByRole('button', { name: 'Add host…' }))
    fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: 'bad host' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Not a hostname.')
    expect(screen.getByLabelText('Hostname')).toBeInTheDocument()
  })

  it('chooses where pull and merge requests open for the user', async () => {
    renderWithQueryClient(<SourceControlSection />)
    const group = await screen.findByRole('radiogroup', {
      name: 'Open pull and merge requests in',
    })
    await waitFor(() =>
      expect(within(group).getByRole('radio', { name: 'OpenWaggle' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    )

    fireEvent.click(within(group).getByRole('radio', { name: 'Provider website' }))

    await waitFor(() =>
      expect(mocks.configureSourceControl).toHaveBeenCalledWith({
        kind: 'set-open-destination',
        scope: 'user',
        destination: 'website',
      }),
    )
    expect(mocks.getChangeRequestOpenDestination).toHaveBeenCalledWith(null)
    await waitFor(() => expect(mocks.getChangeRequestOpenDestination).toHaveBeenCalledTimes(2))
  })

  it('saves the user choice even when it matches an inherited project value', async () => {
    mocks.getChangeRequestOpenDestination.mockResolvedValue({
      destination: 'website',
      source: 'project-shared',
    })
    renderWithQueryClient(<SourceControlSection />)
    const website = await screen.findByRole('radio', { name: 'Provider website' })
    await waitFor(() => expect(website).toHaveAttribute('aria-checked', 'true'))

    fireEvent.click(website)

    await waitFor(() =>
      expect(mocks.configureSourceControl).toHaveBeenCalledWith({
        kind: 'set-open-destination',
        scope: 'user',
        destination: 'website',
      }),
    )
  })

  it('does not rewrite a choice the user already made', async () => {
    mocks.getChangeRequestOpenDestination.mockResolvedValue({
      destination: 'website',
      source: 'user',
    })
    renderWithQueryClient(<SourceControlSection />)
    const website = await screen.findByRole('radio', { name: 'Provider website' })
    await waitFor(() => expect(website).toHaveAttribute('aria-checked', 'true'))

    fireEvent.click(website)

    expect(mocks.configureSourceControl).not.toHaveBeenCalled()
  })

  it('switches destination from the keyboard', async () => {
    renderWithQueryClient(<SourceControlSection />)
    const openWaggle = await screen.findByRole('radio', { name: 'OpenWaggle' })
    await waitFor(() => expect(openWaggle).toHaveAttribute('tabindex', '0'))
    await waitFor(() => expect(openWaggle).not.toHaveAttribute('aria-disabled'))
    openWaggle.focus()

    fireEvent.keyDown(openWaggle, { key: 'ArrowRight' })

    expect(screen.getByRole('radio', { name: 'Provider website' })).toHaveFocus()
    await waitFor(() =>
      expect(mocks.configureSourceControl).toHaveBeenCalledWith({
        kind: 'set-open-destination',
        scope: 'user',
        destination: 'website',
      }),
    )
  })

  it('says why the destination could not be read', async () => {
    mocks.getChangeRequestOpenDestination.mockRejectedValue(new Error('Host is too old.'))
    renderWithQueryClient(<SourceControlSection />)

    expect(
      await screen.findByText('Could not read this setting: Host is too old.'),
    ).toBeInTheDocument()
  })
})
