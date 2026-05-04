import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { cn } from '@/lib/cn'

interface WidthAcceptanceContext {
  readonly currentWidth: number
  readonly nextWidth: number
  readonly gap: HTMLDivElement
  readonly panel: HTMLDivElement
  readonly root: HTMLDivElement
}

interface RightSidebarLayoutProps {
  readonly children: ReactNode
  readonly defaultWidth: number
  readonly maxWidth: number
  readonly minWidth: number
  readonly open: boolean
  readonly sheetBreakpointPx: number
  readonly sidebar: ReactNode
  readonly storageKey: string
  readonly onOpenChange: (open: boolean) => void
  readonly shouldAcceptWidth?: (context: WidthAcceptanceContext) => boolean
}

interface ResizeState {
  readonly gap: HTMLDivElement
  readonly panel: HTMLDivElement
  readonly pointerId: number
  readonly rail: HTMLButtonElement
  readonly root: HTMLDivElement
  readonly startWidth: number
  readonly startX: number
  moved: boolean
  pendingWidth: number
  rafId: number | null
  width: number
}

const RESIZE_MOVE_THRESHOLD_PX = 2
const RESIZE_RAIL_HALF_WIDTH_PX = 8
const RESIZE_BODY_CLASS = 'right-sidebar-resizing'
const SHEET_MAX_WIDTH_PX = 820
const SHEET_VIEWPORT_WIDTH = '88vw'
const ZERO_WIDTH_PX = 0
const STORAGE_RADIX = 10

function clampWidth(width: number, minWidth: number, maxWidth: number): number {
  return Math.max(minWidth, Math.min(width, maxWidth))
}

function readStoredWidth(storageKey: string, fallbackWidth: number): number {
  if (typeof window === 'undefined') {
    return fallbackWidth
  }

  const raw = window.localStorage.getItem(storageKey)
  if (!raw) {
    return fallbackWidth
  }

  const parsed = Number.parseInt(raw, STORAGE_RADIX)
  return Number.isFinite(parsed) ? parsed : fallbackWidth
}

function persistWidth(storageKey: string, width: number): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(storageKey, String(width))
}

function sidebarGapStyle(open: boolean, width: number): CSSProperties {
  return { width: open ? width : ZERO_WIDTH_PX }
}

function sidebarPanelStyle(open: boolean, width: number): CSSProperties {
  return {
    transform: open ? 'translateX(0)' : 'translateX(100%)',
    width,
  }
}

function resizeRailStyle(open: boolean, width: number): CSSProperties {
  return { right: open ? width - RESIZE_RAIL_HALF_WIDTH_PX : ZERO_WIDTH_PX }
}

