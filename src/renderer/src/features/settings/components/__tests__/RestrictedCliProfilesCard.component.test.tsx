import { decodeLocalSessionProfileUiCommand } from '@shared/schemas/local-session-profile-management'
import type { LocalSessionProfileSummary } from '@shared/types/local-session-profile-management'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { manageAccessProfilesMock, showConfirmMock } = vi.hoisted(() => ({
  manageAccessProfilesMock: vi.fn(),
  showConfirmMock: vi.fn(),
}))

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    manageAccessProfiles: async (command: unknown) =>
      manageAccessProfilesMock(decodeLocalSessionProfileUiCommand(command)),
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

async function editProfile(profile: LocalSessionProfileSummary) {
  manageAccessProfilesMock
    .mockResolvedValueOnce(
      response({ operation: 'list', effect: 'profiles-listed', profiles: [profile] }),
    )
    .mockResolvedValueOnce(response({ operation: 'update', effect: 'profile-updated', profile }))
  render(<RestrictedCliProfilesCard />)
  fireEvent.click(screen.getByRole('button', { name: /Restricted CLI profiles/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
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

  it.each([{ all: true }, { projectPaths: ['/project'] }])(
    'preserves undisplayed resource roots when saving scope %j',
    async (visibleScope) => {
      const profile: LocalSessionProfileSummary = {
        ...PROFILE,
        scope: {
          ...visibleScope,
          exportRoots: ['/export-destination'],
          attachmentRoots: ['/attachment-source'],
        },
      }
      await editProfile(profile)

      fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

      await waitFor(() => {
        expect(manageAccessProfilesMock).toHaveBeenLastCalledWith({
          operation: 'update',
          profileName: profile.name,
          capabilities: profile.capabilities,
          scope: profile.scope,
          authorizationCeiling: profile.authorizationCeiling,
        })
      })
    },
  )

  it('preserves narrower delegation limits when visible profile authority expands', async () => {
    const profile: LocalSessionProfileSummary = {
      ...PROFILE,
      capabilities: [...PROFILE.capabilities, 'access:profiles'],
      managementEnvelope: {
        capabilities: ['sessions:read'],
        scope: { sessionIds: ['one-session'] },
        authorizationCeiling: 'ask-for-approval',
      },
    }
    await editProfile(profile)
    fireEvent.click(screen.getByRole('checkbox', { name: 'All Sessions and projects' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'sessions · start' }))
    fireEvent.change(screen.getByLabelText('Authorization ceiling'), { target: { value: 'yolo' } })

    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => {
      expect(manageAccessProfilesMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          operation: 'update',
          capabilities: expect.arrayContaining(['sessions:start', 'access:profiles']),
          scope: { all: true },
          authorizationCeiling: 'yolo',
          managementEnvelope: profile.managementEnvelope,
        }),
      )
    })
  })

  it('does not invent delegation authority for an existing manager without an envelope', async () => {
    const profile: LocalSessionProfileSummary = {
      ...PROFILE,
      capabilities: [...PROFILE.capabilities, 'access:profiles'],
    }
    await editProfile(profile)

    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => {
      expect(manageAccessProfilesMock).toHaveBeenLastCalledWith({
        operation: 'update',
        profileName: profile.name,
        capabilities: profile.capabilities,
        scope: profile.scope,
        authorizationCeiling: profile.authorizationCeiling,
      })
    })
  })

  it('removes delegation authority when its capability is explicitly removed', async () => {
    const profile: LocalSessionProfileSummary = {
      ...PROFILE,
      capabilities: [...PROFILE.capabilities, 'access:profiles'],
      managementEnvelope: {
        capabilities: ['sessions:read'],
        scope: PROFILE.scope,
        authorizationCeiling: 'ask-for-approval',
      },
    }
    await editProfile(profile)
    fireEvent.click(screen.getByRole('checkbox', { name: 'access · profiles' }))

    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => {
      expect(manageAccessProfilesMock).toHaveBeenLastCalledWith({
        operation: 'update',
        profileName: profile.name,
        capabilities: PROFILE.capabilities,
        scope: profile.scope,
        authorizationCeiling: profile.authorizationCeiling,
      })
    })
  })

  it.each(['create', 'update'] as const)(
    'initializes a management envelope only when explicitly granting access during %s',
    async (operation) => {
      if (operation === 'update') {
        await editProfile(PROFILE)
      } else {
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
        fireEvent.change(screen.getByLabelText('Profile name'), { target: { value: PROFILE.name } })
      }
      fireEvent.click(screen.getByRole('checkbox', { name: 'access · profiles' }))
      fireEvent.click(
        screen.getByRole('button', {
          name: operation === 'create' ? 'Create profile' : 'Save profile',
        }),
      )

      await waitFor(() => {
        expect(manageAccessProfilesMock).toHaveBeenLastCalledWith({
          operation,
          ...(operation === 'create' ? { name: PROFILE.name } : { profileName: PROFILE.name }),
          capabilities: [...PROFILE.capabilities, 'access:profiles'],
          scope: PROFILE.scope,
          authorizationCeiling: PROFILE.authorizationCeiling,
          managementEnvelope: {
            capabilities: PROFILE.capabilities,
            scope: PROFILE.scope,
            authorizationCeiling: PROFILE.authorizationCeiling,
          },
        })
      })
    },
  )
})
