import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RightSidebarLayout } from '../RightSidebarLayout'

function layout(open: boolean) {
  return (
    <RightSidebarLayout
      open={open}
      onOpenChange={vi.fn()}
      sizing={{
        defaultWidth: 600,
        mainMinWidth: 420,
        maxWidth: 900,
        minWidth: 360,
        sheetBreakpointPx: 1180,
        storageKey: 'openwaggle:test-sidebar-accessibility',
      }}
      sidebar={<input aria-label="Panel filter" defaultValue="Retained filter" />}
    >
      <div>Main content</div>
    </RightSidebarLayout>
  )
}

describe('RightSidebarLayout accessibility', () => {
  it.each([
    ['docked', false],
    ['sheet', true],
  ] as const)(
    'excludes the closed %s panel from accessible navigation without losing its state',
    (_mode, isSheet) => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: isSheet,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }))

      const view = render(layout(true))
      const filter = screen.getByRole('textbox', { name: 'Panel filter' })
      fireEvent.change(filter, { target: { value: 'Edited filter' } })

      view.rerender(layout(false))

      expect(filter).toBeInTheDocument()
      expect(filter.closest('[inert]')).not.toBeNull()
      expect(screen.queryByRole('textbox', { name: 'Panel filter' })).toBeNull()
      expect(screen.queryAllByRole('complementary')).toHaveLength(0)

      view.rerender(layout(true))

      expect(screen.getByRole('textbox', { name: 'Panel filter' })).toBe(filter)
      expect(filter).toHaveValue('Edited filter')
      expect(filter.closest('[inert]')).toBeNull()
      expect(screen.getAllByRole('complementary')).toHaveLength(1)
    },
  )
})
