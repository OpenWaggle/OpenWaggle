import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { type BaseRefControlState, DiffScopeTabs } from '../DiffScopeTabs'

const BRANCH_SELECTION = { kind: 'branch', baseRef: null } as const

function baseRefControl(overrides: Partial<BaseRefControlState> = {}): BaseRefControlState {
  return {
    current: null,
    choices: [],
    resolvedAutomatic: null,
    fellBackToWorkingTree: false,
    onChange: vi.fn(),
    ...overrides,
  }
}

function renderTabs(control: BaseRefControlState, selection = BRANCH_SELECTION) {
  render(
    <DiffScopeTabs
      selection={selection}
      baseRefControl={control}
      turns={[]}
      onSelectScope={vi.fn()}
      onSelectTurn={vi.fn()}
    />,
  )
}

describe('base ref control', () => {
  it('names the ref that Automatic resolved to', () => {
    /*
     * "Automatic" is the only place that says which base a diff was taken against, and it promised
     * a decision without reporting it. Now that Automatic and an explicit ref produce genuinely
     * different diffs, the label has to be auditable.
     */
    renderTabs(baseRefControl({ resolvedAutomatic: 'origin/develop' }))

    expect(screen.getByRole('option', { name: 'Automatic · origin/develop' })).toBeInTheDocument()
  })

  it('says when Automatic resolved nothing and the working tree is being shown', () => {
    renderTabs(baseRefControl({ fellBackToWorkingTree: true }))

    expect(screen.getByText('No default branch; showing the working tree')).toBeInTheDocument()
  })

  it('renders a persisted ref that is not among the choices, instead of showing Automatic', () => {
    /*
     * Choices load asynchronously and a deleted ref never loads at all. A select whose value
     * matched no option displayed the first one - "Automatic" - while the diff was computed
     * against the persisted ref, and one change event would have rewritten that ref to empty.
     */
    renderTabs(baseRefControl({ current: 'release/1.x', choices: [] }))

    const select = screen.getByRole('combobox', { name: 'Branch diff base ref' })
    expect(select).toHaveValue('release/1.x')
    expect(screen.getByRole('option', { name: 'release/1.x (unavailable)' })).toBeInTheDocument()
  })

  it('does not duplicate a ref that is among the choices', () => {
    renderTabs(
      baseRefControl({
        current: 'main',
        choices: [{ id: 'main', label: 'main' }],
      }),
    )

    expect(screen.queryByRole('option', { name: 'main (unavailable)' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'main' })).toBeInTheDocument()
  })
})

describe('scope tab accessibility', () => {
  it('announces which scope is selected', () => {
    /*
     * Selection was signalled by colour alone, so a screen-reader or high-contrast user heard three
     * identical buttons - and the active scope decides both what the panel shows and what the quick
     * action operates on. The sibling view toolbar in the same header already sets aria-pressed.
     */
    renderTabs(baseRefControl(), { kind: 'branch', baseRef: null })

    expect(screen.getByRole('button', { name: 'Branch', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Working tree', pressed: false })).toBeInTheDocument()
  })
})
