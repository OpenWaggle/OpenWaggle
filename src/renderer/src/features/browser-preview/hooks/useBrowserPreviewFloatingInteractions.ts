import type { KeyboardEvent, PointerEvent } from 'react'
import { useRef } from 'react'
import {
  clampBrowserPreviewFloatingPosition,
  type FloatingFrame,
  type FloatingResizeDirection,
  resizeBrowserPreviewFloatingFrame,
} from '../lib/browser-preview-floating-layout'
import {
  type BrowserPreviewFloatingSize,
  useBrowserPreviewFloatingStore,
} from '../state/browser-preview-floating-store'

const RESIZE_KEY_STEP = 10
const RESIZE_KEY_LARGE_STEP = 50

interface FloatingInteractionOptions {
  readonly ownerKey: string
  readonly previewId: string
  readonly frame: FloatingFrame
  readonly container: BrowserPreviewFloatingSize
  readonly sourceSize: BrowserPreviewFloatingSize
}

interface PointerOrigin {
  readonly pointerId: number
  readonly x: number
  readonly y: number
  readonly frame: FloatingFrame
  readonly action: 'drag' | FloatingResizeDirection
}

export function useBrowserPreviewFloatingInteractions(options: FloatingInteractionOptions) {
  const originRef = useRef<PointerOrigin | null>(null)
  const applyResize = (frame: FloatingFrame) => {
    const store = useBrowserPreviewFloatingStore.getState()
    store.resize(options.ownerKey, options.previewId, { width: frame.width, height: frame.height })
    store.move(options.ownerKey, options.previewId, { x: frame.x, y: frame.y })
  }
  const begin = (action: PointerOrigin['action'], event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    originRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      frame: options.frame,
      action,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    // Preventing pointer selection also suppresses native button focus. Keep a
    // resize handle keyboard-operable after a click or drag without focusing the header.
    if (action !== 'drag') event.currentTarget.focus({ preventScroll: true })
    event.preventDefault()
    event.stopPropagation()
  }
  const move = (event: PointerEvent<HTMLElement>) => {
    const origin = originRef.current
    if (!origin || origin.pointerId !== event.pointerId) return
    const delta = { x: event.clientX - origin.x, y: event.clientY - origin.y }
    if (origin.action === 'drag') {
      useBrowserPreviewFloatingStore
        .getState()
        .move(
          options.ownerKey,
          options.previewId,
          clampBrowserPreviewFloatingPosition(
            { x: origin.frame.x + delta.x, y: origin.frame.y + delta.y },
            options.container,
            origin.frame,
          ),
        )
      return
    }
    applyResize(
      resizeBrowserPreviewFloatingFrame(
        origin.frame,
        origin.action,
        delta,
        options.container,
        options.sourceSize,
      ),
    )
  }
  const end = (event: PointerEvent<HTMLElement>) => {
    if (originRef.current?.pointerId !== event.pointerId) return
    originRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const keyResize = (direction: FloatingResizeDirection, event: KeyboardEvent<HTMLElement>) => {
    const step = event.shiftKey ? RESIZE_KEY_LARGE_STEP : RESIZE_KEY_STEP
    const horizontal = direction.includes('east') || direction.includes('west')
    const vertical = direction.includes('north') || direction.includes('south')
    const delta = {
      x: horizontal
        ? (event.key === 'ArrowRight' ? step : 0) - (event.key === 'ArrowLeft' ? step : 0)
        : 0,
      y: vertical
        ? (event.key === 'ArrowDown' ? step : 0) - (event.key === 'ArrowUp' ? step : 0)
        : 0,
    }
    if (delta.x === 0 && delta.y === 0) return
    event.preventDefault()
    event.stopPropagation()
    applyResize(
      resizeBrowserPreviewFloatingFrame(
        options.frame,
        direction,
        delta,
        options.container,
        options.sourceSize,
      ),
    )
  }
  const pointerHandlers = {
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
  }
  return {
    dragHandlers: {
      ...pointerHandlers,
      onPointerDown: (event: PointerEvent<HTMLElement>) => begin('drag', event),
    },
    resizeHandlers: (direction: FloatingResizeDirection) => ({
      ...pointerHandlers,
      onPointerDown: (event: PointerEvent<HTMLElement>) => begin(direction, event),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => keyResize(direction, event),
    }),
  }
}
