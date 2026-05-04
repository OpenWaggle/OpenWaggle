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
  readonly nextWidth: number
  readonly panel: HTMLDivElement
  readonly root: HTMLDivElement
  readonly sidebar: HTMLDivElement
}

interface RightSidebarLayoutProps {
  readonly children: ReactNode
  readonly defaultWidth: number
  readonly mainMinWidth: number
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
  readonly panel: HTMLDivElement
  readonly pointerId: number
  readonly rail: HTMLButtonElement
  readonly root: HTMLDivElement
  readonly sidebar: HTMLDivElement
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

function pixelValue(value: number): string {
  return `${String(value)}px`
}

export function sidebarWidthValue(width: number, mainMinWidth: number): string {
  return `min(${pixelValue(width)}, max(${pixelValue(ZERO_WIDTH_PX)}, calc(100% - ${pixelValue(mainMinWidth)})))`
}

function sidebarShellStyle(open: boolean, width: number, mainMinWidth: number): CSSProperties {
  return { width: open ? sidebarWidthValue(width, mainMinWidth) : ZERO_WIDTH_PX }
}

function sidebarPanelStyle(): CSSProperties {
  return { width: '100%' }
}

function resizeRailRightValue(open: boolean, width: number, mainMinWidth: number): string {
  return open
    ? `calc(${sidebarWidthValue(width, mainMinWidth)} - ${pixelValue(RESIZE_RAIL_HALF_WIDTH_PX)})`
    : pixelValue(ZERO_WIDTH_PX)
}

function resizeRailStyle(open: boolean, width: number, mainMinWidth: number): CSSProperties {
  return { right: resizeRailRightValue(open, width, mainMinWidth) }
}

function clampedVisibleWidth(
  width: number,
  minWidth: number,
  maxWidth: number,
  rootWidth: number,
  mainMinWidth: number,
): number {
  const maxVisibleWidth = Math.max(ZERO_WIDTH_PX, rootWidth - mainMinWidth)
  return Math.min(clampWidth(width, minWidth, maxWidth), maxVisibleWidth)
}

export function RightSidebarLayout({
  children,
  defaultWidth,
  mainMinWidth,
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
  const sidebarRef = useRef<HTMLDivElement>(null)
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
    sidebarRef.current?.style.setProperty(
      'width',
      open ? sidebarWidthValue(width, mainMinWidth) : pixelValue(ZERO_WIDTH_PX),
    )
    panelRef.current?.style.setProperty('width', '100%')
  }, [mainMinWidth, open, width])

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

  function captureSidebar(node: HTMLDivElement | null): void {
    sidebarRef.current = node
    if (node && open) {
      hasOpenedRef.current = true
    }
  }

  function capturePanel(node: HTMLDivElement | null): void {
    panelRef.current = node
  }

  function applyWidth(nextWidth: number): void {
    widthRef.current = nextWidth
    const nextWidthValue = sidebarWidthValue(nextWidth, mainMinWidth)
    sidebarRef.current?.style.setProperty('width', nextWidthValue)
    panelRef.current?.style.setProperty('width', '100%')
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

      <ResizeRail
        maxWidth={maxWidth}
        mainMinWidth={mainMinWidth}
        minWidth={minWidth}
        open={open}
        panelRef={panelRef}
        rootRef={rootRef}
        sidebarRef={sidebarRef}
        width={width}
        widthRef={widthRef}
        applyWidth={applyWidth}
        commitWidth={commitWidth}
        shouldAcceptWidth={shouldAcceptWidth}
      />
      <aside
        ref={captureSidebar}
        inert={!open}
        className={cn(
          'relative h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-out',
          open ? 'pointer-events-auto' : 'pointer-events-none',
        )}
        data-right-sidebar-main-min-width={mainMinWidth}
        data-right-sidebar-preferred-width={width}
        data-right-sidebar-shell="true"
        style={sidebarShellStyle(open, width, mainMinWidth)}
      >
        {shouldRenderSidebar ? (
          <div
            ref={capturePanel}
            className="absolute inset-y-0 right-0 h-full min-w-0 overflow-hidden border-l border-border bg-diff-bg"
            data-right-sidebar-panel="true"
            style={sidebarPanelStyle()}
          >
            {sidebar}
          </div>
        ) : null}
      </aside>
    </div>
  )
}

interface ResizeRailProps {
  readonly maxWidth: number
  readonly mainMinWidth: number
  readonly minWidth: number
  readonly open: boolean
  readonly panelRef: RefObject<HTMLDivElement | null>
  readonly rootRef: RefObject<HTMLDivElement | null>
  readonly sidebarRef: RefObject<HTMLDivElement | null>
  readonly width: number
  readonly widthRef: RefObject<number>
  readonly applyWidth: (width: number) => void
  readonly commitWidth: (width: number) => void
  readonly shouldAcceptWidth?: (context: WidthAcceptanceContext) => boolean
}

function ResizeRail({
  maxWidth,
  mainMinWidth,
  minWidth,
  open,
  panelRef,
  rootRef,
  sidebarRef,
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
    const nextStoredWidth = resizeState.moved ? resizeState.width : width

    resizeStateRef.current = null

    if (resizeState.rafId !== null) {
      window.cancelAnimationFrame(resizeState.rafId)
    }

    resizeState.panel.style.removeProperty('transition-duration')
    resizeState.rail.style.removeProperty('transition-duration')
    resizeState.sidebar.style.removeProperty('transition-duration')
    resizeState.rail.style.setProperty(
      'right',
      resizeRailRightValue(open, nextStoredWidth, mainMinWidth),
    )
    applyWidth(nextStoredWidth)
    document.body.classList.remove(RESIZE_BODY_CLASS)

    if (resizeState.rail.hasPointerCapture(pointerId)) {
      resizeState.rail.releasePointerCapture(pointerId)
    }

    if (resizeState.moved) {
      commitWidth(nextStoredWidth)
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLButtonElement>): void {
    if (!open || event.button !== 0) {
      return
    }

    const panel = panelRef.current
    const root = rootRef.current
    const sidebar = sidebarRef.current
    if (!panel || !root || !sidebar) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const startWidth = clampedVisibleWidth(
      widthRef.current,
      minWidth,
      maxWidth,
      root.clientWidth,
      mainMinWidth,
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

    resizeStateRef.current = {
      moved: false,
      panel,
      pendingWidth: startWidth,
      pointerId: event.pointerId,
      rafId: null,
      rail: event.currentTarget,
      root,
      sidebar,
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
          nextWidth,
          panel: activeState.panel,
          root: activeState.root,
          sidebar: activeState.sidebar,
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
      resizeState.panel.style.removeProperty('transition-duration')
      resizeState.rail.style.removeProperty('transition-duration')
      resizeState.sidebar.style.removeProperty('transition-duration')
      document.body.classList.remove(RESIZE_BODY_CLASS)
    }
  }, [])

  return (
    <button
      type="button"
      aria-label="Resize right sidebar"
      className={cn(
        'absolute inset-y-0 z-20 hidden w-4 shrink-0 cursor-col-resize border-0 bg-transparent p-0 transition-[right,opacity] duration-200 ease-out sm:block',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors',
        'hover:after:bg-accent/50 active:after:bg-accent/70',
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
      )}
      style={resizeRailStyle(open, width, mainMinWidth)}
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
      title="Drag to resize right sidebar"
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
        aria-label="Close right sidebar"
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
