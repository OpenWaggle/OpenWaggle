import { type RenderResult, render, screen } from '@testing-library/react'
import { type Mock, type MockInstance, vi } from 'vitest'
import { Button } from '../Button'
import { RightSidebarLayout } from '../RightSidebarLayout'

export const DEFAULT_WIDTH_PX = 600
export const MAX_WIDTH_PX = 900
export const MIN_WIDTH_PX = 360
export const MAIN_MIN_WIDTH_PX = 420
export const SHEET_BREAKPOINT_PX = 1180
export const DEFAULT_CLAMPED_WIDTH = 'min(600px, max(0px, calc(100% - 420px)))'
export const PERSISTED_CLAMPED_WIDTH = 'min(720px, max(0px, calc(100% - 420px)))'
export const STORAGE_KEY = 'openwaggle:test-diff-sidebar-width'
export const POINTER_ID = 9
export const START_X = 800
export const ROOT_WIDTH = 1600
export const ACCEPTED_WIDTH = 700

export function installMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: (_type: string, callback: () => void) => listeners.add(callback),
    removeEventListener: (_type: string, callback: () => void) => listeners.delete(callback),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
  return (nextMatches: boolean) => {
    matches = nextMatches
    for (const listener of [...listeners]) listener()
  }
}

export function renderLayout(
  open: boolean,
  onOpenChange: (open: boolean) => void = vi.fn(),
): RenderResult {
  return render(
    <RightSidebarLayout {...layoutProps(open, onOpenChange)}>
      <div>Main content</div>
    </RightSidebarLayout>,
  )
}

export function layoutProps(
  open: boolean,
  onOpenChange: (open: boolean) => void = vi.fn(),
  maximized = false,
) {
  return {
    maximized,
    open,
    sizing: {
      defaultWidth: DEFAULT_WIDTH_PX,
      mainMinWidth: MAIN_MIN_WIDTH_PX,
      maxWidth: MAX_WIDTH_PX,
      minWidth: MIN_WIDTH_PX,
      sheetBreakpointPx: SHEET_BREAKPOINT_PX,
      storageKey: STORAGE_KEY,
    },
    sidebar: <Button>Diff content</Button>,
    onOpenChange,
  }
}

export function installAnimationFrame(): {
  readonly cancelAnimationFrame: MockInstance<(handle: number) => void>
  readonly flush: () => void
} {
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

export function prepareDockedResize(): {
  readonly panel: HTMLDivElement
  readonly rail: HTMLElement
  readonly releasePointerCapture: Mock<(pointerId: number) => void>
  readonly root: HTMLElement
  readonly setPointerCapture: Mock<(pointerId: number) => void>
  readonly sidebar: HTMLDivElement
} {
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
