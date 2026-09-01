import type { SessionId } from '@shared/types/brand'
import type { InlineVisualizationFrameRegisterResult } from '@shared/types/inline-visualization'
import { useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'

function useNearViewport(elementRef: React.RefObject<HTMLElement | null>) {
  const [nearViewport, setNearViewport] = useState(() => !('IntersectionObserver' in window))
  useEffect(() => {
    if (nearViewport || !('IntersectionObserver' in window)) return
    const element = elementRef.current
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNearViewport(true)
          observer.disconnect()
        }
      },
      { rootMargin: '400px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [elementRef, nearViewport])
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

  useEffect(() => {
    if (!nearViewport) return
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
  }, [frameId, input.sessionId, input.sourcePath, nearViewport])

  return {
    registration,
    registrationError,
    retryRegistration() {
      setRegistrationError(null)
      setFrameId(globalThis.crypto.randomUUID())
    },
  }
}
