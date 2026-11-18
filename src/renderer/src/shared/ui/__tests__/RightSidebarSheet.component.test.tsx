import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '../Button'
import { RightSidebarSheet } from '../RightSidebarSheet'

function sheet(open: boolean, onOpenChange: (open: boolean) => void) {
  return (
    <>
      <Button>Open sidebar</Button>
      <RightSidebarSheet open={open} onOpenChange={onOpenChange}>
        <Button>Sidebar action</Button>
      </RightSidebarSheet>
    </>
  )
}

describe('RightSidebarSheet', () => {
  it('traps focus, handles Escape, and restores its opener on close', async () => {
    const onOpenChange = vi.fn()
    const view = render(sheet(false, onOpenChange))
    const opener = screen.getByRole('button', { name: 'Open sidebar' })
    opener.focus()

    view.rerender(sheet(true, onOpenChange))

    const dialog = screen.getByRole('dialog', { name: 'Right sidebar' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Sidebar action' })).toHaveFocus(),
    )

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(dialog).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onOpenChange).toHaveBeenCalledWith(false)

    view.rerender(sheet(false, onOpenChange))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open sidebar' })).toHaveFocus())
  })

  it('yields Escape and focus trapping to a modal opened above the sheet', async () => {
    const onOpenChange = vi.fn()
    render(
      <>
        {sheet(true, onOpenChange)}
        <dialog aria-label="Image viewer" open>
          <Button>Viewer action</Button>
        </dialog>
      </>,
    )
    const viewerAction = screen.getByRole('button', { name: 'Viewer action' })
    viewerAction.focus()

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(document, { key: 'Tab' })

    expect(onOpenChange).not.toHaveBeenCalled()
    expect(viewerAction).toHaveFocus()
  })
})
