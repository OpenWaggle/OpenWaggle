import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../Button'
import { Popover } from '../Popover'

/**
 * A panel that claims `role="menu"` has to behave like one.
 *
 * The sort menus declared menu semantics while their items were plain buttons: several tab stops,
 * no arrow keys, no focus movement on open or close. A screen reader announced a keyboard model
 * that did not exist, which is worse than announcing nothing, so these tests hold the model in
 * place. Panels with any other role keep plain behaviour and are covered here too, because the
 * primitive is shared with pickers that are not menus.
 */

function MenuFixture({ onSelect = vi.fn() }: { readonly onSelect?: () => void }) {
  return (
    <Popover
      role="menu"
      trigger={
        <Button variant="unstyled" type="button">
          Sort
        </Button>
      }
      open
      onOpenChange={() => {}}
    >
      <Button
        variant="unstyled"
        type="button"
        role="menuitemradio"
        aria-checked="false"
        onClick={onSelect}
      >
        Manual
      </Button>
      <Button
        variant="unstyled"
        type="button"
        role="menuitemradio"
        aria-checked="true"
        onClick={onSelect}
      >
        Recent
      </Button>
      <Button
        variant="unstyled"
        type="button"
        role="menuitemradio"
        aria-checked="false"
        onClick={onSelect}
      >
        Name
      </Button>
    </Popover>
  )
}

function items() {
  return screen.getAllByRole('menuitemradio')
}

describe('Popover with role="menu"', () => {
  it('moves focus onto the checked item when it opens', () => {
    render(<MenuFixture />)

    // The current choice, not the first item, so what is announced is what is selected.
    expect(items()[1]).toHaveFocus()
  })

  it('is a single tab stop', () => {
    render(<MenuFixture />)

    const [manual, recent, name] = items()
    expect(recent).toHaveAttribute('tabindex', '0')
    expect(manual).toHaveAttribute('tabindex', '-1')
    expect(name).toHaveAttribute('tabindex', '-1')
  })

  it('moves down and up with the arrow keys, wrapping at both ends', () => {
    render(<MenuFixture />)
    const menu = screen.getByRole('menu')
    const [manual, recent, name] = items()

    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(name).toHaveFocus()

    // Past the last item comes the first.
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    expect(manual).toHaveFocus()

    // And back off the front to the last.
    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(name).toHaveFocus()

    fireEvent.keyDown(menu, { key: 'ArrowUp' })
    expect(recent).toHaveFocus()
  })

  it('jumps to the ends with Home and End', () => {
    render(<MenuFixture />)
    const menu = screen.getByRole('menu')
    const [manual, , name] = items()

    fireEvent.keyDown(menu, { key: 'End' })
    expect(name).toHaveFocus()

    fireEvent.keyDown(menu, { key: 'Home' })
    expect(manual).toHaveFocus()
  })

  it('keeps the tab stop on whichever item holds focus', () => {
    render(<MenuFixture />)
    const menu = screen.getByRole('menu')

    fireEvent.keyDown(menu, { key: 'End' })

    const [manual, recent, name] = items()
    expect(name).toHaveAttribute('tabindex', '0')
    expect(recent).toHaveAttribute('tabindex', '-1')
    expect(manual).toHaveAttribute('tabindex', '-1')
  })

  it('closes on Tab rather than moving inside the menu', () => {
    const onOpenChange = vi.fn()
    render(
      <Popover
        role="menu"
        trigger={
          <Button variant="unstyled" type="button">
            Sort
          </Button>
        }
        open
        onOpenChange={onOpenChange}
      >
        <Button variant="unstyled" type="button" role="menuitem">
          Only
        </Button>
      </Popover>,
    )

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Tab' })

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('tells the trigger it opens a menu, and whether it is open', () => {
    render(<MenuFixture />)

    const trigger = screen.getByRole('button', { name: 'Sort' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('skips items that are disabled', () => {
    render(
      <Popover
        role="menu"
        trigger={
          <Button variant="unstyled" type="button">
            Sort
          </Button>
        }
        open
        onOpenChange={() => {}}
      >
        <Button variant="unstyled" type="button" role="menuitem" disabled>
          Unavailable
        </Button>
        <Button variant="unstyled" type="button" role="menuitem">
          Available
        </Button>
      </Popover>,
    )

    // Focus lands on the first item that can take it, not on the disabled one.
    expect(screen.getByRole('menuitem', { name: 'Available' })).toHaveFocus()
  })
})

describe('Popover without a menu role', () => {
  it('leaves focus alone and adds no menu semantics', () => {
    render(
      <Popover
        role="listbox"
        trigger={
          <Button variant="unstyled" type="button">
            Pick
          </Button>
        }
        open
        onOpenChange={() => {}}
      >
        <Button variant="unstyled" type="button" role="option" aria-selected="false">
          One
        </Button>
      </Popover>,
    )

    const trigger = screen.getByRole('button', { name: 'Pick' })
    expect(trigger).not.toHaveAttribute('aria-haspopup')
    // A listbox is not a menu, so nothing here steals focus from the page.
    expect(screen.getByRole('option')).not.toHaveFocus()
  })
})
