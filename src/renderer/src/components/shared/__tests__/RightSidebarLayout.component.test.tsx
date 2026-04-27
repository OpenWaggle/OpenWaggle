import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RightSidebarLayout } from '../RightSidebarLayout'

function installMatchMedia(matches: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

function renderLayout(open: boolean, onOpenChange = vi.fn()) {
  return render(
    <RightSidebarLayout
      defaultWidth={600}
      maxWidth={900}
      minWidth={360}
      open={open}
      sheetBreakpointPx={1180}
      sidebar={<div>Diff content</div>}
      storageKey="openwaggle:test-diff-sidebar-width"
      onOpenChange={onOpenChange}
    >
      <div>Main content</div>
    </RightSidebarLayout>,
  )
}

describe('RightSidebarLayout', () => {
  beforeEach(() => {
    window.localStorage.clear()
    installMatchMedia(false)
  })

  it('keeps sidebar content mounted after the first open so close can animate', () => {
    const view = renderLayout(false)

    expect(screen.queryByText('Diff content')).toBeNull()

    view.rerender(
      <RightSidebarLayout
        defaultWidth={600}
        maxWidth={900}
        minWidth={360}
        open
        sheetBreakpointPx={1180}
        sidebar={<div>Diff content</div>}
        storageKey="openwaggle:test-diff-sidebar-width"
        onOpenChange={vi.fn()}
      >
        <div>Main content</div>
      </RightSidebarLayout>,
    )

    expect(screen.getByText('Diff content')).toBeInTheDocument()

    view.rerender(
      <RightSidebarLayout
        defaultWidth={600}
        maxWidth={900}
        minWidth={360}
        open={false}
        sheetBreakpointPx={1180}
        sidebar={<div>Diff content</div>}
        storageKey="openwaggle:test-diff-sidebar-width"
        onOpenChange={vi.fn()}
      >
        <div>Main content</div>
      </RightSidebarLayout>,
    )

    expect(screen.getByText('Diff content')).toBeInTheDocument()
  })

  it('restores a persisted inline sidebar width', () => {
    window.localStorage.setItem('openwaggle:test-diff-sidebar-width', '720')

    renderLayout(true)

    expect(screen.getByText('Diff content').closest('aside')).toHaveStyle({ width: '720px' })
  })

  it('renders a dismissible sheet when the viewport is below the sidebar breakpoint', () => {
    installMatchMedia(true)
    const onOpenChange = vi.fn()

    renderLayout(true, onOpenChange)

    fireEvent.click(screen.getByRole('button', { name: 'Close diff sidebar' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
