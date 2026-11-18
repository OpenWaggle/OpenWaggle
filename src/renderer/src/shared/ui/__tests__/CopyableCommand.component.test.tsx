import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CopyableCommand } from '../CopyableCommand'

const copyToClipboard = vi.hoisted(() => vi.fn())

vi.mock('@/shared/lib/ipc', () => ({ api: { copyToClipboard } }))

describe('CopyableCommand', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    copyToClipboard.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('copies the command and confirms it briefly', () => {
    render(<CopyableCommand command="gh auth login" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }))

    expect(copyToClipboard).toHaveBeenCalledWith('gh auth login')
    expect(screen.getByRole('status')).toHaveTextContent('Copied')
    act(() => {
      vi.runAllTimers()
    })
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('says when copying failed', () => {
    copyToClipboard.mockImplementation(() => {
      throw new Error('Clipboard unavailable')
    })
    render(<CopyableCommand command="gh auth login" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy command' }))

    expect(screen.getByRole('status')).toHaveTextContent('Copy failed')
  })
})
