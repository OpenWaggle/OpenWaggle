import type { ReactNode } from 'react'
import { PanelErrorBoundary } from '@/shared/ui/PanelErrorBoundary'

export interface SessionSummaryPanelSection {
  readonly id: string
  readonly label: string
  readonly content: ReactNode
}

export interface SessionSummaryExpandedPanelInput {
  readonly panelId: string
  readonly sections: readonly SessionSummaryPanelSection[]
  readonly transient: boolean
}

export function SessionSummaryExpandedPanel({
  input,
}: {
  readonly input: SessionSummaryExpandedPanelInput
}) {
  return (
    <div className="pointer-events-none absolute right-4 bottom-4 left-4 top-14 z-20 flex items-start justify-end">
      <aside
        id={input.panelId}
        aria-label="Session Summary"
        data-session-summary-mode={input.transient ? 'transient' : 'persistent'}
        className="session-summary-panel-enter pointer-events-auto flex max-h-full w-75 max-w-full flex-col overflow-hidden rounded-3xl border border-border-light bg-bg-secondary/95 shadow-2xl backdrop-blur motion-reduce:animate-none"
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
