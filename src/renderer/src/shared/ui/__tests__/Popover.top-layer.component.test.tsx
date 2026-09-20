import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from '../Button'
import { Popover } from '../Popover'

describe('Popover outside clipping ancestors', () => {
  afterEach(() => vi.restoreAllMocks())

  it('positions an opted-in popup in the top layer above its trigger near the window bottom', () => {
    let anchor = new DOMRect(700, 700, 100, 32)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.getAttribute('role') === 'menu' ? new DOMRect(0, 0, 288, 200) : anchor
    })
    const onOpenChange = vi.fn()
    const { unmount } = render(
      <div style={{ height: 40, overflow: 'hidden' }}>
        <Popover
          escapeClipping
          open
          placement="bottom-end"
          role="menu"
          onOpenChange={onOpenChange}
          trigger={<Button variant="unstyled">Branches</Button>}
        >
          <Button variant="unstyled" role="menuitem">
            Create branch
          </Button>
        </Popover>
      </div>,
    )

    const menu = screen.getByRole('menu')
    expect(menu).toHaveAttribute('popover', 'manual')
    expect(menu).toHaveStyle({ position: 'fixed', left: '512px', top: '496px' })
    fireEvent.mouseDown(screen.getByRole('menuitem', { name: 'Create branch' }))
    expect(onOpenChange).not.toHaveBeenCalled()
    fireEvent.mouseDown(document.body)
    expect(onOpenChange).toHaveBeenCalledWith(false)

    anchor = new DOMRect(900, 10, 100, 32)
    fireEvent.resize(window)
    expect(menu).toHaveStyle({ left: '712px', top: '46px' })

    unmount()
    anchor = new DOMRect(100, 100, 100, 32)
    fireEvent.resize(window)
    expect(menu).toHaveStyle({ left: '712px', top: '46px' })
  })
})
