import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRightPanelMaximizeStore } from '@/shared/lib/right-panel-maximize'
import { RightPanelMaximizeButton } from '../RightPanelMaximizeButton'

describe('RightPanelMaximizeButton', () => {
  afterEach(() => useRightPanelMaximizeStore.setState({ target: null }))

  it('renders nothing until the shell publishes a Right panel', () => {
    const { container } = render(<RightPanelMaximizeButton />)
    expect(container).toBeEmptyDOMElement()
  })

  it('maximizes and restores the published panel and names its shortcut', () => {
    const toggle = vi.fn()
    useRightPanelMaximizeStore
      .getState()
      .publish({ maximized: false, toggle, shortcutLabel: '⌘⇧M' })
    const { rerender } = render(<RightPanelMaximizeButton />)

    const maximize = screen.getByRole('button', { name: 'Maximize panel' })
    expect(maximize).toHaveAttribute('title', 'Maximize panel (⌘⇧M)')
    expect(maximize).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(maximize)
    expect(toggle).toHaveBeenCalledOnce()

    useRightPanelMaximizeStore.getState().publish({ maximized: true, toggle, shortcutLabel: null })
    rerender(<RightPanelMaximizeButton />)
    expect(screen.getByRole('button', { name: 'Restore panel' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})
