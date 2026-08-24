import { SessionId } from '@shared/types/brand'
import type { SessionDetail } from '@shared/types/session'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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
  it('uses the documented mode names, never a contraction', () => {
    // CONTEXT.md defines the terms as "YOLO (Full access)" and "Ask for Approval", and rules out
    // "Ask mode". An earlier version showed "YOLO"/"Ask" while closed, which both broke the
    // vocabulary and depended on Chromium repainting option text before the native popup opened.
    render(
      <SessionAuthorizationModeMenu
        onSetAuthorizationMode={vi.fn().mockResolvedValue(undefined)}
        session={session('yolo')}
      />,
    )

    expect(screen.getByRole('option', { name: 'YOLO (Full access)' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'YOLO' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Ask' })).not.toBeInTheDocument()
  })

  it('keeps the same names after the control is focused and blurred', () => {
    render(
      <SessionAuthorizationModeMenu
        onSetAuthorizationMode={vi.fn().mockResolvedValue(undefined)}
        session={session('yolo')}
      />,
    )

    const select = screen.getByRole('combobox', { name: 'Session access mode' })
    fireEvent.focus(select)
    expect(screen.getByRole('option', { name: 'YOLO (Full access)' })).toBeInTheDocument()

    fireEvent.blur(select)
    expect(screen.getByRole('option', { name: 'YOLO (Full access)' })).toBeInTheDocument()
  })

  it('lists the other mode too', () => {
    render(
      <SessionAuthorizationModeMenu
        onSetAuthorizationMode={vi.fn().mockResolvedValue(undefined)}
        session={session('yolo')}
      />,
    )

    expect(screen.getByRole('option', { name: 'Ask for Approval' })).toBeInTheDocument()
  })

  it('names the mode in force while inheriting, rather than the word Default', () => {
    // The control exists to say which mode the next run will use. "Default" says nothing about that,
    // and an inheriting session is the common case.
    render(
      <SessionAuthorizationModeMenu
        onSetAuthorizationMode={vi.fn().mockResolvedValue(undefined)}
        session={session()}
      />,
    )

    const select = screen.getByRole('combobox', { name: 'Session access mode' })
    expect(select).toHaveValue('inherit')
    // Names the mode in force AND marks it inherited, so it stays distinct from pinning the same
    // mode as an explicit override without needing a state swap to tell them apart.
    expect(screen.getByRole('option', { name: 'Default · YOLO (Full access)' })).toBeInTheDocument()
  })

  it('sets a session override', () => {
    const onSetAuthorizationMode = vi.fn().mockResolvedValue(undefined)
    render(
      <SessionAuthorizationModeMenu
        onSetAuthorizationMode={onSetAuthorizationMode}
        session={session()}
      />,
    )

    fireEvent.change(screen.getByRole('combobox', { name: 'Session access mode' }), {
      target: { value: 'ask-for-approval' },
    })

    expect(onSetAuthorizationMode).toHaveBeenCalledWith('ask-for-approval')
  })

  it('clears the override so the session inherits again', () => {
    // Without this the composer could set an override but never remove one, so a session could
    // never be returned to following its project or global default.
    const onSetAuthorizationMode = vi.fn().mockResolvedValue(undefined)
    render(
      <SessionAuthorizationModeMenu
        onSetAuthorizationMode={onSetAuthorizationMode}
        session={session('ask-for-approval')}
      />,
    )

    fireEvent.change(screen.getByRole('combobox', { name: 'Session access mode' }), {
      target: { value: 'inherit' },
    })

    expect(onSetAuthorizationMode).toHaveBeenCalledWith(null)
  })

  it('shows the mode the first run will use before a session exists, without letting it be set', () => {
    // Hiding the control until after the first message would leave the composer silent about access
    // exactly when it matters most, but a draft has nothing to hold a session override yet.
    render(
      <SessionAuthorizationModeMenu
        onSetAuthorizationMode={vi.fn().mockResolvedValue(undefined)}
        session={null}
      />,
    )

    const select = screen.getByRole('combobox', { name: 'Session access mode' })
    expect(select).toBeDisabled()
    expect(select).toHaveValue('yolo')
    expect(screen.getByRole('option', { name: 'YOLO (Full access)' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /^Default/ })).not.toBeInTheDocument()
  })
})
