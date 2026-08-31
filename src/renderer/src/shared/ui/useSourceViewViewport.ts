import { type UIEvent, useEffect, useRef, useState } from 'react'

const SOURCE_VIEW_OVERSCAN_LINES = 30
const DEFAULT_VIEWPORT_HEIGHT_PX = 600

interface SourceViewport {
  readonly scrollTop: number
  readonly height: number
}

function visibleLineRange(viewport: SourceViewport, lineCount: number, lineHeight: number) {
  const first = Math.floor(viewport.scrollTop / lineHeight)
  const visibleCount = Math.ceil(viewport.height / lineHeight)
  return {
    start: Math.max(0, first - SOURCE_VIEW_OVERSCAN_LINES),
    end: Math.min(lineCount, first + visibleCount + SOURCE_VIEW_OVERSCAN_LINES),
  }
}

export function useSourceViewViewport({
  lineCount,
  lineHeight,
  targetLine,
}: {
  readonly lineCount: number
  readonly lineHeight: number
  readonly targetLine?: number | null
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const [viewport, setViewport] = useState<SourceViewport>({
    scrollTop: 0,
    height: DEFAULT_VIEWPORT_HEIGHT_PX,
  })

  useEffect(() => {
    if (!targetLine || !containerRef.current) return
    containerRef.current.scrollTop = Math.max(0, (targetLine - 1) * lineHeight)
  }, [lineHeight, targetLine])

  useEffect(() => {
    const container = containerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setViewport((current) => ({ ...current, height: entry.contentRect.height }))
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    },
    [],
  )

  function updateScroll(event: UIEvent<HTMLDivElement>) {
    const nextScrollTop = event.currentTarget.scrollTop
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = requestAnimationFrame(() => {
      setViewport((current) => ({ ...current, scrollTop: nextScrollTop }))
      frameRef.current = null
    })
  }

  return {
    containerRef,
    range: visibleLineRange(viewport, lineCount, lineHeight),
    updateScroll,
  }
}
