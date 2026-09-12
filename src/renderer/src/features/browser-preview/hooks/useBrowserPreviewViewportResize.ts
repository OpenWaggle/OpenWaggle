import type {
  BrowserPreviewFixedViewport,
  BrowserPreviewViewport,
} from '@shared/types/browser-preview-controls'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  resolveBrowserPreviewDeviceLayout,
  resolveBrowserPreviewResizableDeviceLayout,
  resolveBrowserPreviewResizeArea,
} from '../lib/browser-preview-device-layout'
import {
  type BrowserPreviewViewportResizeDirection,
  browserPreviewViewportKey,
  commitBrowserPreviewViewportChange,
  resizeBrowserPreviewViewport,
  resizeBrowserPreviewViewportFromRail,
} from '../lib/browser-preview-viewport-actions'

interface BrowserPreviewViewportDraft {
  readonly sourceKey: string
  readonly width: number
  readonly height: number
  readonly direction: BrowserPreviewViewportResizeDirection
}

interface BrowserPreviewViewportResizeOptions {
  readonly aspectRatio: number | null
  readonly containerSize: { readonly width: number; readonly height: number }
  readonly enabled: boolean
  readonly previewId: string
  readonly viewport: BrowserPreviewViewport
  readonly zoomFactor: number
  readonly onCommit: (viewport: BrowserPreviewFixedViewport) => Promise<void>
}

const KEYBOARD_RESIZE_COMMIT_DELAY_MS = 150
const KEYBOARD_RESIZE_STEP = 10
const KEYBOARD_RESIZE_LARGE_STEP = 50

