import type { SessionId } from '@shared/types/brand'
import type { InlineVisualizationFrameRegisterResult } from '@shared/types/inline-visualization'
import { useCallback, useEffect, useState } from 'react'
import { api } from '@/shared/lib/ipc'
import { retainedInlineVisualizationState } from '../state/inline-visualization-state'

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
  /** A frame the user engaged stays loaded off-screen, so its local DOM state survives. */
  readonly pinned?: boolean
}) {
  const nearViewport = useNearViewport(input.sectionRef)
  const wanted = nearViewport || input.pinned === true
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
    if (!wanted || !enabled) return
    let active = true
    let activeRegistration: InlineVisualizationFrameRegisterResult | null = null
    setRegistration(null)
    setRegistrationError(null)
    void api
      .registerInlineVisualizationFrame({
        frameId,
        reducedMotion: document.documentElement.dataset.motion === 'reduced',
        sessionId: input.sessionId,
        sourcePath: input.sourcePath,
        // A parked or remounted frame reloads from its document; restore what the user last chose.
        restoredState: retainedInlineVisualizationState(input.sessionId, input.sourcePath),
      })
      .then((result) => {
        activeRegistration = result
        if (active) setRegistration(result)
        else {
          void api
            .unregisterInlineVisualizationFrame({
              frameId,
              registrationId: result.registrationId,
            })
            .catch(() => undefined)
        }
      })
      .catch((error: unknown) => {
        if (active) setRegistrationError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      active = false
      if (activeRegistration) {
        void api
          .unregisterInlineVisualizationFrame({
            frameId,
            registrationId: activeRegistration.registrationId,
          })
          .catch(() => undefined)
      }
    }
  }, [enabled, frameId, input.sessionId, input.sourcePath, wanted])

  return {
    registration: wanted && enabled ? registration : null,
    registrationError,
    releaseRegistration,
    retryRegistration() {
      setRegistrationError(null)
      setEnabled(true)
      setFrameId(globalThis.crypto.randomUUID())
    },
  }
}
