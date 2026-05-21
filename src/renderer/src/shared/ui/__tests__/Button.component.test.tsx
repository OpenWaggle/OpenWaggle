import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from '../Button'

describe('Button', () => {
  it('defaults to a semantic button with the shared secondary tone', () => {
    render(<Button>Open</Button>)

    const button = screen.getByRole('button', { name: 'Open' })

    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass('border-border', 'bg-bg', 'text-text-secondary')
  })

  it('renders icon slots without changing the accessible name', () => {
    render(
      <Button
        leftIcon={<span aria-hidden="true">L</span>}
        rightIcon={<span aria-hidden="true">R</span>}
      >
        Save
      </Button>,
    )

    expect(screen.getByRole('button', { name: 'Save' })).toHaveTextContent('LSaveR')
  })

  it('supports product variants, sizes, radius, and full-width layout', () => {
    render(
      <Button variant="primary" size="lg" radius="full" fullWidth>
        Ship
      </Button>,
    )

    expect(screen.getByRole('button', { name: 'Ship' })).toHaveClass(
      'from-accent',
      'px-7',
      'rounded-full',
      'w-full',
    )
  })

  it('allows exact layout control for specialized buttons', () => {
    render(
      <Button variant="unstyled" className="flex size-5 items-center">
        More
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'More' })

    expect(button).toHaveClass('flex', 'size-5', 'items-center')
    expect(button).not.toHaveClass('rounded-md', 'px-2.5')
  })
})
