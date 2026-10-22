import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ChatDisplayPathProvider } from '../ChatDisplayPathContext'
import { ChatErrorDisplay } from '../ChatErrorDisplay'

vi.mock('@/shared/lib/ipc', () => ({
  api: {
    copyToClipboard: vi.fn(),
    openLogsDir: vi.fn(async () => undefined),
  },
}))

describe('ChatErrorDisplay', () => {
  it('shows raw transport error details without the renderer-created stack', () => {
    render(
      <ChatErrorDisplay
        error={new Error('Something went wrong')}
        lastUserMessage="Draft a one-page summary"
        dismissedError={null}
        sessionId={null}
        onDismiss={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /show details/i }))

    expect(screen.getByText('Raw: Something went wrong')).toBeInTheDocument()
    expect(screen.queryByText(/at .*ChatErrorDisplay/)).not.toBeInTheDocument()
  })

  it('keeps the worktree path a preparation mismatch names, and offers no Retry', () => {
    const worktree = '/Users/me/.openwaggle/worktrees/repo/abc-123'
    const message = `This worktree no longer matches its saved preparation: ${worktree} is a different folder from the one that was prepared. If the original folder still exists somewhere else, put it back at that path in place of this one.`
    const onRetry = vi.fn()
    render(
      <ChatDisplayPathProvider
        projectPath="/Users/me/repo"
        worktreePath={worktree}
        workingPath={worktree}
      >
        <ChatErrorDisplay
          error={new Error(`Error: ${message}`)}
          lastUserMessage="continue"
          dismissedError={null}
          sessionId={null}
          onDismiss={vi.fn()}
          onRetry={onRetry}
        />
      </ChatDisplayPathProvider>,
    )

    expect(screen.getByText(message)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument()
  })
})
