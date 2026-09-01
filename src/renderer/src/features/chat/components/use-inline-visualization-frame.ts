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

function customProtocolOrigin(frameUrl: string) {
  const url = new URL(frameUrl)
  return `${url.protocol}//${url.host}`
}

export function useInlineVisualizationFrame(input: {
  readonly sessionId: SessionId
  readonly frameUrl: string | null
  readonly onDismiss: () => void
}) {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [height, setHeight] = useState(DEFAULT_VISUALIZATION_HEIGHT)
  const [errorReason, setErrorReason] = useState<string | null>(null)
  const healthCheckTimeoutRef = useRef<number | null>(null)
  const capabilityRef = useRef<string | null>(null)
  const brokerPendingRef = useRef(false)

  const clearHealthCheckTimeout = useCallback(() => {
    if (healthCheckTimeoutRef.current === null) return
    window.clearTimeout(healthCheckTimeoutRef.current)
    healthCheckTimeoutRef.current = null
  }, [])

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

  useEffect(() => {
    const frameWindow = frameRef.current?.contentWindow
    if (!frameWindow || !input.frameUrl) return
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
    return () => {
      unsubscribeFrame()
      unsubscribeTheme()
      clearHealthCheckTimeout()
      capabilityRef.current = null
      brokerPendingRef.current = false
    }
  }, [
    clearHealthCheckTimeout,
    input.frameUrl,
    input.onDismiss,
    input.sessionId,
    postToFrame,
    sendTheme,
  ])

  const handleLoad = () => {
    clearHealthCheckTimeout()
    capabilityRef.current = null
    postToFrame({ type: 'openwaggle:inline-visualization:health-check' })
    healthCheckTimeoutRef.current = window.setTimeout(() => {
      setErrorReason('unresponsive')
      healthCheckTimeoutRef.current = null
    }, FRAME_HEALTH_CHECK_TIMEOUT_MS)
  }

  const reset = () => {
    setHeight(DEFAULT_VISUALIZATION_HEIGHT)
    setErrorReason(null)
    capabilityRef.current = null
  }

  return { frameRef, height, errorReason, handleLoad, reset }
}
