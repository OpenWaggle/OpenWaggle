import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalPanel } from '../TerminalPanel'

const { terminalStatusMock } = vi.hoisted(() => ({
  terminalStatusMock: vi.fn(),
}))

vi.mock('@/features/terminal/hooks/useTerminalSession', () => ({
  useTerminalSession: () => ({
    containerRef: { current: null },
    terminalStatus: terminalStatusMock(),
  }),
}))

describe('TerminalPanel', () => {
  beforeEach(() => {
    terminalStatusMock.mockReturnValue({ isReady: false, errorMessage: null })
  })

  it('renders connection status and delegates close', () => {
    const onClose = vi.fn()

    render(<TerminalPanel projectPath="/repo" onClose={onClose} />)
    fireEvent.click(screen.getByTitle('Close terminal'))

    expect(screen.getByText('Terminal connecting...')).toBeInTheDocument()
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders terminal errors', () => {
    terminalStatusMock.mockReturnValue({ isReady: false, errorMessage: 'pty unavailable' })

    render(<TerminalPanel projectPath="/repo" onClose={vi.fn()} />)

    expect(screen.getByText('Terminal unavailable')).toBeInTheDocument()
    expect(screen.getByText('pty unavailable')).toBeInTheDocument()
  })
})
