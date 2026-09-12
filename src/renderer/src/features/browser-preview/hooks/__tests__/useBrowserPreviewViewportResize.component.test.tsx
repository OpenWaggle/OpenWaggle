import type {
  BrowserPreviewFixedViewport,
  BrowserPreviewViewport,
} from '@shared/types/browser-preview-controls'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserPreviewViewportResizeHandles } from '../../components/BrowserPreviewViewportResizeHandles'
import { useBrowserPreviewViewportResize } from '../useBrowserPreviewViewportResize'

interface ResizeHarnessProps {
  readonly aspectRatio?: number | null
  readonly enabled?: boolean
  readonly previewId?: string
  readonly viewport: BrowserPreviewViewport
  readonly zoomFactor?: number
  readonly onCommit: (viewport: BrowserPreviewFixedViewport) => Promise<void>
}

function ResizeHarness({
  aspectRatio = null,
  enabled = true,
  previewId = 'preview-a',
  viewport,
  zoomFactor = 1,
  onCommit,
}: ResizeHarnessProps) {
  const resize = useBrowserPreviewViewportResize({
    aspectRatio,
    containerSize: { width: 1_000, height: 800 },
    enabled,
    previewId,
    viewport,
    zoomFactor,
    onCommit,
  })
  return (
    <div>
      <output
        data-testid="effective-viewport"
        data-mode={resize.effectiveViewport.mode}
        data-width={
          resize.effectiveViewport.mode === 'fixed' ? resize.effectiveViewport.width : undefined
        }
        data-height={
          resize.effectiveViewport.mode === 'fixed' ? resize.effectiveViewport.height : undefined
        }
      />
      {enabled && resize.effectiveViewport.mode === 'fixed' ? (
        <BrowserPreviewViewportResizeHandles
          activeDirection={resize.activeDirection}
          handlers={{
            onKeyDown: resize.handleResizeKeyDown,
            onPointerDown: resize.handleResizePointerDown,
          }}
          layout={resize.layout}
        />
      ) : null}
    </div>
  )
}

const FREEFORM_VIEWPORT = {
  mode: 'fixed',
  width: 600,
  height: 400,
  presetId: null,
} as const

function rightEdge() {
  return screen.getByRole('button', {
    name: 'Resize browser viewport from right edge. Use arrow keys to resize.',
  })
}

function bottomRightCorner() {
  return screen.getByRole('button', {
    name: 'Resize browser viewport from bottom-right corner. Use arrow keys to resize.',
  })
}

function effectiveViewport() {
  return screen.getByTestId('effective-viewport')
}

afterEach(() => vi.useRealTimers())

describe('useBrowserPreviewViewportResize keyboard input', () => {
  it('keeps a clicked rail focused for a following keyboard resize', async () => {
    vi.useFakeTimers()
    const onCommit = vi.fn(async () => undefined)
    render(<ResizeHarness viewport={FREEFORM_VIEWPORT} onCommit={onCommit} />)
    const rail = rightEdge()
    fireEvent.pointerDown(rail, { button: 0, pointerId: 1 })
    fireEvent.pointerUp(window, { button: 0, pointerId: 1 })
    expect(rail).toHaveFocus()
    fireEvent.keyDown(rail, { key: 'ArrowRight' })
    await act(() => vi.advanceTimersByTimeAsync(150))
    expect(onCommit).toHaveBeenCalledExactlyOnceWith({ ...FREEFORM_VIEWPORT, width: 610 })
  })

  it('previews ten CSS pixels and commits once after the 150 ms trailing edge', async () => {
    vi.useFakeTimers()
    const onCommit = vi.fn(async () => undefined)
    render(<ResizeHarness viewport={FREEFORM_VIEWPORT} zoomFactor={2} onCommit={onCommit} />)

    fireEvent.keyDown(rightEdge(), { key: 'ArrowRight' })
    expect(effectiveViewport()).toHaveAttribute('data-width', '610')
    expect(onCommit).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(149))
    expect(onCommit).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))

    expect(onCommit).toHaveBeenCalledExactlyOnceWith({
      mode: 'fixed',
      width: 610,
      height: 400,
      presetId: null,
    })
  })

  it('uses fifty CSS pixels with Shift and ignores arrows outside a rail axis', async () => {
    vi.useFakeTimers()
    const onCommit = vi.fn(async () => undefined)
    render(<ResizeHarness viewport={FREEFORM_VIEWPORT} zoomFactor={0.5} onCommit={onCommit} />)

    fireEvent.keyDown(rightEdge(), { key: 'ArrowDown' })
    expect(effectiveViewport()).toHaveAttribute('data-width', '600')
    fireEvent.keyDown(rightEdge(), { key: 'ArrowRight', shiftKey: true })
    expect(effectiveViewport()).toHaveAttribute('data-width', '650')
    await act(() => vi.advanceTimersByTimeAsync(150))

    expect(onCommit).toHaveBeenCalledExactlyOnceWith({
      mode: 'fixed',
      width: 650,
      height: 400,
      presetId: null,
    })
  })

  it('keeps keyboard changes on the locked aspect ratio', () => {
    const onCommit = vi.fn(async () => undefined)
    render(<ResizeHarness viewport={FREEFORM_VIEWPORT} aspectRatio={1.5} onCommit={onCommit} />)

    fireEvent.keyDown(bottomRightCorner(), { key: 'ArrowRight' })

    expect(effectiveViewport()).toHaveAttribute('data-width', '610')
    expect(effectiveViewport()).toHaveAttribute('data-height', '407')
  })

  it('does not discard a keyboard draft when pointer capture starts before its timer', async () => {
    vi.useFakeTimers()
    const onCommit = vi.fn(async () => undefined)
    render(<ResizeHarness viewport={FREEFORM_VIEWPORT} onCommit={onCommit} />)
    const rail = rightEdge()
    fireEvent.keyDown(rail, { key: 'ArrowRight' })

    fireEvent.pointerDown(rail, { pointerId: 5, clientX: 800, clientY: 400 })
    fireEvent.pointerUp(window, { pointerId: 5, clientX: 800, clientY: 400 })
    await act(async () => undefined)
    await act(() => vi.advanceTimersByTimeAsync(150))

    expect(onCommit).toHaveBeenCalledExactlyOnceWith({
      mode: 'fixed',
      width: 610,
      height: 400,
      presetId: null,
    })
  })

  it('cancels a trailing commit when the tab or source viewport changes', async () => {
    vi.useFakeTimers()
    const onCommit = vi.fn(async () => undefined)
    const view = render(<ResizeHarness viewport={FREEFORM_VIEWPORT} onCommit={onCommit} />)
    fireEvent.keyDown(rightEdge(), { key: 'ArrowRight' })

    view.rerender(
      <ResizeHarness
        previewId="preview-b"
        viewport={{ ...FREEFORM_VIEWPORT, width: 700 }}
        onCommit={onCommit}
      />,
    )
    await act(() => vi.advanceTimersByTimeAsync(150))

    expect(onCommit).not.toHaveBeenCalled()
    expect(effectiveViewport()).toHaveAttribute('data-width', '700')
  })
})

