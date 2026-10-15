import { useCallback, useEffect, useState } from 'react'

/** An App sizes its frame to the data it shows, within these bounds; taller content scrolls. */
const MIN_FRAME_HEIGHT = 48
export const MAX_FRAME_HEIGHT = 800
/** The height of an App that runs but never reports its size (`autoResize: false`). */
const UNSIZED_FRAME_HEIGHT = 320
/**
 * A starting App's frame is 1 px, not 0: Chromium throttles animation frames in a zero-area
 * cross-origin frame, and an App measures its size in one.
 */
const STARTING_FRAME_HEIGHT = 1
/** An App that has not finished its handshake by then is reported as not started. */
const APP_START_TIMEOUT_MS = 15_000

/**
 * Where an App is: `starting` until it finishes the MCP Apps handshake (its frame is 1 px high,
 * so a slow or broken App leaves no empty box), `running` after, `stalled` when it did not
 * within `APP_START_TIMEOUT_MS` of its resource loading.
 */
export type McpAppState = 'starting' | 'running' | 'stalled'

/** The state and frame height of an App whose resource has `loaded`, following its data. */
export function useMcpAppFrameSize(loaded: boolean) {
  const [state, setState] = useState<McpAppState>('starting')
  const [reportedHeight, setReportedHeight] = useState<number | null>(null)

  useEffect(() => {
    if (!loaded) return
    // A new frame starts over: it has not run or reported a size yet.
    setState('starting')
    setReportedHeight(null)
    const timer = setTimeout(
      () => setState((current) => (current === 'starting' ? 'stalled' : current)),
      APP_START_TIMEOUT_MS,
    )
    return () => clearTimeout(timer)
  }, [loaded])

  // Stable: the App's bridge is created once per frame from callbacks that include these.
  const onHeightChange = useCallback((height: number) => {
    setReportedHeight(Math.min(MAX_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, height)))
    setState('running')
  }, [])
  const onInitialized = useCallback(() => setState('running'), [])

  return {
    state,
    frameHeight:
      state === 'running' ? (reportedHeight ?? UNSIZED_FRAME_HEIGHT) : STARTING_FRAME_HEIGHT,
    /** The App reported the height of its content. */
    onHeightChange,
    /** The App finished its handshake. */
    onInitialized,
  }
}