function normalizedScale(scale: number) {
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

function keyboardResizeDelta(
  key: string,
  direction: BrowserPreviewViewportResizeDirection,
  step: number,
) {
  const controlsWidth = direction.includes('east') || direction.includes('west')
  const controlsHeight = direction.includes('south')
  if (key === 'ArrowLeft' && controlsWidth) return { x: -step, y: 0 }
  if (key === 'ArrowRight' && controlsWidth) return { x: step, y: 0 }
  if (key === 'ArrowUp' && controlsHeight) return { x: 0, y: -step }
  if (key === 'ArrowDown' && controlsHeight) return { x: 0, y: step }
  return null
}

function interactionKey(options: BrowserPreviewViewportResizeOptions) {
  return [
    options.previewId,
    browserPreviewViewportKey(options.viewport),
    String(options.zoomFactor),
    String(options.containerSize.width),
    String(options.containerSize.height),
    String(options.aspectRatio),
    options.enabled ? 'enabled' : 'disabled',
  ].join(':')
}

function fixedViewport(draft: BrowserPreviewViewportDraft): BrowserPreviewFixedViewport {
  return {
    mode: 'fixed',
    width: draft.width,
    height: draft.height,
    presetId: null,
  }
}

export function useBrowserPreviewViewportResize(options: BrowserPreviewViewportResizeOptions) {
  const dragCleanupRef = useRef<(() => void) | null>(null)
  const commitVersionRef = useRef(0)
  const sourceKeyRef = useRef<string | null>(null)
  const keyboardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keyboardDraftRef = useRef<BrowserPreviewViewportDraft | null>(null)
  const [draft, setDraft] = useState<BrowserPreviewViewportDraft | null>(null)
  const sourceKey = interactionKey(options)
  const activeDraft = draft?.sourceKey === sourceKey ? draft : null
  const effectiveViewport =
    activeDraft === null || options.viewport.mode === 'fill'
      ? options.viewport
      : fixedViewport(activeDraft)
  const layout =
    options.enabled && effectiveViewport.mode === 'fixed'
      ? resolveBrowserPreviewResizableDeviceLayout(
          options.containerSize,
          effectiveViewport,
          options.zoomFactor,
        )
      : resolveBrowserPreviewDeviceLayout(
          options.containerSize,
          effectiveViewport,
          options.zoomFactor,
        )

  useEffect(() => {
    sourceKeyRef.current = sourceKey
    return () => {
      if (sourceKeyRef.current === sourceKey) sourceKeyRef.current = null
      commitVersionRef.current += 1
      dragCleanupRef.current?.()
      dragCleanupRef.current = null
      if (keyboardTimerRef.current !== null) clearTimeout(keyboardTimerRef.current)
      keyboardTimerRef.current = null
      keyboardDraftRef.current = null
    }
  }, [sourceKey])

  const clearKeyboardDraft = () => {
    if (keyboardTimerRef.current !== null) clearTimeout(keyboardTimerRef.current)
    keyboardTimerRef.current = null
    keyboardDraftRef.current = null
  }

  const commitDraft = (next: BrowserPreviewViewportDraft) => {
    const commitVersion = ++commitVersionRef.current
    const operation = commitBrowserPreviewViewportChange(
      options.previewId,
      fixedViewport(next),
      async (viewport) => {
        if (sourceKeyRef.current !== next.sourceKey) return
        await options.onCommit(viewport)
      },
    )
    const clearIfCurrent = () => {
      if (commitVersionRef.current !== commitVersion) return
      if (sourceKeyRef.current !== next.sourceKey) return
      setDraft(null)
    }
    void operation.then(clearIfCurrent, clearIfCurrent)
  }

  const handleResizeKeyDown = (
    direction: BrowserPreviewViewportResizeDirection,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (!options.enabled || effectiveViewport.mode === 'fill') return
    const cssStep = event.shiftKey ? KEYBOARD_RESIZE_LARGE_STEP : KEYBOARD_RESIZE_STEP
    const zoom = normalizedScale(options.zoomFactor)
    const step = cssStep * zoom
    const delta = keyboardResizeDelta(event.key, direction, step)
    if (delta === null) return
    event.preventDefault()
    event.stopPropagation()
    const pending = keyboardDraftRef.current
    const base = pending?.sourceKey === sourceKey ? pending : effectiveViewport
    const next = resizeBrowserPreviewViewport(base, delta, zoom, direction, options.aspectRatio)
    if (next.width === base.width && next.height === base.height) return
    const keyboardDraft = { sourceKey, ...next, direction }
    keyboardDraftRef.current = keyboardDraft
    setDraft(keyboardDraft)
    if (keyboardTimerRef.current !== null) clearTimeout(keyboardTimerRef.current)
    keyboardTimerRef.current = setTimeout(() => {
      keyboardTimerRef.current = null
      const latest = keyboardDraftRef.current
      if (latest === null || latest.sourceKey !== sourceKeyRef.current) return
      keyboardDraftRef.current = null
      commitDraft(latest)
    }, KEYBOARD_RESIZE_COMMIT_DELAY_MS)
  }

  const handleResizePointerDown = (
    direction: BrowserPreviewViewportResizeDirection,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (!options.enabled || effectiveViewport.mode === 'fill') return
    event.preventDefault()
    event.stopPropagation()
    clearKeyboardDraft()
    dragCleanupRef.current?.()
    commitVersionRef.current += 1
    const pointerId = event.pointerId
    const target = event.currentTarget
    // Pointer default prevention must not leave the keyboard resize target unfocused.
    target.focus({ preventScroll: true })
    const startX = event.clientX
    const startY = event.clientY
    const startWidth = effectiveViewport.width
    const startHeight = effectiveViewport.height
    const preservesExistingDraft = activeDraft !== null
    const available = resolveBrowserPreviewResizeArea(options.containerSize)
    const pointerScale = normalizedScale(options.zoomFactor) * layout.scale
    let latest = { sourceKey, width: startWidth, height: startHeight, direction }
    setDraft(latest)
    try {
      target.setPointerCapture(pointerId)
    } catch {
      // Window listeners retain the drag when pointer capture is unavailable.
    }

    const sourceChanged = () => sourceKeyRef.current !== sourceKey
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      if (sourceChanged()) {
        cleanup()
        return
      }
      moveEvent.preventDefault()
      const next = resizeBrowserPreviewViewportFromRail(
        { width: startWidth, height: startHeight },
        { x: moveEvent.clientX - startX, y: moveEvent.clientY - startY },
        available,
        pointerScale,
        direction,
        options.aspectRatio,
      )
      latest = { sourceKey, ...next, direction }
      setDraft(latest)
    }
    function cleanup() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      dragCleanupRef.current = null
      try {
        target.releasePointerCapture(pointerId)
      } catch {
        // Pointerup can release capture before this cleanup runs.
      }
    }
    function finish(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return
      cleanup()
      if (sourceChanged()) return
      if (latest.width === startWidth && latest.height === startHeight) {
        if (preservesExistingDraft) {
          commitDraft(latest)
          return
        }
        setDraft(null)
        return
      }
      commitDraft(latest)
    }
    function cancel(cancelEvent: PointerEvent) {
      if (cancelEvent.pointerId !== pointerId) return
      cleanup()
      commitVersionRef.current += 1
      setDraft(null)
    }
    dragCleanupRef.current = cleanup
    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
  }

  return {
    activeDirection: activeDraft?.direction ?? null,
    effectiveViewport,
    handleResizeKeyDown,
    handleResizePointerDown,
    layout,
  }
}
