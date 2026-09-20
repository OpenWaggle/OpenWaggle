import type { ScopedAuthorizationGrant } from '@shared/types/agent-authorization-grants'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getProjectPreferencesMock,
  setProjectPreferencesMock,
  listAuthorizationGrantsMock,
  revokeAuthorizationMock,
  updateSettingsMock,
  manageAccessProfilesMock,
  getCliShimStatusMock,
} = vi.hoisted(() => ({
  getProjectPreferencesMock: vi.fn(),
  setProjectPreferencesMock: vi.fn(),
  listAuthorizationGrantsMock: vi.fn(),
  revokeAuthorizationMock: vi.fn(),
  updateSettingsMock: vi.fn(),
  manageAccessProfilesMock: vi.fn(),
  getCliShimStatusMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getProjectPreferences: getProjectPreferencesMock,
    setProjectPreferences: setProjectPreferencesMock,
    listAuthorizationGrants: listAuthorizationGrantsMock,
    revokeAuthorization: revokeAuthorizationMock,
    updateSettings: updateSettingsMock,
    manageAccessProfiles: manageAccessProfilesMock,
    getCliShimStatus: getCliShimStatusMock,
  },
}))

import { usePreferencesStore } from '@/features/settings/state'
import { AgentAccessSection } from '../sections/AgentAccessSection'
import { PermissionsSection } from '../sections/PermissionsSection'

const PROJECT = '/tmp/project'

const listIssuesGrant: ScopedAuthorizationGrant = {
  requester: 'github-issues',
  requesterId: 'github-issues-id',
  capability: 'mcp.tool-call',
  resource: 'list_issues',
  grantedAt: 1,
}

const samplingGrant: ScopedAuthorizationGrant = {
  requester: 'github-issues',
  requesterId: 'github-issues-id',
  capability: 'mcp.sampling',
  grantedAt: 2,
}

function setProjectPath(projectPath: string | null) {
  const initial = usePreferencesStore.getInitialState()
  usePreferencesStore.setState({
    ...initial,
    settings: { ...initial.settings, projectPath },
  })
}

