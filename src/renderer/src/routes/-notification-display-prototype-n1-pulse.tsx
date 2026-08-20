import { Activity, AlertTriangle, CircleAlert, Info, RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

// PROTOTYPE - N1 "Composer-adjacent run pulse": throwaway notification-display
// study for run-attached info/warning/error presentation. Delete or absorb
// after choosing a notification model.

type NoticeSeverity = 'info' | 'warning' | 'error'
type NoticeState = {
  readonly severity: NoticeSeverity
  readonly visible: boolean
  readonly replayKey: number
}

const INFO_DISMISS_MS = 2400

const NOTICE_COPY = {
  info: {
    title: 'Ponytail loaded in full mode',
    detail: 'Run context updated from Ponytail.',
    provenance: 'Ponytail',
    recovery: 'View run state',
  },
  warning: {
    title: 'GitHub issue search is slower than expected',
    detail: 'GitHub Issues is still responding. The run can continue while this retries.',
    provenance: 'GitHub Issues',
    recovery: 'Retry now',
  },
  error: {
    title: 'GitHub issue search failed',
    detail: 'api.github.com returned a rate-limit response. The transcript is intact.',
    provenance: 'GitHub Issues',
    recovery: 'Open recovery steps',
  },
} satisfies Record<
  NoticeSeverity,
  {
    readonly title: string
    readonly detail: string
    readonly provenance: string
    readonly recovery: string
  }
>

const SEVERITY_TONE = {
  info: {
    icon: Info,
    border: 'border-border-light',
    surface: 'bg-bg-secondary',
    text: 'text-text-secondary',
  },
  warning: {
    icon: AlertTriangle,
    border: 'border-warning/28',
    surface: 'bg-warning/6',
    text: 'text-warning',
  },
  error: {
    icon: CircleAlert,
    border: 'border-error/28',
    surface: 'bg-error/6',
    text: 'text-error',
  },
} satisfies Record<
  NoticeSeverity,
  {
    readonly icon: typeof Info
    readonly border: string
    readonly surface: string
    readonly text: string
  }
>

function DemoControls({
  notice,
  onReplay,
  onDismiss,
}: {
  readonly notice: NoticeState
  readonly onReplay: (severity: NoticeSeverity) => void
  readonly onDismiss: () => void
}) {
  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-wrap items-center justify-between gap-3 px-5 pt-4">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold tracking-[0.16em] text-accent uppercase">
          Throwaway prototype N1
        </p>
        <p className="mt-0.5 text-[12px] text-text-tertiary">
          Visible notice: {notice.visible ? notice.severity : 'none'}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button variant="secondary" size="xs" onClick={() => onReplay('info')}>
          Replay info
        </Button>
        <Button variant="secondary" size="xs" onClick={() => onReplay('warning')}>
          Replay warning
        </Button>
        <Button variant="secondary" size="xs" onClick={() => onReplay('error')}>
          Replay error
        </Button>
        <Button variant="ghost" size="xs" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}

function MockTranscript() {
  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6 px-12 py-6">
      <div className="flex justify-end">
        <div className="max-w-[78%] rounded-2xl rounded-br-md bg-bg-tertiary px-4 py-3 text-[13px] leading-5 text-text-primary">
          Check the open GitHub issues and tell me which one we should fix first.
        </div>
      </div>
      <div>
        <p className="text-[13px] leading-6 text-text-secondary">
          I am reading the project context and comparing active issues against the current session.
        </p>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-text-muted">
          <span className="size-1.5 rounded-full bg-text-muted/55" />
          Active run / session transcript remains available
        </div>
      </div>
    </div>
  )
}

