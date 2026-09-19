import { decodeLocalSessionProfileUiCommand } from '@shared/schemas/local-session-profile-management'
import type { LocalSessionProfileSummary } from '@shared/types/local-session-profile-management'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

describe('RestrictedCliProfilesCard refresh', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    const initial = usePreferencesStore.getInitialState()
    usePreferencesStore.setState({
      ...initial,
      settings: { ...initial.settings, projectPath: '/project' },
    })
    showConfirmMock.mockResolvedValue(true)
  })

  it('does not expose cached profile actions while a reopened list is pending', async () => {
    const reopenedList = Promise.withResolvers<ReturnType<typeof response>>()
    manageAccessProfilesMock
      .mockResolvedValueOnce(
        response({ operation: 'list', effect: 'profiles-listed', profiles: [PROFILE] }),
      )
      .mockReturnValueOnce(reopenedList.promise)
    render(<RestrictedCliProfilesCard />)
    const toggle = screen.getByRole('button', { name: /Restricted CLI profiles/ })
    fireEvent.click(toggle)
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument()

    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(screen.getByText('Loading profiles…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke review-bot' })).not.toBeInTheDocument()

    await act(async () => {
      reopenedList.resolve(
        response({ operation: 'list', effect: 'profiles-listed', profiles: [PROFILE] }),
      )
    })
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('does not expose cached profile actions when a reopened list fails', async () => {
    manageAccessProfilesMock
      .mockResolvedValueOnce(
        response({ operation: 'list', effect: 'profiles-listed', profiles: [PROFILE] }),
      )
      .mockRejectedValueOnce(new Error('profile list offline'))
    render(<RestrictedCliProfilesCard />)
    const toggle = screen.getByRole('button', { name: /Restricted CLI profiles/ })
    fireEvent.click(toggle)
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeInTheDocument()

    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(await screen.findByRole('alert')).toHaveTextContent('profile list offline')
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByText('No restricted profiles.')).not.toBeInTheDocument()
  })

  it('keeps the mutation error and hides cached rows if its follow-up list also fails', async () => {
    manageAccessProfilesMock
      .mockResolvedValueOnce(
        response({ operation: 'list', effect: 'profiles-listed', profiles: [PROFILE] }),
      )
      .mockRejectedValueOnce(new Error('rotation denied'))
      .mockRejectedValueOnce(new Error('refresh unavailable'))
    render(<RestrictedCliProfilesCard />)
    fireEvent.click(screen.getByRole('button', { name: /Restricted CLI profiles/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Rotate review-bot' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('rotation denied')
    await waitFor(() => expect(manageAccessProfilesMock).toHaveBeenCalledTimes(3))
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByText('refresh unavailable')).not.toBeInTheDocument()
  })

  it('waits for an authoritative list after an edit and ignores the older snapshot', async () => {
    const staleList = Promise.withResolvers<ReturnType<typeof response>>()
    const freshList = Promise.withResolvers<ReturnType<typeof response>>()
    const otherProfile: LocalSessionProfileSummary = {
      ...PROFILE,
      id: 'profile-other',
      name: 'other-bot',
    }
    const updated: LocalSessionProfileSummary = {
      ...PROFILE,
      capabilities: [...PROFILE.capabilities, 'sessions:start'],
      updatedAt: 2,
    }
    manageAccessProfilesMock
      .mockResolvedValueOnce(
        response({
          operation: 'list',
          effect: 'profiles-listed',
          profiles: [PROFILE, otherProfile],
        }),
      )
      .mockReturnValueOnce(staleList.promise)
      .mockResolvedValueOnce(
        response({ operation: 'update', effect: 'profile-updated', profile: updated }),
      )
      .mockReturnValueOnce(freshList.promise)
    render(<RestrictedCliProfilesCard />)
    const toggle = screen.getByRole('button', { name: /Restricted CLI profiles/ })
    fireEvent.click(toggle)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0])
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'sessions · start' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(manageAccessProfilesMock).toHaveBeenCalledTimes(4))
    expect(screen.getByText('Loading profiles…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()

    await act(async () => {
      staleList.resolve(
        response({
          operation: 'list',
          effect: 'profiles-listed',
          profiles: [PROFILE, otherProfile],
        }),
      )
    })
    expect(screen.getByText('Loading profiles…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revoke other-bot' })).not.toBeInTheDocument()

    await act(async () => {
      freshList.resolve(
        response({ operation: 'list', effect: 'profiles-listed', profiles: [updated] }),
      )
    })
    expect(screen.getByText(/3 capabilities · 1 scoped target/)).toBeInTheDocument()
    expect(screen.queryByText(/2 capabilities · 1 scoped target/)).not.toBeInTheDocument()
    expect(screen.queryByText('other-bot')).not.toBeInTheDocument()
  })
})
