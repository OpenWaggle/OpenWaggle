import { useRef } from 'react'
import { useResizeGesture } from '@/shared/hooks/useResizeGesture'
import {
  clampedVisibleWidth,
  RESIZE_BODY_CLASS,
  RESIZE_MOVE_THRESHOLD_PX,
  RESIZE_RAIL_HALF_WIDTH_PX,
  resizeRailRightValue,
} from '@/shared/ui/right-sidebar-layout-sizing'
import type {
  ResizeRailActions,
  ResizeRailBounds,
  ResizeRailRefs,
  ResizeRailStateInput,
  WidthAcceptanceContext,
} from '@/shared/ui/right-sidebar-layout-types'

interface ResizeElements {
  readonly panel: HTMLDivElement
  readonly rail: HTMLButtonElement
  readonly root: HTMLDivElement
  readonly sidebar: HTMLDivElement
}

interface ResizeRailControllerParams {
  readonly actions: ResizeRailActions
  readonly bounds: ResizeRailBounds
  readonly refs: ResizeRailRefs
  readonly state: ResizeRailStateInput
  readonly shouldAcceptWidth?: (context: WidthAcceptanceContext) => boolean
}

export function useRightSidebarResizeRail({
  actions,
  bounds,
  refs,
  state,
  shouldAcceptWidth,
}: ResizeRailControllerParams) {
  const resizeElementsRef = useRef<ResizeElements | null>(null)
  const suppressClickRef = useRef(false)

  const resize = useResizeGesture<HTMLButtonElement>({
    getWidth: () => refs.width.current,
    growDirection: 'left',
    maxWidth: bounds.maxWidth,
    minWidth: bounds.minWidth,
    moveThreshold: RESIZE_MOVE_THRESHOLD_PX,
    onCommit: actions.commitWidth,
    onFinish({ moved, reason, width }) {
      const elements = resizeElementsRef.current
      if (!elements) return

      resizeElementsRef.current = null
      elements.panel.style.removeProperty('transition-duration')
      elements.rail.style.removeProperty('transition-duration')
      elements.sidebar.style.removeProperty('transition-duration')
      document.body.classList.remove(RESIZE_BODY_CLASS)
      if (reason === 'cancel') return

      const nextStoredWidth = moved ? width : state.width
      elements.rail.style.setProperty(
        'right',
        resizeRailRightValue(state.open, nextStoredWidth, bounds.mainMinWidth),
      )
      actions.applyWidth(nextStoredWidth)
      if (reason === 'pointer-cancel' || reason === 'pointer-up') {
        suppressClickRef.current = moved
      }
    },
    onPreview(nextWidth) {
      const elements = resizeElementsRef.current
      if (!elements) return

      elements.rail.style.setProperty('right', `${String(nextWidth - RESIZE_RAIL_HALF_WIDTH_PX)}px`)
      actions.applyWidth(nextWidth)
    },
    shouldAcceptWidth(nextWidth) {
      const elements = resizeElementsRef.current
      if (!elements) return false
      return (
        shouldAcceptWidth?.({
          nextWidth,
          panel: elements.panel,
          root: elements.root,
          sidebar: elements.sidebar,
        }) ?? true
      )
    },
  })

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>) {
    if (!state.open || event.button !== 0) return

    const panel = refs.panel.current
    const root = refs.root.current
    const sidebar = refs.sidebar.current
    if (!panel || !root || !sidebar) return

    event.preventDefault()
    event.stopPropagation()

    const startWidth = clampedVisibleWidth(
      refs.width.current,
      bounds.minWidth,
      bounds.maxWidth,
      root.clientWidth,
      bounds.mainMinWidth,
    )
    panel.style.setProperty('transition-duration', '0ms')
    panel.style.setProperty('width', '100%')
    sidebar.style.setProperty('transition-duration', '0ms')
    sidebar.style.setProperty('width', `${String(startWidth)}px`)
    event.currentTarget.style.setProperty('transition-duration', '0ms')
    event.currentTarget.style.setProperty(
      'right',
      `${String(startWidth - RESIZE_RAIL_HALF_WIDTH_PX)}px`,
    )
    document.body.classList.add(RESIZE_BODY_CLASS)

    resizeElementsRef.current = {
      panel,
      rail: event.currentTarget,
      root,
      sidebar,
    }
    resize.startResize(event, startWidth)
  }

  return {
    handleClick(event: React.MouseEvent<HTMLButtonElement>) {
      if (!suppressClickRef.current) return
      suppressClickRef.current = false
      event.preventDefault()
    },
    handleLostPointerCapture: resize.handleLostPointerCapture,
    handlePointerCancel: resize.handlePointerCancel,
    handlePointerDown,
    handlePointerMove: resize.handlePointerMove,
    handlePointerUp: resize.handlePointerUp,
  }
}
