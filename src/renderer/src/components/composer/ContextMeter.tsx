import { cn } from '@/lib/cn'
import { formatTokens } from '@/lib/format-tokens'
import { useChatStore } from '@/stores/chat-store'
import { selectCompaction, useCompactionStore } from '@/stores/compaction-store'
import { selectPercentUsed, useContextStore } from '@/stores/context-store'
import { useUIStore } from '@/stores/ui-store'

const PERCENT_MAX = 100
const METER_SIZE = 30
const STROKE_WIDTH = 2
const HALF = 2
const RADIUS = (METER_SIZE - STROKE_WIDTH) / HALF
const CIRCUMFERENCE = HALF * Math.PI * RADIUS
const CENTER = METER_SIZE / HALF
const VIEWBOX_SIZE = METER_SIZE

const HEALTH_COLORS: Record<string, string> = {
  comfortable: 'var(--color-success)',
  tight: 'var(--color-warning)',
  critical: 'var(--color-warning)',
  blocked: 'var(--color-error)',
}

function getHealthColor(health: string | null): string {
  if (!health) return 'var(--color-text-muted)'
  return HEALTH_COLORS[health] ?? 'var(--color-text-muted)'
}

export function ContextMeter() {
  const percentUsed = useContextStore(selectPercentUsed)
  const healthStatus = useContextStore((s) => s.snapshot?.healthStatus ?? null)
  const isManualCompacting = useContextStore((s) => s.isCompacting)
  const hasData = useContextStore((s) => s.snapshot !== null)
  const usedTokens = useContextStore((s) => s.snapshot?.usedTokens ?? 0)
  const contextWindow = useContextStore((s) => s.snapshot?.contextWindow ?? 0)
  const activeInspector = useUIStore((s) => s.activeInspector)
  const toggleInspector = useUIStore((s) => s.toggleInspector)
  const conversationId = useChatStore((s) => s.activeConversationId)
  const autoCompactionStatus = useCompactionStore(selectCompaction(conversationId))
  const isAutoCompacting =
    autoCompactionStatus?.stage === 'starting' || autoCompactionStatus?.stage === 'summarizing'
  const isCompacting = isManualCompacting || isAutoCompacting

  const isActive = activeInspector === 'context'
  const normalizedPercent = Math.max(0, Math.min(PERCENT_MAX, percentUsed))
  const dashOffset = CIRCUMFERENCE - (normalizedPercent / PERCENT_MAX) * CIRCUMFERENCE
  const strokeColor = hasData ? getHealthColor(healthStatus) : 'var(--color-text-muted)'

  function handleClick() {
    toggleInspector('context')
  }

  const tooltipText = hasData
    ? `Context: ${formatTokens(usedTokens)} / ${formatTokens(contextWindow)} tokens (${String(normalizedPercent)}%)`
    : 'Context usage'

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'relative flex items-center justify-center rounded-full transition-all',
        isActive ? 'bg-bg-hover ring-1 ring-accent/30' : 'hover:bg-bg-hover/60',
        isCompacting && 'animate-pulse',
      )}
      style={{ width: METER_SIZE, height: METER_SIZE }}
      title={tooltipText}
    >
      <svg
        width={METER_SIZE}
        height={METER_SIZE}
        viewBox={`0 0 ${String(VIEWBOX_SIZE)} ${String(VIEWBOX_SIZE)}`}
        className="-rotate-90"
        role="img"
        aria-label="Context usage meter"
      >
        <title>Context usage meter</title>
        {/* Background track */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke="color-mix(in oklab, var(--color-text-muted) 18%, transparent)"
          strokeWidth={STROKE_WIDTH}
        />
        {/* Progress arc */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke={strokeColor}
          strokeWidth={STROKE_WIDTH}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
        />
      </svg>
      {/* Center value */}
      <span
        className="absolute font-mono text-[9px] font-semibold leading-none tabular-nums"
        style={{ color: strokeColor }}
      >
        {normalizedPercent}
      </span>
    </button>
  )
}
