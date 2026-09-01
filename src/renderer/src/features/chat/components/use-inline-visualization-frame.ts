import type { SessionId } from '@shared/types/brand'
import type { JsonValue } from '@shared/types/json'
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

function useFrameControls(input: {
  readonly registrationId: string | null
  readonly onUnavailable: (reason: string) => void
  readonly onStateChange: (state: JsonValue | null) => void
  readonly setErrorReason: (reason: string) => void
}) {
  const healthCheckTimeoutRef = useRef<number | null>(null)
  const healthCheckIntervalRef = useRef<number | null>(null)
  const pendingStateRef = useRef<JsonValue | null | undefined>(undefined)
  const stateTimeoutRef = useRef<number | null>(null)
  const telemetryRef = useRef({ startedAt: 0, count: 0, blocked: false })
  const clearHealthCheckTimeout = useCallback(() => {
    if (healthCheckTimeoutRef.current === null) return
    window.clearTimeout(healthCheckTimeoutRef.current)
    healthCheckTimeoutRef.current = null
  }, [])
  const clearHealthCheckInterval = useCallback(() => {
    if (healthCheckIntervalRef.current === null) return
    window.clearInterval(healthCheckIntervalRef.current)
    healthCheckIntervalRef.current = null
  }, [])
  const clearPendingState = useCallback(() => {
    if (stateTimeoutRef.current !== null) window.clearTimeout(stateTimeoutRef.current)
    stateTimeoutRef.current = null
    pendingStateRef.current = undefined
  }, [])
  const flushStateChange = useCallback(() => {
    if (stateTimeoutRef.current !== null) window.clearTimeout(stateTimeoutRef.current)
    stateTimeoutRef.current = null
    const state = pendingStateRef.current
    pendingStateRef.current = undefined
    if (state !== undefined) input.onStateChange(state)
  }, [input.onStateChange])
  const scheduleStateChange = useCallback(
    (state: JsonValue | null) => {
      pendingStateRef.current = state
      if (stateTimeoutRef.current !== null) return
      stateTimeoutRef.current = window.setTimeout(flushStateChange, STATE_COALESCE_MS)
    },
    [flushStateChange],
  )
  const acceptMessage = useCallback(() => {
    const now = performance.now()
    const telemetry = telemetryRef.current
    if (now - telemetry.startedAt >= FRAME_TELEMETRY_WINDOW_MS) {
      telemetry.startedAt = now
      telemetry.count = 0
    }
    telemetry.count += 1
    if (telemetry.count <= MAX_FRAME_TELEMETRY_PER_WINDOW) return true
    if (!telemetry.blocked) {
      telemetry.blocked = true
      input.setErrorReason('resource-limit')
      input.onUnavailable('resource-limit')
    }
    return false
  }, [input.onUnavailable, input.setErrorReason])
  const armHealthCheckTimeout = useCallback(() => {
    clearHealthCheckTimeout()
    if (!input.registrationId) return
    healthCheckTimeoutRef.current = window.setTimeout(() => {
      healthCheckTimeoutRef.current = null
      input.setErrorReason('unresponsive')
      input.onUnavailable('unresponsive')
    }, FRAME_HEALTH_CHECK_TIMEOUT_MS)
  }, [clearHealthCheckTimeout, input.onUnavailable, input.registrationId, input.setErrorReason])
  return useMemo(
    () => ({
      acceptMessage,
      armHealthCheckTimeout,
      clearHealthCheckInterval,
      clearHealthCheckTimeout,
      clearPendingState,
      flushStateChange,
      healthCheckIntervalRef,
      scheduleStateChange,
      telemetryRef,
    }),
    [
      acceptMessage,
      armHealthCheckTimeout,
      clearHealthCheckInterval,
      clearHealthCheckTimeout,
      clearPendingState,
      flushStateChange,
      scheduleStateChange,
    ],
  )
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
  const controls = useFrameControls({
    registrationId: input.registrationId,
    onUnavailable: input.onUnavailable,
    onStateChange: input.onStateChange,
    setErrorReason,
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
    controls.telemetryRef.current = { startedAt: performance.now(), count: 0, blocked: false }
    controls.armHealthCheckTimeout()
    frame.src = input.frameUrl

    const frameWindow = frame.contentWindow
    if (!frameWindow) {
      setErrorReason('unresponsive')
      input.onUnavailable('unresponsive')
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
        setErrorReason: (reason) => {
          setErrorReason(reason)
          input.onUnavailable(reason)
        },
        setHeight,
        onDismiss: input.onDismiss,
        scheduleStateChange: controls.scheduleStateChange,
      })
    })
    const unsubscribeTheme = subscribeInlineVisualizationTheme(sendTheme)
    controls.healthCheckIntervalRef.current = window.setInterval(() => {
      controls.armHealthCheckTimeout()
      postToFrame({ type: 'openwaggle:inline-visualization:health-check' })
    }, FRAME_HEALTH_CHECK_INTERVAL_MS)
    return () => {
      unsubscribeFrame()
      unsubscribeTheme()
      controls.clearHealthCheckTimeout()
      controls.clearHealthCheckInterval()
      controls.clearPendingState()
      capabilityRef.current = null
      brokerPendingRef.current = false
    }
  }, [
    controls,
    input.frameUrl,
    input.onDismiss,
    input.onUnavailable,
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
