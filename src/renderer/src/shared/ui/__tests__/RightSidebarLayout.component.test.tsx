import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RightSidebarLayout, sidebarWidthValue } from '../RightSidebarLayout'
import type { WidthAcceptanceContext } from '../right-sidebar-layout-types'

const DEFAULT_WIDTH_PX = 600
const MAX_WIDTH_PX = 900
const MIN_WIDTH_PX = 360
const MAIN_MIN_WIDTH_PX = 420
const SHEET_BREAKPOINT_PX = 1180
const DEFAULT_CLAMPED_WIDTH = 'min(600px, max(0px, calc(100% - 420px)))'
const PERSISTED_CLAMPED_WIDTH = 'min(720px, max(0px, calc(100% - 420px)))'
const STORAGE_KEY = 'openwaggle:test-diff-sidebar-width'
const POINTER_ID = 9
const START_X = 800
const ROOT_WIDTH = 1600
const ACCEPTED_WIDTH = 700

function installMatchMedia(matches: boolean) {
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
    <RightSidebarLayout {...layoutProps(open, onOpenChange)}>
      <div>Main content</div>
    </RightSidebarLayout>,
  )
}

function layoutProps(open: boolean, onOpenChange = vi.fn()) {
  return {
    open,
    sizing: {
      defaultWidth: DEFAULT_WIDTH_PX,
      mainMinWidth: MAIN_MIN_WIDTH_PX,
      maxWidth: MAX_WIDTH_PX,
      minWidth: MIN_WIDTH_PX,
      sheetBreakpointPx: SHEET_BREAKPOINT_PX,
      storageKey: STORAGE_KEY,
    },
    sidebar: <div>Diff content</div>,
    onOpenChange,
  }
}

function installAnimationFrame() {
  let pendingCallback: FrameRequestCallback | null = null
  const cancelAnimationFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {
    pendingCallback = null
  })
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    pendingCallback = callback
    return 1
  })

  return {
    cancelAnimationFrame,
    flush() {
      const callback = pendingCallback
      if (!callback) throw new Error('Expected a pending animation frame')
      pendingCallback = null
      callback(0)
    },
  }
}

function prepareDockedResize() {
  const rail = screen.getByRole('button', { name: 'Resize right sidebar' })
  const root = document.querySelector<HTMLElement>(
    '[data-right-sidebar-main="true"]',
  )?.parentElement
  const panel = document.querySelector<HTMLDivElement>('[data-right-sidebar-panel="true"]')
  const sidebar = document.querySelector<HTMLDivElement>('[data-right-sidebar-shell="true"]')
  if (!root || !panel || !sidebar) throw new Error('Expected the docked sidebar layout')

  Object.defineProperty(root, 'clientWidth', { configurable: true, value: ROOT_WIDTH })
  let capturedPointerId: number | null = null
  const setPointerCapture = vi.fn((pointerId: number) => {
    capturedPointerId = pointerId
  })
  const releasePointerCapture = vi.fn((pointerId: number) => {
    if (capturedPointerId === pointerId) capturedPointerId = null
  })
  Object.defineProperties(rail, {
    hasPointerCapture: {
      configurable: true,
      value: (pointerId: number) => capturedPointerId === pointerId,
    },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
    setPointerCapture: { configurable: true, value: setPointerCapture },
  })

  return { panel, rail, releasePointerCapture, root, setPointerCapture, sidebar }
}

