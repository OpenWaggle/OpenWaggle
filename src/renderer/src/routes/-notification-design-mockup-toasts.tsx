import { CircleAlert, Copy, Info, TriangleAlert, X } from 'lucide-react'

/**
 * MOCKUP — toast pieces for the notification design mockup. Static, nothing works.
 *
 * Geometry copied from T3 Code's `apps/web/src/components/ui/toast.tsx`, with its Tailwind tokens
 * mapped onto OpenWaggle's. See the sibling `-notification-design-mockup.tsx` for the full list of
 * source references. Deleted together with that file once the real components land.
 */

const DISMISS_ICON_STROKE_WIDTH = 2.25

export const TOAST_VIEWPORT =
  'pointer-events-none absolute right-(--toast-inset) top-[calc(var(--toast-inset)+var(--toast-header-offset))] z-40 flex w-[calc(100%-var(--toast-inset)*2)] max-w-90 flex-col [--toast-header-offset:52px] [--toast-inset:--spacing(4)] sm:[--toast-inset:--spacing(8)]'

/** T3 uses `dropdown-glass`; OpenWaggle has no such utility, so this is its nearest equivalent. */
const TOAST_CARD =
  'w-full select-none overflow-visible rounded-lg border border-border/60 bg-bg-secondary/92 text-text-primary shadow-xl shadow-black/25 backdrop-blur-sm'

function CornerDismiss() {
  return (
    <div className="absolute -top-1.5 -right-1.5 z-20">
      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border/60 bg-bg-secondary/92 text-text-muted shadow-sm backdrop-blur-sm">
        <X className="size-3" strokeWidth={DISMISS_ICON_STROKE_WIDTH} />
      </span>
    </div>
  )
}

/**
 * Error toast. `stacked-end` layout: body first, then a full-width right-aligned action row,
 * which is what `stackedThreadToast` forces for every thread-scoped notice.
 */
function ErrorToastCard() {
  return (
    <div className={TOAST_CARD}>
      <CornerDismiss />
      <div className="flex min-h-0 flex-col gap-2 py-2.5 pr-3.5 pl-3.5 text-sm">
        <div className="flex min-w-0 gap-2">
          <div className="flex h-lh w-4 shrink-0 items-center justify-center">
            <CircleAlert className="size-4 text-error" />
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0.5 pr-5">
            <p className="min-w-0 font-medium wrap-break-word">Could not reach api.github.com</p>
            <p className="line-clamp-4 min-w-0 text-[13px] leading-5 text-text-tertiary">
              GitHub Issues timed out after 30 seconds while listing open issues. The server may be
              rate limiting this token, or the network may be unavailable. Retrying will start a new
              request against the same host.
            </p>
          </div>
        </div>
        <div className="flex w-full items-center justify-end gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-text-tertiary">
            <Copy className="size-3" />
            Copy error
          </span>
          <span className="rounded-md border border-border px-1.5 py-0.5 text-[11px] text-text-tertiary">
            Retry
          </span>
        </div>
      </div>
    </div>
  )
}

function WarningToastCard() {
  return (
    <div className={TOAST_CARD}>
      <CornerDismiss />
      <div className="flex items-center justify-between gap-1.5 py-3 pr-3.5 pl-3.5 text-sm">
        <div className="flex min-w-0 flex-1 gap-2">
          <div className="flex h-lh w-4 shrink-0 items-center justify-center">
            <TriangleAlert className="size-4 text-warning" />
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0.5">
            <p className="min-w-0 font-medium wrap-break-word">Rate limit nearly exhausted</p>
            <p className="min-w-0 text-[13px] leading-5 text-text-tertiary">
              8 requests remain for api.github.com.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoToastCard() {
  return (
    <div className={TOAST_CARD}>
      <CornerDismiss />
      <div className="flex items-center justify-between gap-1.5 py-3 pr-3.5 pl-3.5 text-sm">
        <div className="flex min-w-0 flex-1 gap-2">
          <div className="flex h-lh w-4 shrink-0 items-center justify-center">
            <Info className="size-4 text-info" />
          </div>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-0.5">
            <p className="min-w-0 font-medium wrap-break-word">Ponytail loaded: full</p>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Collapsed stack.
 *
 * T3 translates each card behind the front one by `index * peek + shrink * height`, where
 * `shrink` is `1 - scale`. The second term cancels the height lost to `origin-top` scaling, so
 * every card's bottom edge lands exactly one peek below the card in front of it. Without it the
 * shorter scaled card disappears behind a tall frontmost card, which is the whole point of the
 * formula. With peek at 12px, that is 30px at scale 0.9 and 60px at scale 0.8 for this card size.
 */
export function CollapsedToastStack() {
  return (
    <div className="relative">
      <div className="absolute inset-0 origin-top translate-y-[60px] scale-[0.8]">
        <div className={`${TOAST_CARD} h-full opacity-70`} />
      </div>
      <div className="absolute inset-0 origin-top translate-y-[30px] scale-90">
        <div className={`${TOAST_CARD} h-full opacity-85`} />
      </div>
      <div className="relative">
        <ErrorToastCard />
      </div>
    </div>
  )
}

/** Hover state. The stack expands to full cards separated by one `--toast-gap`. */
export function ExpandedToastStack() {
  return (
    <div className="flex w-full max-w-90 flex-col gap-3">
      <ErrorToastCard />
      <WarningToastCard />
      <InfoToastCard />
    </div>
  )
}
