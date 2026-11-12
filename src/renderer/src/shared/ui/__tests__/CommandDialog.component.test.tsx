import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { installModalDialogStub } from '@/test-utils/modal-dialog'
import { Button } from '../Button'
import { CommandDialog } from '../CommandDialog'
import { TextInput } from '../TextInput'

describe('CommandDialog', () => {
  beforeAll(() => {
    installModalDialogStub()
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

  it('returns focus to the first opener when one dialog replaces another', () => {
    function Surfaces({ surface }: { readonly surface: 'palette' | 'files' | null }) {
      if (surface === 'palette') {
        return (
          <CommandDialog key="palette" title="Commands" onClose={vi.fn()}>
            <TextInput aria-label="Search commands" />
          </CommandDialog>
        )
      }
      if (surface === 'files') {
        return (
          <CommandDialog key="files" title="Go to file" onClose={vi.fn()}>
            <TextInput aria-label="Search files" />
          </CommandDialog>
        )
      }
      return null
    }
    render(<Button>Opener</Button>)
    const opener = screen.getByRole('button', { name: 'Opener' })
    opener.focus()
    const { rerender } = render(<Surfaces surface="palette" />)
    expect(screen.getByRole('textbox', { name: 'Search commands' })).toHaveFocus()

    // The palette's "Go to file…" swaps the surfaces in one commit.
    rerender(<Surfaces surface="files" />)
    expect(screen.getByRole('textbox', { name: 'Search files' })).toHaveFocus()

    rerender(<Surfaces surface={null} />)
    expect(opener).toHaveFocus()
  })

  it('returns focus to the first opener when focus dropped before the next dialog mounted', () => {
    render(<Button>Opener</Button>)
    const opener = screen.getByRole('button', { name: 'Opener' })
    opener.focus()
    const palette = render(
      <CommandDialog title="Commands" onClose={vi.fn()}>
        <TextInput aria-label="Search commands" />
      </CommandDialog>,
    )
    // Suspense hides the still-mounted palette while the next surface's chunk loads.
    screen.getByRole('textbox', { name: 'Search commands' }).blur()
    const files = render(
      <CommandDialog title="Go to file" onClose={vi.fn()}>
        <TextInput aria-label="Search files" />
      </CommandDialog>,
    )
    palette.unmount()
    expect(screen.getByRole('textbox', { name: 'Search files' })).toHaveFocus()

    files.unmount()

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
