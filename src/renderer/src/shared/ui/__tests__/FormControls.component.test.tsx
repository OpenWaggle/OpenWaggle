import { createEvent, fireEvent, render, screen } from '@testing-library/react'
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

  it('cancels an edited value with Escape without committing it', () => {
    const onValueChange = vi.fn()
    render(
      <NumberStepper
        label="Code text"
        value={12}
        minimum={10}
        maximum={24}
        suffix="px"
        onValueChange={onValueChange}
      />,
    )

    const input = screen.getByRole('spinbutton', { name: 'Code text' })
    input.focus()
    fireEvent.change(input, { target: { value: '17' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(onValueChange).not.toHaveBeenCalled()
    expect(input).toHaveValue('12')
  })

  it('announces the visible draft while the user edits', () => {
    render(
      <NumberStepper
        label="Code text"
        value={12}
        minimum={10}
        maximum={24}
        suffix="px"
        onValueChange={() => undefined}
      />,
    )

    const input = screen.getByRole('spinbutton', { name: 'Code text' })
    fireEvent.change(input, { target: { value: '17' } })

    expect(input).toHaveAttribute('aria-valuenow', '17')
    expect(input).toHaveAttribute('aria-valuetext', '17px')
  })

  it('quantizes typed values to the configured step before committing', () => {
    const onValueChange = vi.fn()
    render(
      <NumberStepper
        label="Threshold"
        value={80}
        minimum={1}
        maximum={100}
        suffix="%"
        onValueChange={onValueChange}
      />,
    )

    const input = screen.getByRole('spinbutton', { name: 'Threshold' })
    fireEvent.change(input, { target: { value: '73.5' } })
    fireEvent.blur(input)

    expect(onValueChange).toHaveBeenCalledWith(74)
    expect(input).toHaveValue('74')
  })

  it('steps from the committed value when the draft is blank', () => {
    const onValueChange = vi.fn()
    render(
      <NumberStepper
        label="Threshold"
        value={80}
        minimum={1}
        maximum={100}
        suffix="%"
        onValueChange={onValueChange}
      />,
    )

    const input = screen.getByRole('spinbutton', { name: 'Threshold' })
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.keyDown(input, { key: 'ArrowUp' })

    expect(onValueChange).toHaveBeenCalledWith(81)
    expect(input).toHaveValue('81')
  })

  it('steps a dirty focused draft once when a step button is clicked', () => {
    const onValueChange = vi.fn()
    render(
      <NumberStepper
        label="Threshold"
        value={80}
        minimum={1}
        maximum={100}
        suffix="%"
        onValueChange={onValueChange}
      />,
    )

    const input = screen.getByRole('spinbutton', { name: 'Threshold' })
    const increase = screen.getByRole('button', { name: 'Increase Threshold' })
    input.focus()
    fireEvent.change(input, { target: { value: '73' } })

    const mouseDown = createEvent.mouseDown(increase)
    fireEvent(increase, mouseDown)
    if (!mouseDown.defaultPrevented) fireEvent.blur(input, { relatedTarget: increase })
    fireEvent.click(increase)

    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenCalledWith(74)
    expect(input).toHaveFocus()
  })
})
