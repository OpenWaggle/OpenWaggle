import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ModalDialog } from '../ModalDialog'

describe('ModalDialog dismissal', () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function showModal() {
      this.setAttribute('open', '')
    }
  })

  it('delegates an Escape cancel once while React owns the open state', () => {
    const onClose = vi.fn()
    render(
      <ModalDialog label="Import" onClose={onClose}>
        Content
      </ModalDialog>,
    )
    const event = new Event('cancel', { bubbles: true, cancelable: true })

    fireEvent(screen.getByRole('dialog', { name: 'Import' }), event)

    expect(event.defaultPrevented).toBe(true)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('prevents native dismissal while its operation is in flight', () => {
    const onClose = vi.fn()
    render(
      <ModalDialog label="Import" dismissible={false} onClose={onClose}>
        Content
      </ModalDialog>,
    )
    const dialog = screen.getByRole('dialog', { name: 'Import' })
    const event = new Event('cancel', { bubbles: true, cancelable: true })

    fireEvent(dialog, event)

    expect(event.defaultPrevented).toBe(true)
    expect(dialog).toHaveAttribute('aria-busy', 'true')
    expect(onClose).not.toHaveBeenCalled()
  })
})