describe('useBrowserPreviewViewportResize pointer input', () => {
  it('previews through window fallback listeners and commits only on pointerup', async () => {
    const onCommit = vi.fn(async () => undefined)
    render(<ResizeHarness viewport={FREEFORM_VIEWPORT} onCommit={onCommit} />)
    const rail = rightEdge()

    fireEvent.pointerDown(rail, { pointerId: 7, clientX: 800, clientY: 400 })
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 850, clientY: 400 })
    expect(effectiveViewport()).toHaveAttribute('data-width', '700')
    expect(onCommit).not.toHaveBeenCalled()
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 850, clientY: 400 })
    await act(async () => undefined)

    expect(onCommit).toHaveBeenCalledExactlyOnceWith({
      mode: 'fixed',
      width: 700,
      height: 400,
      presetId: null,
    })
  })

  it('translates pointer motion through page zoom and fitted presentation scale', () => {
    const onCommit = vi.fn(async () => undefined)
    render(<ResizeHarness viewport={FREEFORM_VIEWPORT} zoomFactor={2} onCommit={onCommit} />)
    const rail = rightEdge()

    fireEvent.pointerDown(rail, { pointerId: 8, clientX: 990, clientY: 400 })
    fireEvent.pointerMove(window, { pointerId: 8, clientX: 1_039, clientY: 400 })

    expect(effectiveViewport()).toHaveAttribute('data-width', '630')
  })

  it('rolls a live pointer preview back on pointercancel', () => {
    const onCommit = vi.fn(async () => undefined)
    render(<ResizeHarness viewport={FREEFORM_VIEWPORT} onCommit={onCommit} />)
    const rail = bottomRightCorner()

    fireEvent.pointerDown(rail, { pointerId: 9, clientX: 800, clientY: 600 })
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 850, clientY: 650 })
    expect(effectiveViewport()).toHaveAttribute('data-width', '700')
    expect(effectiveViewport()).toHaveAttribute('data-height', '500')
    fireEvent.pointerCancel(window, { pointerId: 9 })

    expect(effectiveViewport()).toHaveAttribute('data-width', '600')
    expect(effectiveViewport()).toHaveAttribute('data-height', '400')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('drops an active drag when its viewport source becomes stale', () => {
    const onCommit = vi.fn(async () => undefined)
    const view = render(<ResizeHarness viewport={FREEFORM_VIEWPORT} onCommit={onCommit} />)
    fireEvent.pointerDown(rightEdge(), { pointerId: 11, clientX: 800, clientY: 400 })
    fireEvent.pointerMove(window, { pointerId: 11, clientX: 850, clientY: 400 })

    view.rerender(
      <ResizeHarness viewport={{ ...FREEFORM_VIEWPORT, width: 900 }} onCommit={onCommit} />,
    )
    fireEvent.pointerUp(window, { pointerId: 11, clientX: 850, clientY: 400 })

    expect(effectiveViewport()).toHaveAttribute('data-width', '900')
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('does not expose resize handles in fill mode or a non-resizable host', () => {
    const onCommit = vi.fn(async () => undefined)
    const view = render(<ResizeHarness viewport={{ mode: 'fill' }} onCommit={onCommit} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)

    view.rerender(
      <ResizeHarness viewport={FREEFORM_VIEWPORT} enabled={false} onCommit={onCommit} />,
    )
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
