import { AlertTriangle } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface WarningCalloutProps {
  children: ReactNode
  className?: string
  contentClassName?: string
  iconClassName?: string
}

export function WarningCallout({
  children,
  className,
  contentClassName,
  iconClassName,
}: WarningCalloutProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/6 px-3 py-2',
        className,
      )}
    >
      <AlertTriangle className={cn('h-3.5 w-3.5 shrink-0 text-warning mt-0.5', iconClassName)} />
      <div className={cn('text-[12px] leading-relaxed text-warning/80', contentClassName)}>
        {children}
      </div>
    </div>
  )
}
