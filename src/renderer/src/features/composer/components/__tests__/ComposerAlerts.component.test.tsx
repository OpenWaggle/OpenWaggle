import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ComposerAlerts } from '../ComposerAlerts'

describe('ComposerAlerts', () => {
  it('renders nothing when there are no alerts', () => {
    const { container } = render(<ComposerAlerts alerts={[]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders dismiss buttons only for dismissible alerts', () => {
    const onDismiss = vi.fn()

    render(
      <ComposerAlerts
        alerts={[
          { id: 'voice', message: 'No speech detected.', onDismiss },
          { id: 'info', message: 'Branch created.' },
        ]}
      />,
    )

    fireEvent.click(screen.getByLabelText('Dismiss message: No speech detected.'))

    expect(onDismiss).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText('Dismiss message: Branch created.')).toBeNull()
  })
})
