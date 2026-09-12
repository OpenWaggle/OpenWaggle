import { TERMINAL } from '@shared/constants/resource-limits'
import type { TerminalPortPreview } from '@shared/types/terminal'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import type { TerminalPaneStatus } from '../hooks/terminal-pane-session-model'

const OVERLAY_BACKDROP =
  'absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-bg/85 text-center'

interface OriginalCheckoutBannerProps {
  readonly cwd: string
  readonly restarting: boolean
  readonly onRestart: () => void
}

export function OriginalCheckoutBanner(props: OriginalCheckoutBannerProps) {
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex h-7 items-center gap-2 border-b border-border bg-bg-secondary px-2 text-xs text-text-tertiary">
      <span className="font-medium text-warning">Original checkout</span>
      <span className="min-w-0 truncate" title={props.cwd}>
        {props.cwd}
      </span>
      <Button
        size="xs"
        variant="ghost"
        className="ml-auto shrink-0"
        disabled={props.restarting}
        onClick={props.onRestart}
      >
        {props.restarting ? 'Restarting…' : 'Restart in worktree'}
      </Button>
    </div>
  )
}

interface TerminalStatusModel {
  readonly cwd: string
  readonly errorMessage: string | null
  readonly exitCode: number | undefined
  readonly inputError: string | null
  readonly inputWaiting: boolean
  readonly status: TerminalPaneStatus
}

interface TerminalStatusActions {
  readonly onRestart: () => void
  readonly onSendInputNow: () => void
}

export function TerminalStatusLayers(props: {
  readonly model: TerminalStatusModel
  readonly actions: TerminalStatusActions
}) {
  const { model } = props
  if (model.status === 'cwd-missing') {
    return (
      <div className={OVERLAY_BACKDROP}>
        <p className="text-sm font-medium text-text-primary">Working path no longer exists</p>
        <p className="max-w-full truncate px-6 text-xs text-text-muted">{model.cwd}</p>
        <Button size="xs" variant="secondary" onClick={props.actions.onRestart}>
          Retry
        </Button>
      </div>
    )
  }
  if (model.status === 'error') {
    return (
      <div className={OVERLAY_BACKDROP}>
        <p className="text-sm text-error">{model.errorMessage ?? 'Terminal error'}</p>
        <Button size="xs" variant="secondary" onClick={props.actions.onRestart}>
          Retry
        </Button>
      </div>
    )
  }
  if (model.status === 'stopped') {
    return (
      <div className={OVERLAY_BACKDROP} role="status" aria-live="polite">
        <p className="text-sm text-text-secondary">Shell stopped</p>
        <Button size="xs" variant="secondary" onClick={props.actions.onRestart}>
          Restart
        </Button>
      </div>
    )
  }
  if (model.exitCode !== undefined) {
    return <TerminalExitStatus exitCode={model.exitCode} onRestart={props.actions.onRestart} />
  }
  if (!model.inputWaiting && model.inputError === null) return null
  return (
    <TerminalInputStatus
      error={model.inputError}
      waiting={model.inputWaiting}
      onSendNow={props.actions.onSendInputNow}
    />
  )
}

function TerminalExitStatus(props: { readonly exitCode: number; readonly onRestart: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-x-2 bottom-1 z-10 flex items-center justify-between rounded border border-border bg-bg-hover px-2 py-1"
    >
      <span className="text-xs text-text-tertiary">
        Shell exited{props.exitCode !== 0 ? ` (code ${props.exitCode})` : ''}
      </span>
      <Button size="xs" variant="secondary" onClick={props.onRestart}>
        Restart
      </Button>
    </div>
  )
}

interface TerminalInputStatusProps {
  readonly error: string | null
  readonly waiting: boolean
  readonly onSendNow: () => void
}

function TerminalInputStatus(props: TerminalInputStatusProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute inset-x-2 bottom-1 z-10 flex items-center justify-between gap-2 rounded border border-warning/40 bg-bg-hover px-2 py-1"
    >
      <span className="min-w-0 truncate text-xs text-text-secondary">
        {props.error ?? 'Input waiting for shell readiness'}
      </span>
      {props.waiting && (
        <Button size="xs" variant="secondary" onClick={props.onSendNow}>
          Send now
        </Button>
      )}
    </div>
  )
}

interface TerminalPortPreviewsProps {
  readonly ports: readonly TerminalPortPreview[] | undefined
  readonly runsInOriginalCheckout: boolean
  readonly onOpen: (url: string) => void
}

export function TerminalPortPreviews(props: TerminalPortPreviewsProps) {
  if (props.ports === undefined || props.ports.length === 0) return null
  return (
    <div
      className={cn(
        'absolute right-2 z-10 flex gap-1',
        props.runsInOriginalCheckout ? 'top-8' : 'top-1',
      )}
    >
      {props.ports.slice(0, TERMINAL.MAX_PORT_PREVIEWS_SHOWN).map((preview) => (
        <Button
          key={preview.url}
          size="xs"
          variant="secondary"
          title={`Open ${preview.url}`}
          onClick={() => props.onOpen(preview.url)}
        >
          :{preview.port} ↗
        </Button>
      ))}
    </div>
  )
}

interface TerminalSelectionToolbarProps {
  readonly toolbarRef: React.RefObject<HTMLDivElement | null>
  readonly selectionText: string
  readonly position: { readonly x: number; readonly y: number } | null
  readonly onAddToChat: () => void
  readonly onCopy: () => void
}

export function TerminalSelectionToolbar(props: TerminalSelectionToolbarProps) {
  if (props.selectionText.length === 0 || props.position === null) return null
  return (
    <div
      ref={props.toolbarRef}
      role="toolbar"
      aria-label="Terminal selection actions"
      className="fixed z-30 flex items-center overflow-hidden rounded border border-border bg-bg-secondary shadow-sm"
      style={{ left: props.position.x, top: props.position.y }}
    >
      <Button size="xs" variant="ghost" className="rounded-none" onClick={props.onAddToChat}>
        Add to chat
      </Button>
      <span className="h-4 w-px bg-border" />
      <Button size="xs" variant="ghost" className="rounded-none" onClick={props.onCopy}>
        Copy
      </Button>
    </div>
  )
}
