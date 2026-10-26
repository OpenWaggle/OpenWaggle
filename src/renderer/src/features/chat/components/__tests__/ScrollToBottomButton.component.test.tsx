import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ScrollToBottomButton } from '../ScrollToBottomButton'

describe('ScrollToBottomButton', () => {
  it('is reachable and clickable while visible', () => {
    const onClick = vi.fn()
    const { container } = render(<ScrollToBottomButton visible onClick={onClick} />)

    expect(container.firstElementChild).not.toHaveAttribute('inert')
    fireEvent.click(screen.getByRole('button', { name: 'Scroll to bottom' }))
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('hides with inert alone, so hiding while focused never sets aria-hidden on focus', () => {
    const { container, rerender } = render(<ScrollToBottomButton visible onClick={vi.fn()} />)
    screen.getByRole('button', { name: 'Scroll to bottom' }).focus()

    rerender(<ScrollToBottomButton visible={false} onClick={vi.fn()} />)

    const wrapper = container.firstElementChild
    expect(wrapper).toHaveAttribute('inert')
    // Chromium blocks aria-hidden on an ancestor of the focused element and warns; inert removes
    // the subtree from the accessibility tree and moves focus out of it instead.
    expect(wrapper).not.toHaveAttribute('aria-hidden')
    // jsdom does not apply inert, so check the button sits in the inert subtree.
    expect(screen.getByRole('button', { name: 'Scroll to bottom' }).closest('[inert]')).toBe(
      wrapper,
    )
  })
})
