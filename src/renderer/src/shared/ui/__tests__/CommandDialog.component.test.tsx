import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Button } from '../Button'
import { CommandDialog } from '../CommandDialog'
import { TextInput } from '../TextInput'

describe('CommandDialog', () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function showModal() {
      this.setAttribute('open', '')
    }
    HTMLDialogElement.prototype.close ??= function close() {
      this.removeAttribute('open')
    }
  })

  it('opens as a modal and handles the native cancel event', () => {
    const onClose = vi.fn()
    render(
      <CommandDialog title="Commands" onClose={onClose}>
        <Button>Action</Button>
      </CommandDialog>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Commands' })
    expect(dialog).toHaveAttribute('open')

    fireEvent(dialog, new Event('cancel', { cancelable: true }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('moves focus to the search field instead of the backdrop control when it opens', () => {
    render(
      <CommandDialog title="Commands" onClose={vi.fn()}>
        <TextInput aria-label="Search" />
        <Button>Action</Button>
      </CommandDialog>,
    )

    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveFocus()
  })

  it('returns focus to the element that opened it when it closes', () => {
    render(<Button>Opener</Button>)
    const opener = screen.getByRole('button', { name: 'Opener' })
    opener.focus()
    const { unmount } = render(
      <CommandDialog title="Commands" onClose={vi.fn()}>
        <TextInput aria-label="Search" />
      </CommandDialog>,
    )
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveFocus()

    unmount()

    expect(opener).toHaveFocus()
  })

  it('offers an explicit backdrop control for pointer dismissal', () => {
    const onClose = vi.fn()
    render(
      <CommandDialog title="Commands" onClose={onClose}>
        <Button>Action</Button>
      </CommandDialog>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Commands' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