export function RightSidebarLayout({
  children,
  defaultWidth,
  maxWidth,
  minWidth,
  open,
  sheetBreakpointPx,
  sidebar,
  storageKey,
  onOpenChange,
  shouldAcceptWidth,
}: RightSidebarLayoutProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const gapRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const hasOpenedRef = useRef(false)
  const [width, setWidth] = useState(() =>
    clampWidth(readStoredWidth(storageKey, defaultWidth), minWidth, maxWidth),
  )
  const widthRef = useRef(width)
  const isSheet = useMediaQuery(`(max-width: ${String(sheetBreakpointPx)}px)`)
  const shouldRenderSidebar = hasOpenedRef.current || open

  useEffect(() => {
    widthRef.current = width
    gapRef.current?.style.setProperty('width', `${String(open ? width : ZERO_WIDTH_PX)}px`)
    panelRef.current?.style.setProperty('width', `${String(width)}px`)
  }, [open, width])

  useEffect(() => {
    if (open) {
      return
    }

    const panel = panelRef.current
    const activeElement = document.activeElement
    if (!panel || !activeElement || !panel.contains(activeElement)) {
      return
    }

    mainRef.current?.focus({ preventScroll: true })
  }, [open])

  function capturePanel(node: HTMLDivElement | null): void {
    panelRef.current = node
    if (node && open) {
      hasOpenedRef.current = true
    }
  }

  function applyWidth(nextWidth: number): void {
    widthRef.current = nextWidth
    gapRef.current?.style.setProperty('width', `${String(nextWidth)}px`)
    panelRef.current?.style.setProperty('width', `${String(nextWidth)}px`)
  }

  function commitWidth(nextWidth: number): void {
    const clampedWidth = clampWidth(nextWidth, minWidth, maxWidth)
    widthRef.current = clampedWidth
    setWidth(clampedWidth)
    persistWidth(storageKey, clampedWidth)
  }

  if (isSheet) {
    return (
      <>
        {children}
        {shouldRenderSidebar ? (
          <RightSidebarSheet open={open} onOpenChange={onOpenChange}>
            {sidebar}
          </RightSidebarSheet>
        ) : null}
      </>
    )
  }

  return (
    <div ref={rootRef} className="relative flex h-full min-w-0 flex-1 overflow-hidden">
      <div
        ref={mainRef}
        className="min-w-0 flex-1 overflow-hidden"
        data-right-sidebar-main="true"
        tabIndex={-1}
      >
        {children}
      </div>

      {shouldRenderSidebar ? (
        <>
          <div
            ref={gapRef}
            aria-hidden="true"
            className="h-full shrink-0 transition-[width] duration-200 ease-linear"
            style={sidebarGapStyle(open, width)}
          />
          <ResizeRail
            maxWidth={maxWidth}
            minWidth={minWidth}
            open={open}
            gapRef={gapRef}
            panelRef={panelRef}
            rootRef={rootRef}
            width={width}
            widthRef={widthRef}
            applyWidth={applyWidth}
            commitWidth={commitWidth}
            shouldAcceptWidth={shouldAcceptWidth}
          />
          <aside
            ref={capturePanel}
            inert={!open}
            className={cn(
              'absolute inset-y-0 right-0 z-10 h-full overflow-hidden border-l border-border bg-diff-bg transition-[transform,width] duration-200 ease-linear',
              open ? 'pointer-events-auto' : 'pointer-events-none',
            )}
            style={sidebarPanelStyle(open, width)}
          >
            <div className="h-full w-full min-w-0 overflow-hidden">{sidebar}</div>
          </aside>
        </>
      ) : null}
    </div>
  )
}

interface ResizeRailProps {
  readonly maxWidth: number
  readonly minWidth: number
  readonly open: boolean
  readonly gapRef: RefObject<HTMLDivElement | null>
  readonly panelRef: RefObject<HTMLDivElement | null>
  readonly rootRef: RefObject<HTMLDivElement | null>
  readonly width: number
  readonly widthRef: RefObject<number>
  readonly applyWidth: (width: number) => void
  readonly commitWidth: (width: number) => void
  readonly shouldAcceptWidth?: (context: WidthAcceptanceContext) => boolean
}

