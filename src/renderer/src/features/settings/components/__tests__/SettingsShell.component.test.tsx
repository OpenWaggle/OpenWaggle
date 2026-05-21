import { SessionId } from '@shared/types/brand'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppSettingsView } from '../AppSettingsView'
import { SettingsNav } from '../SettingsNav'
import { SettingsPage } from '../SettingsPage'

const { navigateMock, fullscreenMock, chatMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  fullscreenMock: vi.fn(),
  chatMock: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}))

vi.mock('@/features/chat/hooks', () => ({
  useChat: () => chatMock(),
}))

vi.mock('@/shell/useFullscreen', () => ({
  useFullscreen: () => fullscreenMock(),
}))

vi.mock('../sections/GeneralSection', () => ({ GeneralSection: () => <div>General settings</div> }))
vi.mock('../sections/WaggleSection', () => ({ WaggleSection: () => <div>Waggle settings</div> }))
vi.mock('../sections/McpSection', () => ({ McpSection: () => <div>MCP settings</div> }))
vi.mock('../sections/ConnectionsSection', () => ({
  ConnectionsSection: () => <div>Connections settings</div>,
}))
vi.mock('../sections/ArchivedSection', () => ({
  ArchivedSection: () => <div>Archived settings</div>,
}))

describe('settings shell components', () => {
  beforeEach(() => {
    navigateMock.mockReset()
    fullscreenMock.mockReturnValue(false)
    chatMock.mockReturnValue({ activeSessionId: null })
  })

  it('navigates between active settings tabs and omits inactive placeholders', () => {
    render(<SettingsNav activeTab="general" />)

    fireEvent.click(screen.getByRole('button', { name: /Waggle Mode/ }))
    fireEvent.click(screen.getByRole('button', { name: /General/ }))

    expect(screen.queryByRole('button', { name: /Git/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Worktrees/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Personalization/ })).not.toBeInTheDocument()
    expect(navigateMock).toHaveBeenNthCalledWith(1, {
      to: '/settings/$tab',
      params: { tab: 'waggle' },
    })
    expect(navigateMock).toHaveBeenNthCalledWith(2, { to: '/settings' })
  })

  it('routes back to the active session from the settings page header', () => {
    chatMock.mockReturnValue({ activeSessionId: SessionId('session-1') })

    render(<SettingsPage activeTab="connections" />)
    fireEvent.click(screen.getByRole('button', { name: /Back to app/ }))

    expect(screen.getByText('Connections settings')).toBeInTheDocument()
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/sessions/$sessionId',
      params: { sessionId: 'session-1' },
    })
  })

  it('renders AppSettingsView through the panel boundary', () => {
    render(<AppSettingsView activeTab="mcp" />)

    expect(screen.getByText('MCP settings')).toBeInTheDocument()
    expect(screen.getByText('Settings')).toBeInTheDocument()
  })
})
