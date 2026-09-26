import { useLayoutEffect, useRef, useState } from 'react'

/** Rows load about one viewport before the reader reaches an edge (ADR 0036). */
const EDGE_ROOT_MARGIN = '100% 0px'

interface UseTranscriptEdgeLoadingInput {
  /** Holds the scroller element once mounted; stable for the component's lifetime. */
  readonly viewport: { readonly scroller: HTMLElement | null }
  readonly loadEarlier: () => void
  readonly loadLater: () => void
}

/**
 * Loads rows automatically as the reader nears either edge of the window.
 *
 * Edge elements are keyed by the window range, so each load mounts a fresh edge and a fresh
 * observer. A new observer reports the edge's current intersection, so a batch that did not fill
 * the viewport triggers the next one without the reader having to scroll again.
 */
export function useTranscriptEdgeLoading({
  viewport,
  loadEarlier,
  loadLater,
}: UseTranscriptEdgeLoadingInput) {
  const [earlierEdge, setEarlierEdge] = useState<HTMLElement | null>(null)
  const [laterEdge, setLaterEdge] = useState<HTMLElement | null>(null)
  const actionsRef = useRef({ loadEarlier, loadLater })
  useLayoutEffect(() => {
    actionsRef.current = { loadEarlier, loadLater }
  })

  useLayoutEffect(() => {
    const root = viewport.scroller
    if (!root || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          if (entry.target === earlierEdge) actionsRef.current.loadEarlier()
          if (entry.target === laterEdge) actionsRef.current.loadLater()
        }
      },
      { root, rootMargin: EDGE_ROOT_MARGIN },
    )
    if (earlierEdge) observer.observe(earlierEdge)
    if (laterEdge) observer.observe(laterEdge)
    return () => observer.disconnect()
  }, [viewport, earlierEdge, laterEdge])

  return { earlierRef: setEarlierEdge, laterRef: setLaterEdge }
}