describe('RightSidebarLayout', () => {
  beforeEach(() => {
    window.localStorage.clear()
    installMatchMedia(false)
    vi.restoreAllMocks()
  })

  it('keeps sidebar content mounted after the first open so close can animate', () => {
    const view = renderLayout(false)

    expect(screen.queryByText('Diff content')).toBeNull()
    expect(document.querySelector('[data-right-sidebar-shell="true"]')).toHaveStyle({
      width: '0px',
    })

    view.rerender(
      <RightSidebarLayout {...layoutProps(true)}>
        <div>Main content</div>
      </RightSidebarLayout>,
    )

    expect(screen.getByText('Diff content')).toBeInTheDocument()

    view.rerender(
      <RightSidebarLayout {...layoutProps(false)}>
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
      <RightSidebarLayout {...layoutProps(false)}>
        <div>Main content</div>
      </RightSidebarLayout>,
    )

    expect(document.querySelector<HTMLElement>('[data-right-sidebar-shell="true"]')).toHaveStyle({
      width: '0px',
    })
  })

  it('restores a persisted inline sidebar width', () => {
    window.localStorage.setItem(STORAGE_KEY, '720')

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

  it('grows left, clamps before acceptance, previews accepted widths, and persists on release', () => {
    const animationFrame = installAnimationFrame()
    const shouldAcceptWidth = vi.fn((context: WidthAcceptanceContext) => {
      return context.nextWidth <= ACCEPTED_WIDTH
    })
    render(
      <RightSidebarLayout {...layoutProps(true)} shouldAcceptWidth={shouldAcceptWidth}>
        <div>Main content</div>
      </RightSidebarLayout>,
    )
    const { panel, rail, releasePointerCapture, root, setPointerCapture, sidebar } =
      prepareDockedResize()

    fireEvent.pointerDown(rail, { button: 0, clientX: START_X, pointerId: POINTER_ID })
    expect(setPointerCapture).toHaveBeenCalledWith(POINTER_ID)
    expect(document.body).toHaveClass('right-sidebar-resizing')
    expect(panel.style.transitionDuration).toBe('0ms')
    expect(sidebar.style.transitionDuration).toBe('0ms')

    fireEvent.pointerMove(rail, { clientX: -500, pointerId: POINTER_ID })
    animationFrame.flush()
    expect(shouldAcceptWidth).toHaveBeenLastCalledWith({
      nextWidth: MAX_WIDTH_PX,
      panel,
      root,
      sidebar,
    })
    expect(sidebar).toHaveStyle({ width: `${String(DEFAULT_WIDTH_PX)}px` })

    fireEvent.pointerMove(rail, { clientX: 700, pointerId: POINTER_ID })
    animationFrame.flush()
    expect(shouldAcceptWidth).toHaveBeenLastCalledWith({
      nextWidth: ACCEPTED_WIDTH,
      panel,
      root,
      sidebar,
    })
    expect(rail).toHaveStyle({ right: '692px' })

    fireEvent.pointerUp(rail, { clientX: 700, pointerId: POINTER_ID })
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(String(ACCEPTED_WIDTH))
    expect(sidebar).toHaveAttribute('data-right-sidebar-preferred-width', String(ACCEPTED_WIDTH))
    expect(document.body).not.toHaveClass('right-sidebar-resizing')
    expect(panel.style.transitionDuration).toBe('')
    expect(sidebar.style.transitionDuration).toBe('')
    expect(releasePointerCapture).toHaveBeenCalledWith(POINTER_ID)
  })

  it('does not commit movement inside the drag threshold', () => {
    const animationFrame = installAnimationFrame()
    renderLayout(true)
    const { rail, sidebar } = prepareDockedResize()

    fireEvent.pointerDown(rail, { button: 0, clientX: START_X, pointerId: POINTER_ID })
    fireEvent.pointerMove(rail, { clientX: 799, pointerId: POINTER_ID })
    animationFrame.flush()
    fireEvent.pointerUp(rail, { clientX: 799, pointerId: POINTER_ID })

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(sidebar).toHaveAttribute('data-right-sidebar-preferred-width', String(DEFAULT_WIDTH_PX))
  })

  it('cancels pending work and restores global and element state when unmounted', () => {
    const animationFrame = installAnimationFrame()
    const view = renderLayout(true)
    const { panel, rail, releasePointerCapture, sidebar } = prepareDockedResize()

    fireEvent.pointerDown(rail, { button: 0, clientX: START_X, pointerId: POINTER_ID })
    fireEvent.pointerMove(rail, { clientX: 700, pointerId: POINTER_ID })
    view.unmount()

    expect(animationFrame.cancelAnimationFrame).toHaveBeenCalled()
    expect(releasePointerCapture).toHaveBeenCalledWith(POINTER_ID)
    expect(document.body).not.toHaveClass('right-sidebar-resizing')
    expect(panel.style.transitionDuration).toBe('')
    expect(sidebar.style.transitionDuration).toBe('')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
