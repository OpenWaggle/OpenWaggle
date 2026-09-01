import type { SessionId } from '@shared/types/brand'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  subscribeInlineVisualizationFrame,
  subscribeInlineVisualizationTheme,
} from './inline-visualization-frame-bus'
import { handleInlineVisualizationFrameMessage } from './inline-visualization-frame-message'
import { hostVisualizationTheme } from './inline-visualization-host'

export const DEFAULT_VISUALIZATION_HEIGHT = 320
const FRAME_HEALTH_CHECK_TIMEOUT_MS = 2_000
const FRAME_HEALTH_CHECK_INTERVAL_MS = 5_000

function customProtocolOrigin(frameUrl: string) {
  const url = new URL(frameUrl)
  return `${url.protocol}//${url.host}`
}

export function useInlineVisualizationFrame(input: {
  readonly sessionId: SessionId
  readonly frameUrl: string | null
  readonly registrationId: string | null
  readonly onDismiss: () => void
}) {
  const frameElementRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(DEFAULT_VISUALIZATION_HEIGHT)
  const [errorReason, setErrorReason] = useState<string | null>(null)
  const healthCheckTimeoutRef = useRef<number | null>(null)
  const healthCheckIntervalRef = useRef<number | null>(null)
  const capabilityRef = useRef<string | null>(null)
  const brokerPendingRef = useRef(false)

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

  const postToFrame = useCallback(
    (message: Record<string, unknown>) => {
      if (!input.frameUrl) return
      frameElementRef.current?.contentWindow?.postMessage(
        message,
        customProtocolOrigin(input.frameUrl),
      )
    },
    [input.frameUrl],
  )

  const sendTheme = useCallback(() => {
    postToFrame({
      type: 'openwaggle:inline-visualization:theme',
      theme: hostVisualizationTheme(),
    })
  }, [postToFrame])

  const armHealthCheckTimeout = useCallback(() => {
    clearHealthCheckTimeout()
    if (!input.registrationId) return
    healthCheckTimeoutRef.current = window.setTimeout(() => {
      healthCheckTimeoutRef.current = null
      setErrorReason('unresponsive')
    }, FRAME_HEALTH_CHECK_TIMEOUT_MS)
  }, [clearHealthCheckTimeout, input.registrationId])

  const frameRef = useCallback(
    (frame: HTMLIFrameElement | null) => {
      frameElementRef.current = frame
      clearHealthCheckTimeout()
      if (!frame || !input.frameUrl || !input.registrationId) return

      armHealthCheckTimeout()
      frame.src = input.frameUrl
    },
    [armHealthCheckTimeout, clearHealthCheckTimeout, input.frameUrl, input.registrationId],
  )

  useEffect(() => {
    const frameWindow = frameElementRef.current?.contentWindow
    if (!frameWindow || !input.frameUrl || !input.registrationId) return
    capabilityRef.current = null
    const origin = customProtocolOrigin(input.frameUrl)
    const unsubscribeFrame = subscribeInlineVisualizationFrame(frameWindow, origin, (event) => {
      handleInlineVisualizationFrameMessage(event.data, {
        sessionId: input.sessionId,
        capability: capabilityRef,
        brokerPending: brokerPendingRef,
        clearHealthCheckTimeout,
        sendTheme,
        postToFrame,
        setErrorReason,
        setHeight,
        onDismiss: input.onDismiss,
      })
    })
    const unsubscribeTheme = subscribeInlineVisualizationTheme(sendTheme)
    clearHealthCheckInterval()
    healthCheckIntervalRef.current = window.setInterval(() => {
      armHealthCheckTimeout()
      postToFrame({ type: 'openwaggle:inline-visualization:health-check' })
    }, FRAME_HEALTH_CHECK_INTERVAL_MS)
    return () => {
      unsubscribeFrame()
      unsubscribeTheme()
      clearHealthCheckTimeout()
      clearHealthCheckInterval()
      capabilityRef.current = null
      brokerPendingRef.current = false
    }
  }, [
    armHealthCheckTimeout,
    clearHealthCheckInterval,
    clearHealthCheckTimeout,
    input.frameUrl,
    input.onDismiss,
    input.registrationId,
    input.sessionId,
    postToFrame,
    sendTheme,
  ])

  const handleLoad = () => {
    capabilityRef.current = null
    armHealthCheckTimeout()
    postToFrame({ type: 'openwaggle:inline-visualization:health-check' })
  }

  const reset = () => {
    setHeight(DEFAULT_VISUALIZATION_HEIGHT)
    setErrorReason(null)
    capabilityRef.current = null
  }

  return { frameRef, height, errorReason, handleLoad, reset }
}
