import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusRow } from '../AgentLoopStatusRow'

describe('status row with Pi extension status', () => {
  it('lists each extension status line under the finishing label', () => {
    render(
      <StatusRow
        row={{
          type: 'phase-indicator',
          label: 'Finishing',
          elapsedMs: 0,
          details: [
            { key: 'club-hooks', text: 'TypeScript hooks: lint, type-check, tests' },
            { key: 'other', text: 'Formatting' },
          ],
        }}
        extensions={{ registry: null, projectPaths: [] }}
      />,
    )

    expect(screen.getByText('Finishing...')).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Extension status' })
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['TypeScript hooks: lint, type-check, tests', 'Formatting'])
  })

  it('shows no status list when no extension reports anything', () => {
    render(
      <StatusRow
        row={{ type: 'phase-indicator', label: 'Thinking', elapsedMs: 0 }}
        extensions={{ registry: null, projectPaths: [] }}
      />,
    )

    expect(screen.queryByRole('list', { name: 'Extension status' })).toBeNull()
  })
})
