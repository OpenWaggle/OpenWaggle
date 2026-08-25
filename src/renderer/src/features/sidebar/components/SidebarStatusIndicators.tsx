import { AlertTriangle } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { SESSION_STATUS_ICON } from '../hooks/useSessionRowStatus'
import {
  type SidebarRowState,
  type SidebarStateCount,
  sidebarRowStateIcon,
  sidebarRowStateMeta,
} from '../lib/sidebar-row-state'

function StateIcon({
  state,
  className,
}: {
  readonly state: SidebarRowState
  readonly className?: string
}) {
  const iconName = sidebarRowStateIcon(state)
  if (iconName === null) return null
  const Icon = iconName === 'AlertTriangle' ? AlertTriangle : SESSION_STATUS_ICON[iconName]
  if (Icon === undefined) return null
  return <Icon className={className} />
}

/**
 * Filter chips across the whole tree.
 *
 * They exist so a state can be reached without hunting through projects: one click isolates
 * every failing session wherever it lives. A chip only appears when something is in that
 * state, so the row is a summary of what is actually happening rather than a fixed toolbar.
 */
export function SidebarStatusChips({
  counts,
  activeState,
  onToggle,
}: {
  readonly counts: readonly SidebarStateCount[]
  readonly activeState: SidebarRowState | null
  readonly onToggle: (state: SidebarRowState) => void
}) {
  /*
   * An active filter keeps its chip even when nothing is in that state any more.
   *
   * Chips are otherwise a summary of what is happening, so a state with no sessions has no chip.
   * That left a trap: opening the only completed session marks it visited, which reads as idle, so
   * the completed chip vanished while its filter stayed set. Every row was filtered out and the
   * only control that could clear the filter had just disappeared, leaving an empty sidebar with no
   * way back. The zero keeps the reason for the emptiness on screen and stays clickable.
   */
  const shown =
    activeState !== null && !counts.some(({ state }) => state === activeState)
      ? [...counts, { state: activeState, count: 0 }]
      : counts

  if (shown.length === 0) return null

  return (
    <fieldset
      aria-label="Filter sessions by state"
      data-qa="sidebar-chips"
      className="flex flex-none flex-wrap gap-1 px-2.5 pt-0.5 pb-2"
    >
      {shown.map(({ state, count }) => {
        const meta = sidebarRowStateMeta(state)
        const isActive = activeState === state
        /*
         * Two variables, not one. The tint and the border come from the role; the text comes from
         * the label role, because a chip tints its own background from the same hue and painting
         * text with the icon colour measured 3.76:1 on the active chip.
         */
        const chipStyle: React.CSSProperties & {
          '--chip': string
          '--chip-text': string
        } = { '--chip': meta.colorVar, '--chip-text': meta.labelColorVar }

        return (
          <Button
            key={state}
            variant="unstyled"
            type="button"
            aria-pressed={isActive}
            aria-label={`${isActive ? 'Clear filter' : 'Show only'}: ${meta.label}, ${String(count)}`}
            onClick={() => onToggle(state)}
            data-qa="sidebar-chip"
            style={chipStyle}
            className={cn(
              'flex h-6 items-center gap-1.5 rounded-full border px-2.5 font-semibold text-xs transition-colors',
              isActive
                ? 'border-[color-mix(in_srgb,var(--chip)_60%,transparent)] bg-[color-mix(in_srgb,var(--chip)_16%,transparent)] text-(--chip-text)'
                : 'border-border-light bg-bg text-text-tertiary hover:border-text-muted hover:text-text-primary',
            )}
          >
            <StateIcon state={state} className="size-2.5" />
            {meta.shortLabel}
            <span className="tabular-nums opacity-80">{count}</span>
          </Button>
        )
      })}
    </fieldset>
  )
}

/**
 * A project heading's roll-up.
 *
 * Answers "is there anything in here for me" without expanding the project, which is the
 * whole point of being able to collapse one. Colour is paired with a count and an accessible
 * name, never used alone.
 */
export function SidebarProjectStatusPips({
  counts,
}: {
  readonly counts: readonly SidebarStateCount[]
}) {
  if (counts.length === 0) return null

  return (
    <span className="flex flex-none items-center gap-1">
      {counts.map(({ state, count }) => {
        const meta = sidebarRowStateMeta(state)
        const pipStyle: React.CSSProperties & {
          '--pip': string
          '--pip-text': string
        } = { '--pip': meta.colorVar, '--pip-text': meta.labelColorVar }

        return (
          <span
            key={state}
            role="img"
            aria-label={`${meta.label}: ${String(count)}`}
            title={`${meta.label}: ${String(count)}`}
            data-qa="sidebar-pip"
            style={pipStyle}
            className="flex items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--pip)_45%,transparent)] bg-[color-mix(in_srgb,var(--pip)_18%,transparent)] py-px pr-1.5 pl-1 font-bold text-xs text-(--pip-text)"
          >
            <span className="grid size-2.5 place-items-center">
              <StateIcon state={state} className="size-2.5" />
            </span>
            <span className="tabular-nums">{count}</span>
          </span>
        )
      })}
    </span>
  )
}
