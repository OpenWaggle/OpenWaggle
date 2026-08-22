import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Button } from '../Button'
import { CommandDialog } from '../CommandDialog'

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
})
