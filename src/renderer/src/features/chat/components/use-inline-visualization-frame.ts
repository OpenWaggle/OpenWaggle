import type { SessionId } from '@shared/types/brand'
import type { JsonValue } from '@shared/types/json'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import {
  subscribeInlineVisualizationFrame,
  subscribeInlineVisualizationTheme,
} from './inline-visualization-frame-bus'
import { handleInlineVisualizationFrameMessage } from './inline-visualization-frame-message'
import { hostVisualizationTheme } from './inline-visualization-host'

export const DEFAULT_VISUALIZATION_HEIGHT = 320
const FRAME_HEALTH_CHECK_TIMEOUT_MS = 2_000
const FRAME_HEALTH_CHECK_INTERVAL_MS = 5_000
const FRAME_TELEMETRY_WINDOW_MS = 1_000
const MAX_FRAME_TELEMETRY_PER_WINDOW = 120
const STATE_COALESCE_MS = 50

function customProtocolOrigin(frameUrl: string) {
  const url = new URL(frameUrl)
  return `${url.protocol}//${url.host}`
}

/** What the frame's controls read when they run: the latest render's, never one captured earlier. */
interface FrameCallbacks {
  readonly registrationId: string | null
  readonly onDismiss: () => void
  readonly onUnavailable: (reason: string) => void
  readonly onStateChange: (state: JsonValue | null) => void
}

/*
 * The frame's timers and coalescing, created once per mount (in a `useState` initializer) and
 * reading the latest callbacks, which each commit hands it (`adoptCallbacks`). Their identity
 * used to come from compiler memoization on the callbacks; the layout effect that sets `frame.src` depends on them, so a new
 * callback, or the compiler bailing out of the hook (the build runs with `panicThreshold: 'none'`),
 * reloaded the visualization on every render (PR #391 review R2 P3-10).
 */
function createFrameControls(initial: FrameCallbacks, setErrorReason: (reason: string) => void) {
  let callbacks = initial
  let healthCheckTimeout: number | null = null
  let healthCheckInterval: number | null = null
  let pendingState: JsonValue | null | undefined
  let stateTimeout: number | null = null
  const telemetry = { startedAt: 0, count: 0, blocked: false }
  const clearHealthCheckTimeout = () => {
    if (healthCheckTimeout === null) return
    window.clearTimeout(healthCheckTimeout)
    healthCheckTimeout = null
  }
  const clearHealthCheckInterval = () => {
    if (healthCheckInterval === null) return
    window.clearInterval(healthCheckInterval)
    healthCheckInterval = null
  }
  const startHealthCheckInterval = (check: () => void, intervalMs: number) => {
    clearHealthCheckInterval()
    healthCheckInterval = window.setInterval(check, intervalMs)
  }
  const resetTelemetry = () => {
    telemetry.startedAt = performance.now()
    telemetry.count = 0
    telemetry.blocked = false
  }
  const clearPendingState = () => {
    if (stateTimeout !== null) window.clearTimeout(stateTimeout)
    stateTimeout = null
    pendingState = undefined
  }
  const flushStateChange = () => {
    if (stateTimeout !== null) window.clearTimeout(stateTimeout)
    stateTimeout = null
    const state = pendingState
    pendingState = undefined
    if (state !== undefined) callbacks.onStateChange(state)
  }
  const scheduleStateChange = (state: JsonValue | null) => {
    pendingState = state
    if (stateTimeout !== null) return
    stateTimeout = window.setTimeout(flushStateChange, STATE_COALESCE_MS)
  }
  const becomeUnavailable = (reason: string) => {
    setErrorReason(reason)
    clearPendingState()
    callbacks.onUnavailable(reason)
  }
  const acceptMessage = () => {
    const now = performance.now()
    if (now - telemetry.startedAt >= FRAME_TELEMETRY_WINDOW_MS) {
      telemetry.startedAt = now
      telemetry.count = 0
    }
    telemetry.count += 1
    if (telemetry.count <= MAX_FRAME_TELEMETRY_PER_WINDOW) return true
    if (!telemetry.blocked) {
      telemetry.blocked = true
      becomeUnavailable('resource-limit')
    }
    return false
  }
  const armHealthCheckTimeout = () => {
    clearHealthCheckTimeout()
    if (!callbacks.registrationId) return
    healthCheckTimeout = window.setTimeout(() => {
      healthCheckTimeout = null
      becomeUnavailable('unresponsive')
    }, FRAME_HEALTH_CHECK_TIMEOUT_MS)
  }
  return {
    /** This commit's callbacks and registration, for everything the controls run later. */
    adoptCallbacks(next: FrameCallbacks) {
      callbacks = next
    },
    onDismiss: () => callbacks.onDismiss(),
    acceptMessage,
    armHealthCheckTimeout,
    becomeUnavailable,
    clearHealthCheckInterval,
    clearHealthCheckTimeout,
    clearPendingState,
    flushStateChange,
    resetTelemetry,
    scheduleStateChange,
    startHealthCheckInterval,
  }
}

