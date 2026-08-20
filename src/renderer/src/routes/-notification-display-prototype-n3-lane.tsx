import { AlertTriangle, ChevronDown, ChevronUp, CircleAlert, Info, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

// PROTOTYPE - N3 "Transcript-edge notice lane": run-attributed notifications
// live beside the transcript, not as transcript cards. Delete or absorb after
// the notification-display decision.

type NoticeSeverity = 'info' | 'warning' | 'error'
type NoticeVisibility = 'visible' | 'fading' | 'hidden'

interface DemoNotice {
  readonly severity: NoticeSeverity
  readonly visibility: NoticeVisibility
}

const INFO_FADE_DELAY_MS = 1800
const INFO_HIDE_DELAY_MS = 2600
const SEVERITIES = ['info', 'warning', 'error'] as const
const NOTICE_TONE = {
  info: 'border-border text-text-tertiary',
  warning: 'border-accent/30 text-accent',
  error: 'border-error/30 text-error',
} satisfies Record<NoticeSeverity, string>

const NOTICE_COPY = {
  info: {
    eyebrow: 'Info',
    title: 'Ponytail loaded full mode',
    provenance: 'run-18 / Ponytail',
    detail: 'The extension switched to full mode for richer repository context.',
    recovery: 'No action needed. The note fades without adding transcript content.',
  },
  warning: {
    eyebrow: 'Warning',
    title: 'GitHub Issues is slow',
    provenance: 'run-18 / GitHub Issues',
    detail: 'The request to api.github.com has been waiting longer than expected.',
    recovery: 'Retry the request or continue with cached project context.',
  },
  error: {
    eyebrow: 'Error',
    title: 'GitHub Issues failed',
    provenance: 'run-18 / GitHub Issues',
    detail: 'The extension could not fetch open issues after the network grant.',
    recovery: 'Retry the fetch, keep working without GitHub Issues, or inspect extension logs.',
  },
}

function noticeIcon(severity: NoticeSeverity) {
  if (severity === 'error') return <CircleAlert className="size-3.5 shrink-0 text-error" />
  if (severity === 'warning') return <AlertTriangle className="size-3.5 shrink-0 text-accent" />
  return <Info className="size-3.5 shrink-0 text-text-tertiary" />
}

function MockTranscriptAndComposer() {
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto chat-scroll">
        <div className="mx-auto w-full max-w-[720px] space-y-6 px-12 py-6">
          <div className="flex justify-end">
            <div className="max-w-[78%] rounded-2xl rounded-br-md bg-bg-tertiary px-4 py-3 text-[13px] leading-5 text-text-primary">
              Check the open GitHub issues and tell me which one we should fix first.
            </div>
          </div>
          <div>
            <p className="text-[13px] leading-6 text-text-secondary">
              I’ll inspect the project context, then compare the open issues against the current
              code.
            </p>
            <p className="mt-3 flex items-center gap-2 text-[11px] text-text-muted">
              <span className="size-1.5 rounded-full bg-text-muted/55" />
              Read project instructions and repository state
            </p>
            <p className="mt-3 flex items-center gap-2 text-[11px] text-text-muted">
              <span className="size-1.5 rounded-full bg-text-muted/55" />
              Query GitHub Issues for open candidates
            </p>
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-[720px] px-5 pb-5 pt-2">
        <div className="rounded-2xl border border-border bg-bg-secondary px-4 pb-3 pt-3">
          <textarea
            aria-label="Prototype message input"
            className="h-11 w-full resize-none bg-transparent text-[13px] leading-5 text-text-primary outline-none placeholder:text-text-muted"
            placeholder="Ask for follow-up changes"
          />
          <div className="flex items-center justify-between text-[11px] text-text-muted">
            <span>GPT-5.6 Sol - Medium</span>
            <span>main</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function NoticeMarker({
  notice,
  expanded,
  onToggleExpanded,
  onDismiss,
}: {
  readonly notice: DemoNotice
  readonly expanded: boolean
  readonly onToggleExpanded: () => void
  readonly onDismiss: () => void
}) {
  const copy = NOTICE_COPY[notice.severity]
  const persistent = notice.severity !== 'info'

  if (notice.visibility === 'hidden') {
    return (
      <div className="flex h-28 items-center justify-center border-l border-border/60 text-[11px] text-text-muted">
        Lane clear
      </div>
    )
  }

  return (
    <section
      aria-label={`${copy.eyebrow} notice`}
      className={cn(
        'border-l border-border/70 py-4 pl-3 pr-4 transition-opacity duration-300',
        notice.visibility === 'fading' && 'opacity-0',
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <Button
          variant="unstyled"
          aria-expanded={expanded}
          className={cn(
            'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-bg-secondary transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35',
            NOTICE_TONE[notice.severity],
          )}
          onClick={onToggleExpanded}
        >
          {noticeIcon(notice.severity)}
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                'shrink-0 text-[10px] font-semibold tracking-[0.12em] uppercase',
                notice.severity === 'error' && 'text-error',
                notice.severity === 'warning' && 'text-accent',
                notice.severity === 'info' && 'text-text-tertiary',
              )}
            >
              {copy.eyebrow}
            </span>
            <span className="min-w-0 truncate font-mono text-[10px] text-text-muted">
              {copy.provenance}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[12px] font-medium text-text-primary">{copy.title}</p>
          {expanded ? (
            <div className="mt-2 space-y-2 border-t border-border/55 pt-2">
              <p className="text-[11px] leading-4 text-text-tertiary">{copy.detail}</p>
              <p className="text-[11px] leading-4 text-text-secondary">Recovery: {copy.recovery}</p>
              {persistent ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" size="xs">
                    Retry
                  </Button>
                  <Button variant="ghost" size="xs">
                    Continue
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            aria-label={expanded ? 'Collapse notice detail' : 'Expand notice detail'}
            variant="ghost"
            size="icon-xs"
            onClick={onToggleExpanded}
          >
            {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
          </Button>
          {persistent ? (
            <Button aria-label="Dismiss notice" variant="ghost" size="icon-xs" onClick={onDismiss}>
              <X className="size-3" />
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function DemoControls({
  activeSeverity,
  expanded,
  onReplay,
  onToggleExpanded,
  onDismiss,
}: {
  readonly activeSeverity: NoticeSeverity
  readonly expanded: boolean
  readonly onReplay: (severity: NoticeSeverity) => void
  readonly onToggleExpanded: () => void
  readonly onDismiss: () => void
}) {
  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-bg-secondary/55 px-5">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold tracking-[0.16em] text-accent uppercase">
          Throwaway prototype - N3
        </p>
        <p className="truncate text-[12px] text-text-tertiary">
          Transcript-edge notice lane / {NOTICE_COPY[activeSeverity].eyebrow.toLowerCase()}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {SEVERITIES.map((severity) => (
          <Button key={severity} size="xs" variant="secondary" onClick={() => onReplay(severity)}>
            Replay {severity}
          </Button>
        ))}
        <Button size="xs" variant="ghost" onClick={onToggleExpanded}>
          {expanded ? 'Collapse' : 'Expand'}
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Dismiss active notice"
          onClick={onDismiss}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

export function NotificationDisplayPrototypeN3Lane() {
  const [notice, setNotice] = useState<DemoNotice>({ severity: 'warning', visibility: 'visible' })
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (notice.severity !== 'info' || notice.visibility !== 'visible') return
    const fadeTimer = window.setTimeout(() => {
      setNotice((current) =>
        current.severity === 'info' && current.visibility === 'visible'
          ? { ...current, visibility: 'fading' }
          : current,
      )
    }, INFO_FADE_DELAY_MS)
    const hideTimer = window.setTimeout(() => {
      setNotice((current) =>
        current.severity === 'info' ? { ...current, visibility: 'hidden' } : current,
      )
      setExpanded(false)
    }, INFO_HIDE_DELAY_MS)
    return () => {
      window.clearTimeout(fadeTimer)
      window.clearTimeout(hideTimer)
    }
  }, [notice.severity, notice.visibility])

  function replayNotice(severity: NoticeSeverity) {
    setNotice({ severity, visibility: 'visible' })
    setExpanded(severity !== 'info')
  }

  function dismissNotice() {
    setNotice((current) => ({ ...current, visibility: 'hidden' }))
    setExpanded(false)
  }

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg">
      <DemoControls
        activeSeverity={notice.severity}
        expanded={expanded}
        onReplay={replayNotice}
        onToggleExpanded={() => setExpanded((current) => !current)}
        onDismiss={dismissNotice}
      />
      <div className="flex min-h-0 flex-1">
        <MockTranscriptAndComposer />
        <aside className="w-[280px] shrink-0 border-l border-border/55 bg-bg-secondary/35">
          <div className="flex h-12 items-center justify-between border-b border-border/60 px-4">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold tracking-[0.14em] text-text-tertiary uppercase">
                Notice lane
              </p>
              <p className="truncate text-[11px] text-text-muted">Active run / session scoped</p>
            </div>
          </div>
          <NoticeMarker
            notice={notice}
            expanded={expanded}
            onToggleExpanded={() => setExpanded((current) => !current)}
            onDismiss={dismissNotice}
          />
        </aside>
      </div>
    </main>
  )
}