function InfoPulse({
  notice,
  onDismiss,
}: {
  readonly notice: NoticeState
  readonly onDismiss: () => void
}) {
  const copy = NOTICE_COPY.info

  return (
    <div
      key={notice.replayKey}
      role="status"
      className={cn(
        'mx-auto mb-1 flex w-fit max-w-[calc(100%-2rem)] items-center gap-2 rounded-md border border-border-light bg-bg-secondary px-2.5 py-1.5 text-[11px] text-text-secondary transition-opacity duration-200',
        notice.visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      <span className="size-1.5 rounded-full bg-accent" />
      <span className="truncate">{copy.title}</span>
      <span className="text-text-muted">/ {copy.provenance}</span>
      <Button
        aria-label="Dismiss info pulse"
        variant="ghost"
        size="icon-xs"
        className="-mr-1"
        onClick={onDismiss}
      >
        <X className="size-3" />
      </Button>
    </div>
  )
}

function SemanticNotice({
  notice,
  onDismiss,
  onRecover,
}: {
  readonly notice: NoticeState
  readonly onDismiss: () => void
  readonly onRecover: () => void
}) {
  const copy = NOTICE_COPY[notice.severity]
  const tone = SEVERITY_TONE[notice.severity]
  const Icon = tone.icon

  return (
    <div
      role={notice.severity === 'error' ? 'alert' : 'status'}
      className={cn(
        'mx-auto mb-0 flex w-[calc(100%-28px)] items-start gap-2.5 rounded-t-[var(--radius-panel)] border-x border-t px-3 py-2.5',
        tone.border,
        tone.surface,
      )}
    >
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', tone.text)} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="truncate text-[12px] font-medium text-text-primary">{copy.title}</p>
          <span className="rounded bg-bg-tertiary px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary">
            {copy.provenance}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] leading-4 text-text-tertiary">{copy.detail}</p>
      </div>
      <Button
        variant="unstyled"
        type="button"
        onClick={onRecover}
        className={cn(
          'mt-0.5 inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] font-medium transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35',
          tone.border,
          tone.text,
        )}
      >
        <RefreshCw className="size-3" />
        {copy.recovery}
      </Button>
      <Button
        aria-label={`Dismiss ${notice.severity} notice`}
        variant="ghost"
        size="icon-xs"
        className="mt-0.5"
        onClick={onDismiss}
      >
        <X className="size-3" />
      </Button>
    </div>
  )
}

function RunPulseNotice({
  notice,
  onDismiss,
  onRecover,
}: {
  readonly notice: NoticeState
  readonly onDismiss: () => void
  readonly onRecover: () => void
}) {
  if (notice.severity === 'info') {
    return <InfoPulse notice={notice} onDismiss={onDismiss} />
  }

  if (!notice.visible) return <div className="h-0" />

  return <SemanticNotice notice={notice} onDismiss={onDismiss} onRecover={onRecover} />
}

function ComposerFrame() {
  return (
    <section
      aria-label="Prototype composer"
      className="rounded-[var(--radius-panel)] border border-input-card-border bg-bg-secondary"
    >
      <div className="px-4 py-[14px]">
        <textarea
          aria-label="Prototype message input"
          className="h-12 w-full resize-none bg-transparent text-[13px] leading-5 text-text-primary outline-none placeholder:text-text-muted"
          placeholder="Ask for follow-up changes"
        />
      </div>
      <div className="flex min-h-11 items-center justify-between border-t border-border/65 px-4 text-[11px] text-text-muted">
        <div className="flex items-center gap-2">
          <Activity className="size-3.5 text-text-tertiary" />
          <span>GPT-5.6 Sol - Medium</span>
        </div>
        <span>main</span>
      </div>
    </section>
  )
}

export function NotificationDisplayPrototypeN1Pulse() {
  const [notice, setNotice] = useState<NoticeState>({
    severity: 'info',
    visible: true,
    replayKey: 0,
  })

  useEffect(() => {
    if (!notice.visible || notice.severity !== 'info') return undefined

    const timeout = setTimeout(() => {
      setNotice((current) =>
        current.replayKey === notice.replayKey && current.severity === 'info'
          ? { ...current, visible: false }
          : current,
      )
    }, INFO_DISMISS_MS)

    return () => clearTimeout(timeout)
  }, [notice.replayKey, notice.severity, notice.visible])

  function replayNotice(severity: NoticeSeverity) {
    setNotice((current) => ({
      severity,
      visible: true,
      replayKey: current.replayKey + 1,
    }))
  }

  function dismissNotice() {
    setNotice((current) => ({ ...current, visible: false }))
  }

  function recoverNotice() {
    replayNotice('info')
  }

  return (
    <main
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg"
      data-prototype-variant="N1"
    >
      <DemoControls notice={notice} onReplay={replayNotice} onDismiss={dismissNotice} />
      <div className="flex-1 overflow-y-auto chat-scroll">
        <MockTranscript />
      </div>
      <div className="mx-auto w-full max-w-[720px] px-5 pb-5 pt-2">
        <RunPulseNotice notice={notice} onDismiss={dismissNotice} onRecover={recoverNotice} />
        <ComposerFrame />
      </div>
    </main>
  )
}
