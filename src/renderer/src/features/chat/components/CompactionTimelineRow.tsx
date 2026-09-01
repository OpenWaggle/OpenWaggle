import { ListCollapse } from 'lucide-react'

export type CompactionTimelineState =
  | 'manual-running'
  | 'manual-complete'
  | 'automatic-running'
  | 'automatic-complete'
  | 'legacy-complete'

interface CompactionTimelineRowProps {
  readonly state: CompactionTimelineState
  readonly accessible?: boolean
}

const COMPACTION_ICON_STROKE_WIDTH = 1.5

export function compactionTimelineLabel(state: CompactionTimelineState) {
  if (state === 'manual-running') return 'Compacting context'
  if (state === 'manual-complete') return 'Context compacted'
  if (state === 'automatic-running') return 'Context automatically compacting'
  if (state === 'automatic-complete') return 'Context automatically compacted'
  return 'Context compacted'
}

export function CompactionTimelineRow({ state, accessible = false }: CompactionTimelineRowProps) {
  const running = state.endsWith('-running')

  return (
    <div
      aria-hidden={accessible ? undefined : true}
      aria-live={accessible ? 'off' : undefined}
      className="flex min-h-5 items-center gap-2 text-xs text-text-tertiary"
      data-compaction-timeline-state={state}
    >
      <ListCollapse
        className="size-4 shrink-0 text-text-muted"
        strokeWidth={COMPACTION_ICON_STROKE_WIDTH}
      />
      <span className={running ? 'compaction-shimmer font-medium' : undefined}>
        {compactionTimelineLabel(state)}
      </span>
    </div>
  )
}
