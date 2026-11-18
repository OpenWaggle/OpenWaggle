import type { CSSProperties } from 'react'
import { cn } from '@/shared/lib/cn'

export function PlainTextBlock({
  children,
  reason,
  className,
  style,
  ariaLabel,
}: {
  readonly children: string
  readonly reason: 'log' | 'error' | 'terminal' | 'prose' | 'unknown-language' | 'performance'
  readonly className?: string
  readonly style?: CSSProperties
  readonly ariaLabel?: string
}) {
  const block = (
    <pre
      data-plain-text-reason={reason}
      style={style}
      className={cn(
        'm-0 overflow-auto whitespace-pre-wrap break-words rounded-md bg-bg p-2 font-mono text-xs leading-5 text-text-secondary',
        className,
      )}
    >
      {children}
    </pre>
  )
  return ariaLabel ? <section aria-label={ariaLabel}>{block}</section> : block
}
