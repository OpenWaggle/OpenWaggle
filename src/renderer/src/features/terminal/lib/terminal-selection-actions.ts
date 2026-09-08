export interface TerminalSelectionPoint {
  readonly x: number
  readonly y: number
}

interface TerminalSelectionBounds {
  readonly left: number
  readonly top: number
  readonly width: number
  readonly height: number
}

interface TerminalSelectionActionSize {
  readonly width: number
  readonly height: number
}

export const TERMINAL_SELECTION_MULTI_CLICK_MS = 500
const VIEWPORT_GUTTER = 8
const SELECTION_GAP = 4
const MULTI_CLICK_DETAIL = 2

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(value, Math.max(minimum, maximum)))
}

/** Anchors the toolbar at the release/selection end while keeping it fully visible. */
export function resolveTerminalSelectionActionPosition(input: {
  readonly bounds: TerminalSelectionBounds
  readonly selectionRect: { readonly right: number; readonly bottom: number } | null
  readonly pointer: TerminalSelectionPoint | null
  readonly viewport: { readonly width: number; readonly height: number }
  readonly actionSize: TerminalSelectionActionSize
}): TerminalSelectionPoint {
  const { bounds, actionSize, viewport } = input
  const preferred = input.pointer ?? {
    x: input.selectionRect?.right ?? bounds.left + bounds.width - actionSize.width,
    y: input.selectionRect?.bottom ?? bounds.top,
  }
  const minimumX = Math.max(VIEWPORT_GUTTER, bounds.left)
  const minimumY = Math.max(VIEWPORT_GUTTER, bounds.top)
  const maximumX = Math.min(
    bounds.left + bounds.width - actionSize.width,
    viewport.width - VIEWPORT_GUTTER - actionSize.width,
  )
  const maximumY = Math.min(
    bounds.top + bounds.height - actionSize.height,
    viewport.height - VIEWPORT_GUTTER - actionSize.height,
  )
  return {
    x: clamp(preferred.x, minimumX, maximumX),
    y: clamp(preferred.y + SELECTION_GAP, minimumY, maximumY),
  }
}

interface SelectionActionObserverOptions {
  readonly element: HTMLElement
  readonly getActionElement: () => HTMLElement | null
  readonly onSelection: (pointer: TerminalSelectionPoint | null) => void
  readonly onDismiss: () => void
}

interface SelectionActionObserverState {
  pointerDown: boolean
  gestureActive: boolean
  dismissed: boolean
  pointer: TerminalSelectionPoint | null
  timer: number | null
  frame: number | null
}

interface SelectionActionListeners {
  readonly onPointerDown: (event: PointerEvent) => void
  readonly onSelectionStart: (event: PointerEvent) => void
  readonly onPointerUp: (event: PointerEvent) => void
  readonly onMouseUp: (event: MouseEvent) => void
  readonly onKeyDown: (event: KeyboardEvent) => void
  readonly onFocusIn: (event: FocusEvent) => void
  readonly onContextMenu: () => void
  readonly onScroll: () => void
  readonly dismiss: () => void
}

function createSelectionActionObserverState(): SelectionActionObserverState {
  return {
    pointerDown: false,
    gestureActive: false,
    dismissed: false,
    pointer: null,
    timer: null,
    frame: null,
  }
}

function listenForSelectionActions(
  options: SelectionActionObserverOptions,
  listeners: SelectionActionListeners,
) {
  const document = options.element.ownerDocument
  const view = document.defaultView ?? window
  document.addEventListener('pointerdown', listeners.onPointerDown, true)
  options.element.addEventListener('pointerdown', listeners.onSelectionStart)
  view.addEventListener('pointerup', listeners.onPointerUp)
  view.addEventListener('mouseup', listeners.onMouseUp)
  document.addEventListener('keydown', listeners.onKeyDown)
  document.addEventListener('focusin', listeners.onFocusIn)
  options.element.addEventListener('contextmenu', listeners.onContextMenu, true)
  options.element.addEventListener('scroll', listeners.onScroll, true)
  view.addEventListener('pointercancel', listeners.dismiss)
  view.addEventListener('blur', listeners.dismiss)
  view.addEventListener('resize', listeners.dismiss)
  return () => {
    document.removeEventListener('pointerdown', listeners.onPointerDown, true)
    options.element.removeEventListener('pointerdown', listeners.onSelectionStart)
    view.removeEventListener('pointerup', listeners.onPointerUp)
    view.removeEventListener('mouseup', listeners.onMouseUp)
    document.removeEventListener('keydown', listeners.onKeyDown)
    document.removeEventListener('focusin', listeners.onFocusIn)
    options.element.removeEventListener('contextmenu', listeners.onContextMenu, true)
    options.element.removeEventListener('scroll', listeners.onScroll, true)
    view.removeEventListener('pointercancel', listeners.dismiss)
    view.removeEventListener('blur', listeners.dismiss)
    view.removeEventListener('resize', listeners.dismiss)
  }
}

