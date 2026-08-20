import { AlertTriangle, CheckCircle2, CircleAlert, Info, Play, RotateCcw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'

// PROTOTYPE - N2 restrained viewport notice shelf for run-scoped notification display.

type Severity = 'info' | 'warning' | 'error'
type Lifecycle = 'visible' | 'faded' | 'dismissed'
type Notice = Readonly<{
  id: string
  severity: Severity
  lifecycle: Lifecycle
  title: string
  detail: string
  provenance: string
  recovery: string
  transcript: string
}>

const INFO_VISIBLE_MS = 3600
const MAX_VISIBLE = 3
const TAIL_COUNT = 4

const COPY: Record<Severity, Omit<Notice, 'id' | 'severity' | 'lifecycle'>> = {
  info: {
    title: 'Session resource indexed',
    detail: 'The active transcript has a fresh project map.',
    provenance: 'Run 42 / indexer / 08:36',
    recovery: 'No action required. Informational notices fade after they are seen.',
    transcript: 'The indexer refreshed project context for Run 42.',
  },
  warning: {
    title: 'GitHub issue search is slow',
    detail: 'The request to api.github.com is taking longer than expected.',
    provenance: 'Run 42 / GitHub Issues / api.github.com',
    recovery: 'Recovery: retry the request or continue with cached project context.',
    transcript: 'GitHub Issues is responding slowly for Run 42.',
  },
  error: {
    title: 'Extension recovery failed',
    detail: 'GitHub Issues could not resume after the network retry.',
    provenance: 'Run 42 / GitHub Issues / retry-2',
    recovery: 'Recovery: review the last request, then retry or keep the run blocked.',
    transcript: 'GitHub Issues failed to recover after retry-2.',
  },
}

const SEED: readonly Notice[] = [
  { ...COPY.info, id: 'n2-seed-info', severity: 'info', lifecycle: 'visible' },
  { ...COPY.warning, id: 'n2-seed-warning', severity: 'warning', lifecycle: 'visible' },
] as const

const META = {
  info: {
    Icon: Info,
    HistoryIcon: CheckCircle2,
    label: 'Info',
    border: 'border-info/24',
    text: 'text-info',
    dot: 'bg-info/55',
  },
  warning: {
    Icon: AlertTriangle,
    HistoryIcon: AlertTriangle,
    label: 'Warning',
    border: 'border-warning/28',
    text: 'text-warning',
    dot: 'bg-warning/60',
  },
  error: {
    Icon: CircleAlert,
    HistoryIcon: CircleAlert,
    label: 'Error',
    border: 'border-error/32',
    text: 'text-error',
    dot: 'bg-error/65',
  },
} as const

function createNotice(severity: Severity, count: number): Notice {
  return { ...COPY[severity], id: `n2-${severity}-${count}`, severity, lifecycle: 'visible' }
}

function NoticeShelf({
  shelf,
  queuedCount,
  setLifecycle,
}: {
  readonly shelf: readonly Notice[]
  readonly queuedCount: number
  readonly setLifecycle: (id: string, lifecycle: Lifecycle) => void
}) {
  return (
    <div className="pointer-events-none absolute right-5 top-5 z-20 flex w-[360px] max-w-[calc(100vw-40px)] flex-col gap-2">
      {shelf.map((notice, index) => {
        const meta = META[notice.severity]
        const Icon = meta.Icon
        const persistent = notice.severity !== 'info'
        return (
          <section
            aria-label={`${meta.label} notice`}
            className={cn(
              'pointer-events-auto overflow-hidden rounded-lg border bg-bg-secondary/96 backdrop-blur-sm',
              meta.border,
            )}
            key={notice.id}
          >
            <div className="flex items-start gap-2 px-3 py-2.5">
              <span className={cn('mt-1 size-1.5 rounded-full', meta.dot)} />
              <Icon className={cn('mt-0.5 size-3.5 shrink-0', meta.text)} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-[12px] font-medium text-text-primary">
                    {notice.title}
                  </p>
                  {index === 0 && queuedCount > 0 ? (
                    <span className="rounded bg-bg-tertiary px-1.5 py-0.5 font-mono text-[10px] text-text-muted">
                      +{queuedCount}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-text-tertiary">
                  {notice.detail}
                </p>
                <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 font-mono text-[10px] text-text-muted">
                  <span className="truncate">{notice.provenance}</span>
                  <span>{persistent ? 'persists' : 'auto-fades'}</span>
                </div>
              </div>
              {persistent ? (
                <Button
                  aria-label={`Dismiss ${meta.label.toLowerCase()} notice`}
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setLifecycle(notice.id, 'dismissed')}
                >
                  <X className="size-3" />
                </Button>
              ) : null}
            </div>
            {persistent ? (
              <p className="border-t border-border/60 px-3 py-2 text-[11px] leading-4 text-text-secondary">
                {notice.recovery}
              </p>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

function ShelfControls({
  visibleCount,
  replay,
  stackQueue,
  dismissPersistent,
  reset,
}: {
  readonly visibleCount: number
  readonly replay: (severity: Severity) => void
  readonly stackQueue: () => void
  readonly dismissPersistent: () => void
  readonly reset: () => void
}) {
  return (
    <div className="absolute bottom-5 left-5 z-30 w-[340px] rounded-lg border border-border/70 bg-bg-secondary/96 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] tracking-[0.14em] text-accent uppercase">
            N2 shelf controls
          </p>
          <p className="mt-0.5 text-[11px] text-text-muted">{visibleCount} visible notices</p>
        </div>
        <Button aria-label="Reset notice prototype" variant="ghost" size="icon-sm" onClick={reset}>
          <RotateCcw className="size-3.5" />
        </Button>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button
          variant="secondary"
          size="xs"
          leftIcon={<Play className="size-3" />}
          onClick={() => replay('info')}
        >
          Info
        </Button>
        <Button variant="secondary" size="xs" onClick={() => replay('warning')}>
          Warning
        </Button>
        <Button variant="secondary" size="xs" onClick={() => replay('error')}>
          Error
        </Button>
      </div>
      <div className="mt-2 flex gap-2">
        <Button variant="accent" size="xs" onClick={stackQueue}>
          Stack queue
        </Button>
        <Button variant="ghost" size="xs" onClick={dismissPersistent}>
          Dismiss warning/error
        </Button>
      </div>
    </div>
  )
}

export function NotificationDisplayPrototypeN2Shelf() {
  const [notices, setNotices] = useState<readonly Notice[]>(SEED)
  const countRef = useRef(SEED.length)
  const live = notices.filter((notice) => notice.lifecycle === 'visible')
  const shelf = live.slice(Math.max(0, live.length - MAX_VISIBLE)).reverse()
  const queuedCount = Math.max(0, live.length - shelf.length)
  const resolved = notices
    .filter((notice) => notice.lifecycle !== 'visible' && notice.severity !== 'info')
    .slice(Math.max(0, notices.length - TAIL_COUNT))
  const latestResolved = resolved.at(-1)
  const latestMeta = latestResolved ? META[latestResolved.severity] : null
  const LatestIcon = latestMeta?.HistoryIcon
  const nextInfoNoticeId = notices.find(
    (notice) => notice.severity === 'info' && notice.lifecycle === 'visible',
  )?.id

  useEffect(() => {
    if (!nextInfoNoticeId) return undefined

    const timer = window.setTimeout(() => {
      setNotices((current) =>
        current.map((item) =>
          item.id === nextInfoNoticeId ? { ...item, lifecycle: 'faded' } : item,
        ),
      )
    }, INFO_VISIBLE_MS)

    return () => window.clearTimeout(timer)
  }, [nextInfoNoticeId])

  function setLifecycle(id: string, lifecycle: Lifecycle) {
    setNotices((current) => current.map((item) => (item.id === id ? { ...item, lifecycle } : item)))
  }

  function replay(severity: Severity) {
    countRef.current += 1
    setNotices((current) => [...current, createNotice(severity, countRef.current)])
  }

  function stackQueue() {
    replay('info')
    replay('warning')
    replay('error')
  }

  function reset() {
    countRef.current = SEED.length
    setNotices(SEED)
  }

  function dismissPersistent() {
    const target = [...notices]
      .reverse()
      .find((notice) => notice.lifecycle === 'visible' && notice.severity !== 'info')
    if (target) setLifecycle(target.id, 'dismissed')
  }

  return (
    <main
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg"
      data-prototype-variant="N2"
    >
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <NoticeShelf shelf={shelf} queuedCount={queuedCount} setLifecycle={setLifecycle} />

        <div className="h-full overflow-y-auto chat-scroll">
          <div className="mx-auto w-full max-w-[760px] space-y-6 px-10 py-8">
            <div className="flex justify-end">
              <div className="max-w-[78%] rounded-2xl rounded-br-md bg-bg-tertiary px-4 py-3 text-[13px] leading-5 text-text-primary">
                Check the open GitHub issues and tell me which one we should fix first.
              </div>
            </div>
            <p className="text-[13px] leading-6 text-text-secondary">
              I’m reading the issue list and tracking run-level events in the notice shelf.
            </p>
            <div className="flex items-center gap-2 text-[11px] text-text-muted">
              <span className="size-1.5 rounded-full bg-accent/65" />
              Active run · main · GPT-5.6 Sol · Medium
            </div>
            <div className="flex items-start gap-2 border-l border-border/70 pl-3 text-[12px] text-text-tertiary">
              {LatestIcon && latestMeta ? (
                <LatestIcon className={cn('mt-0.5 size-3.5 shrink-0', latestMeta.text)} />
              ) : null}
              <span>
                {latestResolved?.transcript ??
                  'Only dismissed warnings and errors appear here as concise transcript events.'}
              </span>
            </div>
          </div>
        </div>

        <ShelfControls
          visibleCount={live.length}
          replay={replay}
          stackQueue={stackQueue}
          dismissPersistent={dismissPersistent}
          reset={reset}
        />
      </div>
    </main>
  )
}