describe('AgentAccessSection', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    getProjectPreferencesMock.mockResolvedValue(null)
    setProjectPreferencesMock.mockResolvedValue(undefined)
    listAuthorizationGrantsMock.mockResolvedValue([])
    revokeAuthorizationMock.mockResolvedValue(undefined)
    updateSettingsMock.mockResolvedValue(undefined)
    getCliShimStatusMock.mockResolvedValue({
      management: 'user-shim',
      state: 'not-installed',
      commandPath: '/tmp/openwaggle',
      onPath: true,
    })
    setProjectPath(PROJECT)
  })

  it('offers an explicit way to stop overriding the default', async () => {
    // Without this option a project override could never be removed, so a later change to the
    // global default would silently have no effect for that project.
    getProjectPreferencesMock.mockResolvedValue({ authorizationMode: 'ask-for-approval' })
    render(<AgentAccessSection />)

    const select = screen.getByRole('combobox', { name: 'Selected project access mode' })
    await waitFor(() => {
      expect(select).toHaveValue('ask-for-approval')
    })

    fireEvent.change(select, { target: { value: 'inherit' } })

    await waitFor(() => {
      expect(setProjectPreferencesMock).toHaveBeenCalledWith(PROJECT, {
        authorizationMode: null,
      })
    })
  })

  it('lets the user inspect permissions for a named project without CLI or Hive controls', async () => {
    const initial = usePreferencesStore.getState().settings
    usePreferencesStore.setState({
      settings: { ...initial, recentProjects: [PROJECT, '/tmp/another-project'] },
    })
    render(<PermissionsSection />)

    expect(screen.getByRole('button', { name: 'Project: project' })).toBeInTheDocument()
    expect(screen.queryByText('OpenWaggle CLI')).not.toBeInTheDocument()
    expect(screen.queryByText('Multi-agent sessions')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Project: project' }))
    fireEvent.click(screen.getByRole('button', { name: 'another-project (/tmp/another-project)' }))

    await waitFor(() => {
      expect(getProjectPreferencesMock).toHaveBeenCalledWith('/tmp/another-project')
      expect(listAuthorizationGrantsMock).toHaveBeenCalledWith('/tmp/another-project')
    })
  })

  it('shows a project with no override as using the default', async () => {
    render(<AgentAccessSection />)

    await waitFor(() => {
      expect(screen.getByText('This project uses the default above.')).toBeInTheDocument()
    })
    expect(screen.getByRole('combobox', { name: 'Selected project access mode' })).toHaveValue(
      'inherit',
    )
  })

  it('does not claim a project inherits the default when its access mode cannot be read', async () => {
    getProjectPreferencesMock.mockRejectedValue(new Error('host unavailable'))
    render(<AgentAccessSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not load this project’s access mode',
    )
    expect(screen.getByRole('combobox', { name: 'Selected project access mode' })).toBeDisabled()
    expect(screen.queryByText('This project uses the default above.')).not.toBeInTheDocument()
  })

  it('does not claim no saved approvals when their read fails, and can retry', async () => {
    listAuthorizationGrantsMock
      .mockRejectedValueOnce(new Error('host unavailable'))
      .mockResolvedValueOnce([listIssuesGrant])
    render(<AgentAccessSection />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load saved approvals')
    expect(
      screen.queryByText(
        'This project has no saved approvals. Approvals you keep will appear here.',
      ),
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading approvals' }))

    expect(await screen.findByText('github-issues')).toBeInTheDocument()
    expect(listAuthorizationGrantsMock).toHaveBeenCalledTimes(2)
  })

  it('lists a saved approval with its requester, capability and resource', async () => {
    listAuthorizationGrantsMock.mockResolvedValue([listIssuesGrant])
    render(<AgentAccessSection />)

    await waitFor(() => {
      expect(screen.getByText('github-issues')).toBeInTheDocument()
    })
    expect(screen.getByText('Run a tool · list_issues')).toBeInTheDocument()
  })

  it('names the capability alone when a grant has no resource', async () => {
    listAuthorizationGrantsMock.mockResolvedValue([samplingGrant])
    render(<AgentAccessSection />)

    await waitFor(() => {
      expect(screen.getByText('Use your model')).toBeInTheDocument()
    })
  })

  it('says that revoking is not retroactive', async () => {
    render(<AgentAccessSection />)

    expect(
      screen.getByText('Revoking stops future use. It does not recall work already done.'),
    ).toBeInTheDocument()
  })

  it('revokes the exact key and reloads the list', async () => {
    listAuthorizationGrantsMock.mockResolvedValueOnce([listIssuesGrant]).mockResolvedValueOnce([])
    render(<AgentAccessSection />)

    const revoke = await screen.findByRole('button', {
      name: 'Revoke Run a tool · list_issues for github-issues',
    })
    fireEvent.click(revoke)

    await waitFor(() => {
      expect(revokeAuthorizationMock).toHaveBeenCalledWith(PROJECT, {
        requester: 'github-issues',
        requesterId: 'github-issues-id',
        capability: 'mcp.tool-call',
        resource: 'list_issues',
      })
    })
    await waitFor(() => {
      expect(listAuthorizationGrantsMock).toHaveBeenCalledTimes(2)
    })
  })

  it('tells the user to open a project when none is open', () => {
    setProjectPath(null)
    render(<AgentAccessSection />)

    expect(screen.getByText('Open a project to see what it has approved.')).toBeInTheDocument()
    expect(listAuthorizationGrantsMock).not.toHaveBeenCalled()
  })

  it('reports an empty project rather than an empty card', async () => {
    render(<AgentAccessSection />)

    await waitFor(() => {
      expect(
        screen.getByText(
          'This project has no saved approvals. Approvals you keep will appear here.',
        ),
      ).toBeInTheDocument()
    })
  })
})
