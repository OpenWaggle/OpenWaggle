import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { manageAccessProfilesMock, showConfirmMock } = vi.hoisted(() => ({
  manageAccessProfilesMock: vi.fn(),
  showConfirmMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    manageAccessProfiles: manageAccessProfilesMock,
    showConfirm: showConfirmMock,
  },
}))

import { usePreferencesStore } from '@/features/settings/state'
import { RestrictedCliProfilesCard } from '../sections/RestrictedCliProfilesCard'

const PROFILE = {
  id: 'profile-review',
  name: 'review-bot',
  capabilities: ['sessions:discover', 'sessions:read'] as const,
  scope: { projectPaths: ['/project'] },
  authorizationCeiling: 'ask-for-approval' as const,
  revokedAt: null,
  lastAuthenticatedAt: null,
  createdAt: 1,
  updatedAt: 1,
}

function response(outcome: unknown) {
  return {
    contractVersion: 1,
    requestId: 'request',
    idempotencyKey: 'key',
    replayed: false,
    outcome,
  }
}

describe('RestrictedCliProfilesCard', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    const initial = usePreferencesStore.getInitialState()
    usePreferencesStore.setState({
      ...initial,
      settings: { ...initial.settings, projectPath: '/project' },
    })
    manageAccessProfilesMock.mockResolvedValue(
      response({ operation: 'list', effect: 'profiles-listed', profiles: [PROFILE] }),
    )
    showConfirmMock.mockResolvedValue(true)
  })

  it('stays collapsed until requested and then lists scoped profiles', async () => {
    render(<RestrictedCliProfilesCard />)

    expect(manageAccessProfilesMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Restricted CLI profiles/ }))

    expect(await screen.findByText('review-bot')).toBeInTheDocument()
    expect(screen.getByText(/2 capabilities · 1 scoped target/)).toBeInTheDocument()
    expect(manageAccessProfilesMock).toHaveBeenCalledWith({ operation: 'list' })
  })

  it('creates a profile from an explicit policy without exposing a credential', async () => {
    manageAccessProfilesMock
      .mockResolvedValueOnce(
        response({ operation: 'list', effect: 'profiles-listed', profiles: [] }),
      )
      .mockResolvedValueOnce(
        response({ operation: 'create', effect: 'profile-created', profile: PROFILE }),
      )
    render(<RestrictedCliProfilesCard />)
    fireEvent.click(screen.getByRole('button', { name: /Restricted CLI profiles/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'New profile' }))

    fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: 'review-bot' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create profile' }))

    await waitFor(() => {
      expect(manageAccessProfilesMock).toHaveBeenLastCalledWith({
        operation: 'create',
        name: 'review-bot',
        capabilities: ['sessions:discover', 'sessions:read'],
        scope: { projectPaths: ['/project'] },
        authorizationCeiling: 'ask-for-approval',
      })
    })
    expect(JSON.stringify(manageAccessProfilesMock.mock.calls)).not.toContain('credential')
  })
})
