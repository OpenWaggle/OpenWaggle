import { type ReactNode, useEffect, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'
import { SESSION_SUMMARY_PERSISTENT_MODE } from '../model/session-summary-layout'

export interface SessionSummaryPanelSection {
  readonly id: string
  readonly label: string
  readonly content: ReactNode
}

export interface SessionSummaryExpandedPanelInput {
  readonly panelId: string
  readonly sessionId: string
  readonly sections: readonly SessionSummaryPanelSection[]
  readonly transient: boolean
}

/** A panel that mounts again this soon after unmounting was remounted, not reopened. */
const REMOUNT_WINDOW_MS = 1_000
const panelUnmountedAt = new Map<string, number>()

/**
 * Whether this mount should play the entrance animation.
 *
 * A first send renders the new Session on the index route for a few frames and then on its own
 * route, which remounts the whole chat surface. Replaying the entrance there made the Summary slide
 * in twice for every new Session; a remount keeps the panel still, a real reopen still animates.
 */
function useEntranceAnimation(sessionId: string) {
  const [animate] = useState(() => {
    const unmountedAt = panelUnmountedAt.get(sessionId)
    return unmountedAt === undefined || Date.now() - unmountedAt > REMOUNT_WINDOW_MS
  })
  useEffect(
    () => () => {
      panelUnmountedAt.set(sessionId, Date.now())
    },
    [sessionId],
  )
  return animate
}

export function SessionSummaryExpandedPanel({
  input,
}: {
  readonly input: SessionSummaryExpandedPanelInput
}) {
  const animateEntrance = useEntranceAnimation(input.sessionId)
  return (
    <div className="pointer-events-none absolute right-4 bottom-4 left-4 top-14 z-20 flex items-start justify-end">
      <aside
        id={input.panelId}
        aria-label="Session Summary"
        // The chat panel keeps its conversation clear of a persistent Summary: globals.css
        // `.session-summary-docking` matches this attribute (session-summary-layout.ts).
        data-session-summary-mode={input.transient ? 'transient' : SESSION_SUMMARY_PERSISTENT_MODE}
        data-native-preview-occluder={input.sessionId}
        className={cn(
          animateEntrance && 'session-summary-panel-enter',
          'pointer-events-auto flex max-h-full w-75 max-w-full flex-col overflow-hidden rounded-3xl border border-border-light bg-bg-secondary/95 shadow-2xl backdrop-blur motion-reduce:animate-none',
        )}
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {input.sections.map((section) => (
            <PanelErrorBoundary key={section.id} name={section.label}>
              {section.content}
            </PanelErrorBoundary>
          ))}
        </div>
      </aside>
    </div>
  )
}
