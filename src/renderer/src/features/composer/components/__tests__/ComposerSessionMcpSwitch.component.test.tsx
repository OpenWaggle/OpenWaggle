import { SessionId } from '@shared/types/brand'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/features/chat/state'
import { api } from '@/shared/lib/ipc'
import { renderWithQueryClient } from '@/test-utils/query-test-utils'
import { ComposerAttachButton } from '../ComposerAttachButton'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    getSessionMcpEnabled: vi.fn(),
    setSessionMcpEnabled: vi.fn(),
  },
}))
vi.mock('@/features/sessions/hooks', () => ({ useProject: () => ({ projectPath: '/repo' }) }))

const getSessionMcpEnabled = vi.mocked(api.getSessionMcpEnabled)
const setSessionMcpEnabled = vi.mocked(api.setSessionMcpEnabled)

function openMenu() {
  const fileInputRef: React.RefObject<HTMLInputElement | null> = { current: null }
  renderWithQueryClient(<ComposerAttachButton fileInputRef={fileInputRef} />)
  fireEvent.click(screen.getByRole('button', { name: 'Add to message' }))
}

describe("the composer's per-Session MCP switch", () => {
  beforeEach(() => {
    getSessionMcpEnabled.mockReset()
    setSessionMcpEnabled.mockReset()
    useChatStore.setState({ activeSessionId: SessionId('session-1') })
  })

  it('turns a migrated MCP-off Session back on', async () => {
    getSessionMcpEnabled.mockResolvedValue(false)
    setSessionMcpEnabled.mockResolvedValue(true)
    openMenu()

    const toggle = await screen.findByRole('menuitemcheckbox', { name: /Use MCP servers/ })
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'false'))
    // Turning MCP on applies from the next message, which starts the Session's servers.
    expect(toggle).toHaveTextContent('Turning it on applies from your next message.')
    fireEvent.click(toggle)

    await waitFor(() =>
      expect(setSessionMcpEnabled).toHaveBeenCalledWith({ sessionId: 'session-1', enabled: true }),
    )
    await waitFor(() =>
      expect(screen.getByRole('menuitemcheckbox', { name: /Use MCP servers/ })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    )
  })

  it('is on by default and switches a Session off', async () => {
    getSessionMcpEnabled.mockResolvedValue(true)
    setSessionMcpEnabled.mockResolvedValue(false)
    openMenu()

    const toggle = await screen.findByRole('menuitemcheckbox', { name: /Use MCP servers/ })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    // Turning it off stops the servers at once, a running reply's included.
    await waitFor(() => expect(toggle).toHaveTextContent('Turning it off stops them at once.'))
    await waitFor(() => expect(toggle).toBeEnabled())
    fireEvent.click(toggle)

    await waitFor(() =>
      expect(setSessionMcpEnabled).toHaveBeenCalledWith({
        sessionId: 'session-1',
        enabled: false,
      }),
    )
  })

  it('is not offered before there is a Session', () => {
    useChatStore.setState({ activeSessionId: null })
    openMenu()

    expect(screen.queryByRole('menuitemcheckbox', { name: /Use MCP servers/ })).toBeNull()
    expect(getSessionMcpEnabled).not.toHaveBeenCalled()
  })
})
