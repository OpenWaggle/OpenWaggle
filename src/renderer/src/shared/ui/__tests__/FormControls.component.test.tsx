import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Checkbox } from '../Checkbox'
import { RangeInput } from '../RangeInput'
import { Select } from '../Select'
import { TextInput } from '../TextInput'

describe('shared form controls', () => {
  it('renders text inputs with shared focus and typography classes', () => {
    render(<TextInput aria-label="API key" monospace placeholder="sk-..." />)

    expect(screen.getByRole('textbox', { name: 'API key' })).toHaveClass(
      'border-border',
      'bg-bg',
      'font-mono',
    )
  })

  it('supports labeled checkboxes through the public input interface', () => {
    const onChange = vi.fn()

    render(<Checkbox label="Include logs" checked={false} onChange={onChange} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include logs' }))

    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('renders native selects with shared dropdown styling', () => {
    render(
      <Select aria-label="Filter" value="all" onChange={() => undefined}>
        <option value="all">All</option>
        <option value="active">Active</option>
      </Select>,
    )

    expect(screen.getByRole('combobox', { name: 'Filter' })).toHaveClass(
      'border-input-card-border',
      'bg-bg-secondary',
    )
  })

  it('renders range controls with the shared accent styling', () => {
    render(
      <RangeInput aria-label="Max turns" min={4} max={20} value={8} onChange={() => undefined} />,
    )

    expect(screen.getByRole('slider', { name: 'Max turns' })).toHaveClass('accent-accent')
  })
})
