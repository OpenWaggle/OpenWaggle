import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
})