export function useInlineVisualizationFrame(input: {
  readonly interactionSessionId: SessionId | null
  readonly frameUrl: string | null
  readonly registrationId: string | null
  readonly onDismiss: () => void
  readonly onUnavailable: (reason: string) => void
  readonly onStateChange: (state: JsonValue | null) => void
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(DEFAULT_VISUALIZATION_HEIGHT)
  const [errorReason, setErrorReason] = useState<string | null>(null)
  const capabilityRef = useRef<string | null>(null)
  const brokerPendingRef = useRef(false)
  const { registrationId, onDismiss, onUnavailable, onStateChange } = input
  // Created once, holding the latest callbacks itself: a ref passed to a function during render
  // reads to the compiler as ref access and left this hook uncompiled.
  const [controls] = useState(() =>
    createFrameControls(
      { registrationId, onDismiss, onUnavailable, onStateChange },
      setErrorReason,
    ),
  )
  // Declared before the frame's effect, so the callbacks it reads are this render's.
  useLayoutEffect(() => {
    controls.adoptCallbacks({ registrationId, onDismiss, onUnavailable, onStateChange })
  })

  const postToFrame = useCallback(
    (message: Record<string, unknown>) => {
      if (!input.frameUrl) return
      frameRef.current?.contentWindow?.postMessage(message, customProtocolOrigin(input.frameUrl))
    },
    [input.frameUrl],
  )

  const sendTheme = useCallback(() => {
    postToFrame({
      type: 'openwaggle:inline-visualization:theme',
      theme: hostVisualizationTheme(),
    })
  }, [postToFrame])

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame || !input.frameUrl || !input.registrationId) return
    controls.clearHealthCheckTimeout()
    controls.clearHealthCheckInterval()
    capabilityRef.current = null
    brokerPendingRef.current = false
    controls.resetTelemetry()
    controls.armHealthCheckTimeout()
    frame.src = input.frameUrl

    const frameWindow = frame.contentWindow
    if (!frameWindow) {
      controls.becomeUnavailable('unresponsive')
      return controls.clearHealthCheckTimeout
    }
    const origin = customProtocolOrigin(input.frameUrl)
    const unsubscribeFrame = subscribeInlineVisualizationFrame(frameWindow, origin, (event) => {
      handleInlineVisualizationFrameMessage(event.data, {
        acceptMessage: controls.acceptMessage,
        interactionSessionId: input.interactionSessionId,
        capability: capabilityRef,
        brokerPending: brokerPendingRef,
        clearHealthCheckTimeout: controls.clearHealthCheckTimeout,
        flushStateChange: controls.flushStateChange,
        sendTheme,
        postToFrame,
        setErrorReason: controls.becomeUnavailable,
        setHeight,
        onDismiss: controls.onDismiss,
        scheduleStateChange: controls.scheduleStateChange,
      })
    })
    const unsubscribeTheme = subscribeInlineVisualizationTheme(sendTheme)
    controls.startHealthCheckInterval(() => {
      controls.armHealthCheckTimeout()
      postToFrame({ type: 'openwaggle:inline-visualization:health-check' })
    }, FRAME_HEALTH_CHECK_INTERVAL_MS)
    return () => {
      unsubscribeFrame()
      unsubscribeTheme()
      controls.clearHealthCheckTimeout()
      controls.clearHealthCheckInterval()
      controls.flushStateChange()
      capabilityRef.current = null
      brokerPendingRef.current = false
    }
  }, [
    controls,
    input.frameUrl,
    input.registrationId,
    input.interactionSessionId,
    postToFrame,
    sendTheme,
  ])

  const handleLoad = () => {
    controls.armHealthCheckTimeout()
    postToFrame({ type: 'openwaggle:inline-visualization:health-check' })
  }

  const reset = () => {
    controls.clearPendingState()
    setHeight(DEFAULT_VISUALIZATION_HEIGHT)
    setErrorReason(null)
    capabilityRef.current = null
  }

  return { frameRef, height, errorReason, handleLoad, reset }
}
