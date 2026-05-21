import { cn } from '@/shared/lib/cn'
import { CONTEXT_METER } from '../constants'

interface ContextMeterRingProps {
  readonly displayValue: string
  readonly strokeColor: string
  readonly dashOffset: number
  readonly failed: boolean
}

export function ContextMeterRing({
  displayValue,
  strokeColor,
  dashOffset,
  failed,
}: ContextMeterRingProps) {
  return (
    <div
      className={cn(
        'relative flex shrink-0 items-center justify-center rounded-full',
        'text-text-tertiary',
      )}
      style={{ width: CONTEXT_METER.GEOMETRY.SIZE, height: CONTEXT_METER.GEOMETRY.SIZE }}
    >
      <svg
        width={CONTEXT_METER.GEOMETRY.SIZE}
        height={CONTEXT_METER.GEOMETRY.SIZE}
        viewBox={`0 0 ${String(CONTEXT_METER.GEOMETRY.VIEWBOX_SIZE)} ${String(CONTEXT_METER.GEOMETRY.VIEWBOX_SIZE)}`}
        className="-rotate-90"
        role="img"
        aria-label={failed ? 'Context usage unavailable' : 'Context usage meter'}
      >
        <title>Context usage meter</title>
        <circle
          cx={CONTEXT_METER.GEOMETRY.CENTER}
          cy={CONTEXT_METER.GEOMETRY.CENTER}
          r={CONTEXT_METER.GEOMETRY.RADIUS}
          fill="none"
          stroke="color-mix(in oklab, var(--color-text-muted) 18%, transparent)"
          strokeWidth={CONTEXT_METER.GEOMETRY.STROKE_WIDTH}
        />
        <circle
          cx={CONTEXT_METER.GEOMETRY.CENTER}
          cy={CONTEXT_METER.GEOMETRY.CENTER}
          r={CONTEXT_METER.GEOMETRY.RADIUS}
          fill="none"
          stroke={strokeColor}
          strokeWidth={CONTEXT_METER.GEOMETRY.STROKE_WIDTH}
          strokeDasharray={CONTEXT_METER.GEOMETRY.CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
        />
      </svg>
      <span
        className="absolute font-mono text-[8.5px] font-semibold leading-none tabular-nums"
        style={{ color: strokeColor }}
      >
        {displayValue}
      </span>
    </div>
  )
}