/** Defers multi-click selections and invalidates stale toolbar positions on interaction. */
export function observeTerminalSelectionActions(options: SelectionActionObserverOptions) {
  const document = options.element.ownerDocument
  const view = document.defaultView ?? window
  const state = createSelectionActionObserverState()
  const isActionTarget = (target: EventTarget | null) =>
    target instanceof Node && options.getActionElement()?.contains(target) === true
  const cancelPending = () => {
    if (state.timer !== null) view.clearTimeout(state.timer)
    if (state.frame !== null) view.cancelAnimationFrame(state.frame)
    state.timer = null
    state.frame = null
  }
  const cancel = () => {
    cancelPending()
    state.pointerDown = false
    state.gestureActive = false
    state.pointer = null
    state.dismissed = true
  }
  const dismiss = () => {
    cancel()
    options.onDismiss()
  }
  const schedule = (delay: number) => {
    cancelPending()
    state.timer = view.setTimeout(() => {
      state.timer = null
      state.frame = view.requestAnimationFrame(() => {
        state.frame = null
        options.onSelection(state.pointer)
      })
    }, delay)
  }
  const onPointerDown = (event: PointerEvent) => {
    if (!event.isPrimary) return
    if (isActionTarget(event.target)) {
      cancel()
      return
    }
    cancelPending()
    state.pointerDown = event.button === 0
    const inside = event.target instanceof Node && options.element.contains(event.target)
    state.gestureActive = false
    state.dismissed = true
    state.pointer = null
    if (inside || options.getActionElement() !== null) options.onDismiss()
  }
  const onSelectionStart = (event: PointerEvent) => {
    if (!event.isPrimary) return
    state.gestureActive = event.button === 0 && !event.defaultPrevented
    state.dismissed = !state.gestureActive
  }
  const onPointerUp = (event: PointerEvent) => {
    if (event.isPrimary && event.button === 0) state.pointerDown = false
  }
  const onMouseUp = (event: MouseEvent) => {
    if (event.button !== 0) return
    state.pointerDown = false
    if (!state.gestureActive) return
    state.gestureActive = false
    state.dismissed = false
    state.pointer = { x: event.clientX, y: event.clientY }
    schedule(event.detail >= MULTI_CLICK_DETAIL ? TERMINAL_SELECTION_MULTI_CLICK_MS : 0)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (isActionTarget(event.target) && event.key !== 'Escape') return
    if (event.key === 'Escape') {
      dismiss()
      return
    }
    if (state.pointerDown) return
    cancelPending()
    state.gestureActive = false
    state.pointer = null
    state.dismissed = false
  }
  const onFocusIn = (event: FocusEvent) => {
    const actionElement = options.getActionElement()
    if (actionElement !== null && !isActionTarget(event.target) && !state.pointerDown) dismiss()
  }
  const onScroll = () => {
    cancelPending()
    if (!state.pointerDown) {
      state.pointer = null
      state.dismissed = true
    }
    options.onDismiss()
  }
  const onContextMenu = () => dismiss()

  const unlisten = listenForSelectionActions(options, {
    onPointerDown,
    onSelectionStart,
    onPointerUp,
    onMouseUp,
    onKeyDown,
    onFocusIn,
    onContextMenu,
    onScroll,
    dismiss,
  })

  return {
    cancel,
    dismiss,
    selectionChanged() {
      if (isActionTarget(document.activeElement)) return
      if (state.pointerDown || state.gestureActive) {
        options.onDismiss()
        return
      }
      if (state.timer !== null || state.frame !== null) return
      state.dismissed = false
      schedule(0)
    },
    dispose() {
      cancel()
      unlisten()
    },
  }
}
