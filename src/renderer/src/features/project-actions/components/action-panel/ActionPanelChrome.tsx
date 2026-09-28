import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { projectName } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'

/** The parts of the panel frame that every panel mode shares. */
export interface ActionPanelChromeFrame {
  readonly titleId: string
  readonly projectPath: string
  /** Shown when the panel's project differs from the active session's project. */
  readonly otherSessionProject: string | null
  readonly onClose: () => void
}

interface ActionPanelChromeProps extends ActionPanelChromeFrame {
  readonly title: string
  readonly description: ReactNode
  readonly children: ReactNode
  readonly footer?: ReactNode
}

/**
 * The guided action panel's frame (ADR 0038). It responds to its own width through container
 * queries because the panel is resizable: tighter below 448px, roomier from 672px.
 */
export function ActionPanelChrome(props: ActionPanelChromeProps) {
  return (
    <div className="@container flex size-full min-h-0 flex-col bg-bg-secondary">
      <header className="flex shrink-0 items-start justify-between gap-4 px-8 pb-5 pt-6 @max-md:px-5 @max-md:pt-5 @2xl:px-10">
        <div className="min-w-0">
          <h2
            id={props.titleId}
            className="text-xl font-semibold tracking-tight text-text-primary @max-md:text-lg"
          >
            {props.title}
          </h2>
          <p className="mt-1 truncate text-sm text-text-tertiary" title={props.projectPath}>
            in{' '}
            <span className="font-medium text-text-secondary">
              {projectName(props.projectPath)}
            </span>
          </p>
          {props.otherSessionProject ? (
            <p className="mt-1 text-sm text-text-tertiary">
              This is for {projectName(props.projectPath)}, not the project of your current session
              ({projectName(props.otherSessionProject)}).
            </p>
          ) : null}
          <div className="mt-3 max-w-prose text-sm leading-6 text-text-tertiary">
            {props.description}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-md"
          aria-label="Close. Anything unfinished is kept."
          title="Close. Anything unfinished is kept."
          onClick={props.onClose}
        >
          <X className="size-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 gap-9 px-8 pb-10 pt-2 @max-md:gap-7 @max-md:px-5 @2xl:px-10">
          {props.children}
        </div>
      </div>
      {props.footer ? (
        <footer className="shrink-0 border-t border-border px-8 py-4 @max-md:px-5 @2xl:px-10">
          {props.footer}
        </footer>
      ) : null}
    </div>
  )
}

export function PanelQuestion(props: {
  readonly number?: number
  readonly title: string
  readonly help?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <section className="grid min-w-0 grid-cols-1 gap-3.5">
      <div>
        <h3 className="flex items-center gap-2.5 text-base font-semibold text-text-primary">
          {props.number !== undefined ? (
            <span
              aria-hidden
              className="inline-flex size-6 items-center justify-center rounded-full bg-bg-active text-xs font-semibold text-text-secondary"
            >
              {props.number}
            </span>
          ) : null}
          {props.title}
        </h3>
        {props.help ? (
          <p className="mt-1.5 text-sm leading-6 text-text-tertiary">{props.help}</p>
        ) : null}
      </div>
      {props.children}
    </section>
  )
}
