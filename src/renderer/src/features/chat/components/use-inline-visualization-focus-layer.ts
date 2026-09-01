import { useCallback, useState } from 'react'

/** Expands the existing frame surface without moving or recreating its iframe. */
export function useInlineVisualizationFocusLayer(sectionRef: React.RefObject<HTMLElement | null>) {
  const [expanded, setExpanded] = useState(false)

  const expand = useCallback(() => {
    if (sectionRef.current) setExpanded(true)
  }, [sectionRef])

  const dismiss = useCallback(() => setExpanded(false), [])

  return { expanded, expand, dismiss }
}
