import type { SessionId } from '@shared/types/brand'
import type { InlineVisualizationFrameRegisterResult } from '@shared/types/inline-visualization'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'

function useNearViewport(elementRef: React.RefObject<HTMLElement | null>) {
  const [nearViewport, setNearViewport] = useState(() => !('IntersectionObserver' in window))
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return
    const element = elementRef.current
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => {
        setNearViewport(entries.some((entry) => entry.isIntersecting))
      },
      { rootMargin: '400px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [elementRef])
  return nearViewport
}

export function useInlineVisualizationRegistration(input: {
  readonly sectionRef: React.RefObject<HTMLElement | null>
  readonly sessionId: SessionId
  readonly sourcePath: string
}) {
  const nearViewport = useNearViewport(input.sectionRef)
  const [frameId, setFrameId] = useState(() => globalThis.crypto.randomUUID())
  const [registration, setRegistration] = useState<InlineVisualizationFrameRegisterResult | null>(
    null,
  )
  const [registrationError, setRegistrationError] = useState<string | null>(null)
  const [enabled, setEnabled] = useState(true)
  const releaseRegistration = useCallback(() => {
    setRegistration(null)
    setEnabled(false)
  }, [])

  useEffect(() => {
    if (!nearViewport || !enabled) return
    let active = true
    let activeRegistration: InlineVisualizationFrameRegisterResult | null = null
    setRegistration(null)
    setRegistrationError(null)
    void api
      .registerInlineVisualizationFrame({
        frameId,
        sessionId: input.sessionId,
        sourcePath: input.sourcePath,
      })
      .then((result) => {
        activeRegistration = result
        if (active) setRegistration(result)
        else {
          void api.unregisterInlineVisualizationFrame({
            frameId,
            registrationId: result.registrationId,
          })
        }
      })
      .catch((error: unknown) => {
        if (active) setRegistrationError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      active = false
      if (activeRegistration) {
        void api.unregisterInlineVisualizationFrame({
          frameId,
          registrationId: activeRegistration.registrationId,
        })
      }
    }
  }, [enabled, frameId, input.sessionId, input.sourcePath, nearViewport])

  return {
    registration: nearViewport && enabled ? registration : null,
    registrationError,
    releaseRegistration,
    retryRegistration() {
      setRegistrationError(null)
      setEnabled(true)
      setFrameId(globalThis.crypto.randomUUID())
    },
  }
}
