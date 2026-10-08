import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SegmentedRadioGroup } from '../SegmentedRadioGroup'

const OPTIONS = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
] as const

function Harness({
  pending = false,
  onSelect = vi.fn(),
}: {
  readonly pending?: boolean
  readonly onSelect?: (value: 'a' | 'b' | 'c') => void
}) {
  const [value, setValue] = useState<'a' | 'b' | 'c'>('a')
  return (
    <SegmentedRadioGroup
      label="Letters"
      options={OPTIONS}
      value={value}
      pending={pending}
      onSelect={(next) => {
        onSelect(next)
        if (!pending) setValue(next)
      }}
    />
  )
}

describe('SegmentedRadioGroup', () => {
  it('uses a roving tab stop on the checked option', () => {
    render(<Harness />)

    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveAttribute('tabindex', '-1')
  })

  it('moves focus and selection with the arrow keys, wrapping at the ends', () => {
    const onSelect = vi.fn()
    render(<Harness onSelect={onSelect} />)
    const alpha = screen.getByRole('radio', { name: 'Alpha' })
    alpha.focus()

    fireEvent.keyDown(alpha, { key: 'ArrowRight' })
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveFocus()
    expect(screen.getByRole('radio', { name: 'Beta' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Beta' }), { key: 'End' })
    expect(screen.getByRole('radio', { name: 'Gamma' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Gamma' }), { key: 'ArrowDown' })
    expect(alpha).toHaveFocus()
    fireEvent.keyDown(alpha, { key: 'ArrowLeft' })
    expect(screen.getByRole('radio', { name: 'Gamma' })).toHaveFocus()
    expect(onSelect.mock.calls.map(([value]) => value)).toEqual(['b', 'c', 'a', 'c'])
  })

  it('keeps focus while pending and ignores activation', () => {
    const onSelect = vi.fn()
    render(<Harness pending onSelect={onSelect} />)
    const beta = screen.getByRole('radio', { name: 'Beta' })
    beta.focus()

    fireEvent.click(beta)
    fireEvent.keyDown(beta, { key: 'ArrowRight' })

    expect(screen.getByRole('radiogroup', { name: 'Letters' })).toHaveAttribute('aria-busy', 'true')
    expect(beta).toHaveAttribute('aria-disabled', 'true')
    expect(beta).not.toBeDisabled()
    expect(beta).toHaveFocus()
    expect(onSelect).not.toHaveBeenCalled()
  })
})
