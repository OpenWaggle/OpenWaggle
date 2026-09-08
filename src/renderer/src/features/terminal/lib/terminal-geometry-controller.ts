interface TerminalGeometryControllerOptions {
  readonly container: HTMLElement
  readonly fit: () => void
  readonly isAttached: () => boolean
  readonly isDisposed: () => boolean
  readonly isOpenStarted: () => boolean
  readonly open: () => void
  readonly resize: () => void
  readonly resizeDebounceMs: number
}

interface TerminalContainerGeometry {
  readonly width: number
  readonly height: number
}

function containerGeometry(container: HTMLElement): TerminalContainerGeometry {
  const rect = container.getBoundingClientRect()
  return { width: rect.width, height: rect.height }
}

function usableGeometry(geometry: TerminalContainerGeometry) {
  return geometry.width > 0 && geometry.height > 0
}

function sameGeometry(left: TerminalContainerGeometry | null, right: TerminalContainerGeometry) {
  return left !== null && left.width === right.width && left.height === right.height
}

/** Coalesces xterm fits to animation frames and PTY resizes to one trailing RPC. */
export function createTerminalGeometryController(options: TerminalGeometryControllerOptions) {
  let frame: number | null = null
  let resizeTimer: number | null = null
  let previousOpeningGeometry: TerminalContainerGeometry | null = null

  const scheduleResize = () => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null
      if (!options.isDisposed() && options.isAttached()) options.resize()
    }, options.resizeDebounceMs)
  }

  const scheduleFrame = () => {
    frame = requestAnimationFrame(() => {
      frame = null
      if (options.isDisposed()) return
      if (!options.isOpenStarted()) {
        const measured = containerGeometry(options.container)
        if (!usableGeometry(measured)) {
          previousOpeningGeometry = null
          return
        }
        options.fit()
        if (sameGeometry(previousOpeningGeometry, measured)) {
          options.open()
          return
        }
        if (previousOpeningGeometry === null) {
          previousOpeningGeometry = measured
          scheduleFrame()
          return
        }
        // A changed second measurement must be followed by a real observer or
        // appearance signal. Do not poll an unusable/animating hidden surface.
        previousOpeningGeometry = null
        return
      }
      options.fit()
      if (options.isAttached()) scheduleResize()
    })
  }

  const synchronize = () => {
    previousOpeningGeometry = null
    if (frame !== null) cancelAnimationFrame(frame)
    scheduleFrame()
  }

  const resizeObserver = new ResizeObserver(synchronize)
  resizeObserver.observe(options.container)

  const dispose = () => {
    if (frame !== null) cancelAnimationFrame(frame)
    if (resizeTimer !== null) window.clearTimeout(resizeTimer)
    resizeObserver.disconnect()
  }

  return { dispose, synchronize }
}
