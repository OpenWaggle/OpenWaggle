import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CollapsibleDetails } from '../CollapsibleDetails'

describe('CollapsibleDetails', () => {
  it('renders collapseLabel text when showDetails is false', () => {
    render(
      <CollapsibleDetails
        showDetails={false}
        collapseLabel="Show 3 tool calls"
        onToggle={vi.fn()}
      />,
    )
    expect(screen.getByText('Show 3 tool calls')).toBeInTheDocument()
  })

  it('renders "Hide details" text when showDetails is true', () => {
    render(
      <CollapsibleDetails
        showDetails={true}
        collapseLabel="Show 3 tool calls"
        onToggle={vi.fn()}
      />,
    )
    expect(screen.getByText('Hide details')).toBeInTheDocument()
  })

  it('shows ChevronDown when not expanded', () => {
    const { container } = render(
      <CollapsibleDetails showDetails={false} collapseLabel="Show details" onToggle={vi.fn()} />,
    )
    // lucide-react renders SVGs with class names containing the icon name
    const svgs = container.querySelectorAll('svg')
    expect(svgs).toHaveLength(1)
    // ChevronDown has class "lucide-chevron-down"
    expect(svgs[0].classList.toString()).toContain('chevron-down')
  })

  it('shows ChevronUp when expanded', () => {
    const { container } = render(
      <CollapsibleDetails showDetails={true} collapseLabel="Show details" onToggle={vi.fn()} />,
    )
    const svgs = container.querySelectorAll('svg')
    expect(svgs).toHaveLength(1)
    expect(svgs[0].classList.toString()).toContain('chevron-up')
  })

  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn()
    render(
      <CollapsibleDetails showDetails={false} collapseLabel="Show details" onToggle={onToggle} />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledOnce()
  })
})
