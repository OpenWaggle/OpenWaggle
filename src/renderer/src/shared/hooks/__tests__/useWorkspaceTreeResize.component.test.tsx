import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from '@/shared/ui/Button'
import { useWorkspaceTreeResize } from '../useWorkspaceTreeResize'

const STORAGE_KEY = 'openwaggle:workspace-tree-width:v1'
const LEGACY_STORAGE_KEY = 'openwaggle:changed-file-navigator-width:v1'
const DEFAULT_WIDTH = 220
const MIN_WIDTH = 140
const MAX_WIDTH = 480
const START_X = 500
const POINTER_ID = 7

function WorkspaceTreeResizeHarness() {
  const resize = useWorkspaceTreeResize()

  return (
    <Button
      variant="unstyled"
      type="button"
      data-resizing={resize.isResizing}
      data-width={resize.width}
      onKeyDown={resize.handleKeyDown}
      onLostPointerCapture={resize.handleLostPointerCapture}
      onPointerCancel={resize.handlePointerCancel}
      onPointerDown={resize.handlePointerDown}
      onPointerMove={resize.handlePointerMove}
      onPointerUp={resize.handlePointerUp}
    >
      Resize navigator
    </Button>
  )
}

function installPointerCapture(element: HTMLElement) {
  let capturedPointerId: number | null = null
  const setPointerCapture = vi.fn((pointerId: number) => {
    capturedPointerId = pointerId
  })
  const releasePointerCapture = vi.fn((pointerId: number) => {
    if (capturedPointerId === pointerId) capturedPointerId = null
  })
  Object.defineProperties(element, {
    hasPointerCapture: {
      configurable: true,
      value: (pointerId: number) => capturedPointerId === pointerId,
    },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
    setPointerCapture: { configurable: true, value: setPointerCapture },
  })
  return { releasePointerCapture, setPointerCapture }
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

describe('useWorkspaceTreeResize', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('grows left, batches previews, clamps, and persists the commit', () => {
    const animationFrame = installAnimationFrame()
    render(<WorkspaceTreeResizeHarness />)
    const rail = screen.getByRole('button', { name: 'Resize navigator' })
    const capture = installPointerCapture(rail)

    expect(rail).toHaveAttribute('data-width', String(DEFAULT_WIDTH))
    fireEvent.pointerDown(rail, { button: 0, clientX: START_X, pointerId: POINTER_ID })
    expect(rail).toHaveAttribute('data-resizing', 'true')
    expect(capture.setPointerCapture).toHaveBeenCalledWith(POINTER_ID)

    fireEvent.pointerMove(rail, { clientX: 450, pointerId: POINTER_ID })
    fireEvent.pointerMove(rail, { clientX: 400, pointerId: POINTER_ID })
    expect(rail).toHaveAttribute('data-width', String(DEFAULT_WIDTH))
    act(() => animationFrame.flush())
    expect(rail).toHaveAttribute('data-width', '320')

    fireEvent.pointerUp(rail, { clientX: 400, pointerId: POINTER_ID })
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('320')
    expect(rail).toHaveAttribute('data-resizing', 'false')
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(POINTER_ID)

    fireEvent.pointerDown(rail, { button: 0, clientX: START_X, pointerId: POINTER_ID })
    fireEvent.pointerMove(rail, { clientX: 900, pointerId: POINTER_ID })
    act(() => animationFrame.flush())
    fireEvent.pointerUp(rail, { clientX: 900, pointerId: POINTER_ID })
    expect(rail).toHaveAttribute('data-width', String(MIN_WIDTH))
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(String(MIN_WIDTH))
  })

  it('clamps stored and keyboard widths while preserving arrow direction', () => {
    window.localStorage.setItem(STORAGE_KEY, '999')
    render(<WorkspaceTreeResizeHarness />)
    const rail = screen.getByRole('button', { name: 'Resize navigator' })

    expect(rail).toHaveAttribute('data-width', String(MAX_WIDTH))
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(String(MAX_WIDTH))

    fireEvent.keyDown(rail, { key: 'ArrowRight' })
    expect(rail).toHaveAttribute('data-width', '464')
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('464')

    fireEvent.keyDown(rail, { key: 'ArrowLeft' })
    expect(rail).toHaveAttribute('data-width', String(MAX_WIDTH))
  })

  it('keeps the width previously chosen in the diff-only navigator', () => {
    window.localStorage.setItem(LEGACY_STORAGE_KEY, '304')

    render(<WorkspaceTreeResizeHarness />)

    expect(screen.getByRole('button', { name: 'Resize navigator' })).toHaveAttribute(
      'data-width',
      '304',
    )
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('304')
  })

  it('ignores non-primary pointer buttons', () => {
    render(<WorkspaceTreeResizeHarness />)
    const rail = screen.getByRole('button', { name: 'Resize navigator' })
    const capture = installPointerCapture(rail)

    fireEvent.pointerDown(rail, { button: 2, clientX: START_X, pointerId: POINTER_ID })

    expect(rail).toHaveAttribute('data-resizing', 'false')
    expect(capture.setPointerCapture).not.toHaveBeenCalled()
  })

  it('cancels a pending frame and releases capture when its consumer unmounts', () => {
    const animationFrame = installAnimationFrame()
    const view = render(<WorkspaceTreeResizeHarness />)
    const rail = screen.getByRole('button', { name: 'Resize navigator' })
    const capture = installPointerCapture(rail)

    fireEvent.pointerDown(rail, { button: 0, clientX: START_X, pointerId: POINTER_ID })
    fireEvent.pointerMove(rail, { clientX: 400, pointerId: POINTER_ID })
    view.unmount()

    expect(animationFrame.cancelAnimationFrame).toHaveBeenCalled()
    expect(capture.releasePointerCapture).toHaveBeenCalledWith(POINTER_ID)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(String(DEFAULT_WIDTH))
  })
})
