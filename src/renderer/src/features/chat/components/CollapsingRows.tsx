import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'

const COLLAPSE_DURATION_MS = 180
/** A little longer than the transition, in case `transitionend` never arrives. */
const COLLAPSE_FALLBACK_MS = COLLAPSE_DURATION_MS + 80

/**
 * Rows that just left the transcript, collapsing to nothing (ADR 0036).
 *
 * Rendered in place of a settling turn's folded work while the reader follows the live end, so the
 * change reads as a collapse rather than a jump. Display only: not addressable as a row, hidden
 * from assistive technology, and inert.
 */
export function CollapsingRows({
  children,
  onDone,
}: {
  readonly children: ReactNode
  readonly onDone: () => void
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  const onDoneRef = useRef(onDone)
  useLayoutEffect(() => {
    onDoneRef.current = onDone
  })

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = `${String(element.scrollHeight)}px`
    // Force the start height to apply before the transition to zero begins.
    element.getBoundingClientRect()
    setHeight(0)
    const fallback = setTimeout(() => onDoneRef.current(), COLLAPSE_FALLBACK_MS)
    return () => clearTimeout(fallback)
  }, [])

  return (
    <div
      ref={ref}
      aria-hidden="true"
      inert
      className="overflow-hidden opacity-100 transition-[height,opacity] duration-[180ms] ease-out motion-reduce:transition-none"
      style={height === null ? undefined : { height, opacity: 0 }}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget && event.propertyName === 'height')
          onDoneRef.current()
      }}
    >
      {children}
    </div>
  )
}
