import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Checkbox } from '../Checkbox'
import { NumberStepper } from '../NumberStepper'
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

  it('adjusts bounded numbers with buttons, typing, and arrow keys', () => {
    const onValueChange = vi.fn()
    const { rerender } = render(
      <NumberStepper
        label="Code text"
        value={12}
        minimum={10}
        maximum={24}
        suffix="px"
        onValueChange={onValueChange}
      />,
    )

    expect(screen.getByRole('group', { name: 'Code text controls' })).toHaveClass('h-7', 'w-32')
    fireEvent.click(screen.getByRole('button', { name: 'Increase Code text' }))
    expect(onValueChange).toHaveBeenLastCalledWith(13)

    rerender(
      <NumberStepper
        label="Code text"
        value={13}
        minimum={10}
        maximum={24}
        suffix="px"
        onValueChange={onValueChange}
      />,
    )
    const input = screen.getByRole('spinbutton', { name: 'Code text' })
    fireEvent.change(input, { target: { value: '99' } })
    fireEvent.blur(input)
    expect(onValueChange).toHaveBeenLastCalledWith(24)

    rerender(
      <NumberStepper
        label="Code text"
        value={24}
        minimum={10}
        maximum={24}
        suffix="px"
        onValueChange={onValueChange}
      />,
    )

    const updatedInput = screen.getByRole('spinbutton', { name: 'Code text' })
    updatedInput.focus()
    fireEvent.keyDown(updatedInput, { key: 'ArrowDown' })
    expect(onValueChange).toHaveBeenLastCalledWith(23)
    fireEvent.keyDown(updatedInput, { key: 'ArrowDown' })
    expect(onValueChange).toHaveBeenLastCalledWith(22)
    expect(updatedInput).toHaveFocus()
  })
})
