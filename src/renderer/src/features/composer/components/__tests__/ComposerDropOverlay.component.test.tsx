import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ComposerDropOverlay } from '../ComposerDropOverlay'

describe('ComposerDropOverlay', () => {
  it('prompts users to drop files when attachment capacity remains', () => {
    render(<ComposerDropOverlay isAtCapacity={false} />)

    expect(screen.getByText('Drop files to attach')).toBeInTheDocument()
    expect(screen.queryByText('Maximum files attached')).not.toBeInTheDocument()
  })

  it('blocks drops when the composer attachment capacity is already full', () => {
    render(<ComposerDropOverlay isAtCapacity />)

    expect(screen.getByText('Maximum files attached')).toBeInTheDocument()
    expect(screen.queryByText('Drop files to attach')).not.toBeInTheDocument()
  })
})
