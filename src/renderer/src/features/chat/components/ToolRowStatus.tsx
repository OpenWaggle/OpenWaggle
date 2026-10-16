import { X } from 'lucide-react'
import type { ToolKind } from '@/features/chat/lib/tool-kind'
import { cn } from '@/shared/lib/cn'
import { ToolKindIcon } from './ToolKindIcon'

/**
 * Where a tool row's call stands. A row shows its kind's icon whatever the status, as T3 Code's
 * work log does: running shimmers the label, and failed tints the icon and adds a trailing mark.
 * A finished call needs no mark of its own.
 */
export type ToolRowStatus = 'running' | 'done' | 'failed' | 'requested'

type ToolRowSize = 'sm' | 'md'

const ICON_SIZE: Record<ToolRowSize, string> = { sm: 'size-3', md: 'size-3.5' }

const ICON_TONE: Record<ToolRowStatus, string> = {
  running: 'text-text-tertiary',
  done: 'text-text-muted',
  failed: 'text-error/80',
  requested: 'text-text-muted',
}

const LABEL_TONE: Record<ToolRowStatus, string> = {
  running: 'activity-shimmer',
  done: 'text-text-muted',
  failed: 'text-text-muted',
  requested: '',
}

export function toolRowLabelClassName(status: ToolRowStatus) {
  return LABEL_TONE[status]
}

export function ToolRowIcon({
  kind,
  status,
  size = 'md',
}: {
  readonly kind: ToolKind
  readonly status: ToolRowStatus
  readonly size?: ToolRowSize
}) {
  const icon = (
    <ToolKindIcon kind={kind} className={cn(ICON_SIZE[size], 'shrink-0', ICON_TONE[status])} />
  )
  if (status !== 'running') return icon
  return (
    <span role="status" aria-label="Running" className="inline-flex shrink-0">
      {icon}
    </span>
  )
}

/** The trailing mark of a failed or cancelled call. */
export function ToolRowFailureMark({ label = 'Failed' }: { readonly label?: string }) {
  return <X role="img" aria-label={label} className="size-3 shrink-0 text-error/80" />
}
