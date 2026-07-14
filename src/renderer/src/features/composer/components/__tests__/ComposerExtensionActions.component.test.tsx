import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  type ComposerExtensionActionLauncher,
  ComposerExtensionActions,
} from '../ComposerExtensionActions'

function launcher(
  overrides: Partial<ComposerExtensionActionLauncher> = {},
): ComposerExtensionActionLauncher {
  return {
    id: 'extension-dialog:sample-extension:sample.dialog:interaction:interaction-1',
    title: 'Open sample dialog',
    description: 'Interaction · confirm from Sample Extension',
    badge: 'Dialog',
    onOpen: vi.fn(),
    ...overrides,
  }
}

describe('ComposerExtensionActions', () => {
  it('renders nothing when no compact launchers are available', () => {
    const { container } = render(<ComposerExtensionActions launchers={[]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('opens a compact launcher menu and invokes the selected action', () => {
    const onOpen = vi.fn()
    render(<ComposerExtensionActions launchers={[launcher({ onOpen })]} />)

    fireEvent.click(screen.getByRole('button', { name: /extensions/i }))
    fireEvent.click(screen.getByRole('button', { name: /open sample dialog/i }))

    expect(onOpen).toHaveBeenCalledOnce()
    expect(screen.queryByText('Composer extension launchers')).not.toBeInTheDocument()
  })

  it('states that extensions cannot inject composer input controls', () => {
    render(<ComposerExtensionActions launchers={[launcher()]} />)

    fireEvent.click(screen.getByRole('button', { name: /extensions/i }))

    expect(
      screen.getByText(/extensions cannot inject composer input controls/i),
    ).toBeInTheDocument()
  })
})