function ResizeRail({
  maxWidth,
  minWidth,
  open,
  gapRef,
  panelRef,
  rootRef,
  width,
  widthRef,
  applyWidth,
  commitWidth,
  shouldAcceptWidth,
}: ResizeRailProps) {
  const resizeStateRef = useRef<ResizeState | null>(null)
  const suppressClickRef = useRef(false)

  function cleanupResizeState(pointerId: number): void {
    const resizeState = resizeStateRef.current
    if (!resizeState) {
      return
    }

    resizeStateRef.current = null

    if (resizeState.rafId !== null) {
      window.cancelAnimationFrame(resizeState.rafId)
    }

    resizeState.gap.style.removeProperty('transition-duration')
    resizeState.panel.style.removeProperty('transition-duration')
    resizeState.rail.style.removeProperty('transition-duration')
    document.body.classList.remove(RESIZE_BODY_CLASS)

    if (resizeState.rail.hasPointerCapture(pointerId)) {
      resizeState.rail.releasePointerCapture(pointerId)
    }

    commitWidth(resizeState.width)
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>): void {
    if (!open || event.button !== 0) {
      return
    }

    const gap = gapRef.current
    const panel = panelRef.current
    const root = rootRef.current
    if (!gap || !panel || !root) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const startWidth = clampWidth(widthRef.current, minWidth, maxWidth)
    gap.style.setProperty('transition-duration', '0ms')
    gap.style.setProperty('width', `${String(startWidth)}px`)
    panel.style.setProperty('transition-duration', '0ms')
    panel.style.setProperty('width', `${String(startWidth)}px`)
    event.currentTarget.style.setProperty('transition-duration', '0ms')
    event.currentTarget.style.setProperty(
      'right',
      `${String(startWidth - RESIZE_RAIL_HALF_WIDTH_PX)}px`,
    )
    document.body.classList.add(RESIZE_BODY_CLASS)

    resizeStateRef.current = {
      gap,
      moved: false,
      panel,
      pendingWidth: startWidth,
      pointerId: event.pointerId,
      rafId: null,
      rail: event.currentTarget,
      root,
      startWidth,
      startX: event.clientX,
      width: startWidth,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function handlePointerMove(event: React.PointerEvent<HTMLButtonElement>): void {
    const resizeState = resizeStateRef.current
    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      return
    }

    event.preventDefault()
    const delta = resizeState.startX - event.clientX
    if (Math.abs(delta) > RESIZE_MOVE_THRESHOLD_PX) {
      resizeState.moved = true
    }
    resizeState.pendingWidth = clampWidth(resizeState.startWidth + delta, minWidth, maxWidth)

    if (resizeState.rafId !== null) {
      return
    }

    resizeState.rafId = window.requestAnimationFrame(() => {
      const activeState = resizeStateRef.current
      if (!activeState) {
        return
      }

      activeState.rafId = null
      const nextWidth = activeState.pendingWidth
      const accepted =
        shouldAcceptWidth?.({
          currentWidth: activeState.width,
          nextWidth,
          gap: activeState.gap,
          panel: activeState.panel,
          root: activeState.root,
        }) ?? true

      if (!accepted) {
        return
      }

      activeState.width = nextWidth
      activeState.rail.style.setProperty(
        'right',
        `${String(nextWidth - RESIZE_RAIL_HALF_WIDTH_PX)}px`,
      )
      applyWidth(nextWidth)
    })
  }

  function endResize(event: React.PointerEvent<HTMLButtonElement>): void {
    const resizeState = resizeStateRef.current
    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      return
    }

    event.preventDefault()
    suppressClickRef.current = resizeState.moved
    cleanupResizeState(event.pointerId)
  }

  useEffect(() => {
    return () => {
      const resizeState = resizeStateRef.current
      if (!resizeState) {
        return
      }
      if (resizeState.rafId !== null) {
        window.cancelAnimationFrame(resizeState.rafId)
      }
      resizeState.gap.style.removeProperty('transition-duration')
      resizeState.panel.style.removeProperty('transition-duration')
      resizeState.rail.style.removeProperty('transition-duration')
      document.body.classList.remove(RESIZE_BODY_CLASS)
    }
  }, [])

  return (
    <button
      type="button"
      aria-label="Resize diff sidebar"
      className={cn(
        'absolute inset-y-0 z-20 hidden w-4 shrink-0 cursor-col-resize border-0 bg-transparent p-0 transition-[right,opacity] duration-200 ease-linear sm:block',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors',
        'hover:after:bg-accent/50 active:after:bg-accent/70',
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
      style={resizeRailStyle(open, width)}
      onClick={(event) => {
        if (!suppressClickRef.current) {
          return
        }
        suppressClickRef.current = false
        event.preventDefault()
      }}
      onLostPointerCapture={(event) => cleanupResizeState(event.pointerId)}
      onPointerCancel={endResize}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endResize}
      tabIndex={-1}
      title="Drag to resize diff sidebar"
    />
  )
}

interface RightSidebarSheetProps {
  readonly children: ReactNode
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}

function RightSidebarSheet({ children, open, onOpenChange }: RightSidebarSheetProps) {
  return (
    <div
      inert={!open}
      className={cn(
        'fixed inset-0 z-50 transition-opacity duration-200 ease-out',
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <button
        type="button"
        aria-label="Close diff sidebar"
        className="absolute inset-0 bg-black/35 backdrop-blur-[2px]"
        onClick={() => onOpenChange(false)}
      />
      <aside
        className={cn(
          'absolute inset-y-0 right-0 min-w-0 overflow-hidden border-l border-border bg-diff-bg shadow-2xl shadow-black/30 transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
        )}
        style={{ width: `min(${SHEET_VIEWPORT_WIDTH}, ${String(SHEET_MAX_WIDTH_PX)}px)` }}
      >
        {children}
      </aside>
    </div>
  )
}
