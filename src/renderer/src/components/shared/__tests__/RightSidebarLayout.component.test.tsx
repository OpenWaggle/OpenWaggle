import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RightSidebarLayout, sidebarWidthValue } from '../RightSidebarLayout'

const DEFAULT_WIDTH_PX = 600
const MAX_WIDTH_PX = 900
const MIN_WIDTH_PX = 360
const MAIN_MIN_WIDTH_PX = 420
const SHEET_BREAKPOINT_PX = 1180
const DEFAULT_CLAMPED_WIDTH = 'min(600px, max(0px, calc(100% - 420px)))'
const PERSISTED_CLAMPED_WIDTH = 'min(720px, max(0px, calc(100% - 420px)))'

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
      defaultWidth={DEFAULT_WIDTH_PX}
      mainMinWidth={MAIN_MIN_WIDTH_PX}
      maxWidth={MAX_WIDTH_PX}
      minWidth={MIN_WIDTH_PX}
      open={open}
      sheetBreakpointPx={SHEET_BREAKPOINT_PX}
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
    expect(document.querySelector('[data-right-sidebar-shell="true"]')).toHaveStyle({
      width: '0px',
    })

    view.rerender(
      <RightSidebarLayout
        defaultWidth={DEFAULT_WIDTH_PX}
        mainMinWidth={MAIN_MIN_WIDTH_PX}
        maxWidth={MAX_WIDTH_PX}
        minWidth={MIN_WIDTH_PX}
        open
        sheetBreakpointPx={SHEET_BREAKPOINT_PX}
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
        defaultWidth={DEFAULT_WIDTH_PX}
        mainMinWidth={MAIN_MIN_WIDTH_PX}
        maxWidth={MAX_WIDTH_PX}
        minWidth={MIN_WIDTH_PX}
        open={false}
        sheetBreakpointPx={SHEET_BREAKPOINT_PX}
        sidebar={<div>Diff content</div>}
        storageKey="openwaggle:test-diff-sidebar-width"
        onOpenChange={vi.fn()}
      >
        <div>Main content</div>
      </RightSidebarLayout>,
    )

    expect(screen.getByText('Diff content')).toBeInTheDocument()
  })

  it('uses the left-sidebar width clipping motion for docked open and close', () => {
    const view = renderLayout(true)

    const sidebar = document.querySelector<HTMLElement>('[data-right-sidebar-shell="true"]')
    const panel = document.querySelector<HTMLElement>('[data-right-sidebar-panel="true"]')

    expect(sidebarWidthValue(DEFAULT_WIDTH_PX, MAIN_MIN_WIDTH_PX)).toBe(DEFAULT_CLAMPED_WIDTH)
    expect(sidebar).toHaveAttribute('data-right-sidebar-preferred-width', '600')
    expect(sidebar).toHaveAttribute('data-right-sidebar-main-min-width', '420')
    expect(sidebar).toHaveClass('transition-[width]', 'duration-200', 'ease-out')
    expect(panel).toHaveStyle({ width: '100%' })
    expect(panel?.getAttribute('style')).not.toContain('transform')

    view.rerender(
      <RightSidebarLayout
        defaultWidth={DEFAULT_WIDTH_PX}
        mainMinWidth={MAIN_MIN_WIDTH_PX}
        maxWidth={MAX_WIDTH_PX}
        minWidth={MIN_WIDTH_PX}
        open={false}
        sheetBreakpointPx={SHEET_BREAKPOINT_PX}
        sidebar={<div>Diff content</div>}
        storageKey="openwaggle:test-diff-sidebar-width"
        onOpenChange={vi.fn()}
      >
        <div>Main content</div>
      </RightSidebarLayout>,
    )

    expect(document.querySelector<HTMLElement>('[data-right-sidebar-shell="true"]')).toHaveStyle({
      width: '0px',
    })
  })

  it('restores a persisted inline sidebar width', () => {
    window.localStorage.setItem('openwaggle:test-diff-sidebar-width', '720')

    renderLayout(true)

    const sidebar = document.querySelector<HTMLElement>('[data-right-sidebar-shell="true"]')

    expect(sidebarWidthValue(720, MAIN_MIN_WIDTH_PX)).toBe(PERSISTED_CLAMPED_WIDTH)
    expect(sidebar).toHaveAttribute('data-right-sidebar-preferred-width', '720')
  })

  it('renders a dismissible sheet when the viewport is below the sidebar breakpoint', () => {
    installMatchMedia(true)
    const onOpenChange = vi.fn()

    renderLayout(true, onOpenChange)

    fireEvent.click(screen.getByRole('button', { name: 'Close right sidebar' }))

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
