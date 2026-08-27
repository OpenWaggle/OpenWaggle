import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useDraftAuthorizationModeStore } from '@/features/chat/state/draft-authorization-mode-store'

vi.mock('@/shared/lib/ipc', () => ({
  api: { getProjectPreferences: vi.fn().mockResolvedValue(null) },
}))

import { SessionAuthorizationModeMenu } from '../SessionAuthorizationModeMenu'

function session(override?: 'yolo' | 'ask-for-approval'): SessionDetail {
  return {
    id: SessionId('session-1'),
    title: 'Session',
    projectPath: '/tmp/project',
    messages: [],
    createdAt: 1,
    updatedAt: 1,
    ...(override ? { authorizationMode: override } : {}),
  }
}

describe('SessionAuthorizationModeMenu', () => {
  beforeEach(() => {
    useDraftAuthorizationModeStore.setState({ byProjectPath: {} })
  })

  it('uses a compact trigger and canonical names in the open menu', () => {
    render(
      <SessionAuthorizationModeMenu
        onSetAuthorizationMode={vi.fn().mockResolvedValue(undefined)}
        session={session('yolo')}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Session access mode: YOLO' })
    expect(trigger).toHaveTextContent('YOLO')
    expect(trigger).not.toHaveTextContent('Full Access')

    fireEvent.click(trigger)

    expect(screen.getByRole('menuitemradio', { name: 'YOLO (Full Access)' })).toBeChecked()
    expect(screen.getByRole('menuitemradio', { name: 'Ask for Approval' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitemradio', { name: 'Ask' })).not.toBeInTheDocument()
  })

  it('keeps canonical menu names across close and reopen', () => {
    render(
      <SessionAuthorizationModeMenu
        onSetAuthorizationMode={vi.fn().mockResolvedValue(undefined)}
        session={session('yolo')}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Session access mode: YOLO' })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('menuitemradio', { name: 'YOLO (Full Access)' })).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    expect(screen.getByRole('menuitemradio', { name: 'YOLO (Full Access)' })).toBeInTheDocument()
  })

  it('lists the other mode too', () => {
    render(
      <SessionAuthorizationModeMenu
        onSetAuthorizationMode={vi.fn().mockResolvedValue(undefined)}
        session={session('yolo')}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Session access mode: YOLO' }))
    expect(screen.getByRole('menuitemradio', { name: 'Ask for Approval' })).toBeInTheDocument()
  })

  it('keeps inheritance internal and shows exactly the two modes a user can choose', () => {
    render(
      <SessionAuthorizationModeMenu
        onSetAuthorizationMode={vi.fn().mockResolvedValue(undefined)}
        session={session()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Session access mode: YOLO' }))
    const options = screen.getAllByRole('menuitemradio')
    expect(options).toHaveLength(2)
    expect(screen.getByRole('menuitemradio', { name: 'YOLO (Full Access)' })).toBeChecked()
    expect(screen.getByRole('menuitemradio', { name: 'Ask for Approval' })).not.toBeChecked()
    expect(screen.queryByText(/Default/)).not.toBeInTheDocument()
  })

  it('sets a session override', () => {
    const onSetAuthorizationMode = vi.fn().mockResolvedValue(undefined)
    render(
      <SessionAuthorizationModeMenu
        onSetAuthorizationMode={onSetAuthorizationMode}
        session={session()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Session access mode: YOLO' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Ask for Approval' }))

    expect(onSetAuthorizationMode).toHaveBeenCalledWith('ask-for-approval')
  })

  it('lets a draft choose an explicit mode before the session exists', () => {
    const onSetAuthorizationMode = vi.fn().mockResolvedValue(undefined)
    render(
      <SessionAuthorizationModeMenu
        onSetAuthorizationMode={onSetAuthorizationMode}
        projectPath="/tmp/project"
        session={null}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Session access mode: YOLO' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Ask for Approval' }))

    expect(
      screen.getByRole('button', { name: 'Session access mode: Ask for approval' }),
    ).toBeEnabled()
    expect(useDraftAuthorizationModeStore.getState().byProjectPath['/tmp/project']).toBe(
      'ask-for-approval',
    )
    expect(onSetAuthorizationMode).not.toHaveBeenCalled()
  })
})
