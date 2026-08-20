import { CheckCircle2, CircleAlert, Globe2, PauseCircle, X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import {
  MockConversationStart,
  type PrototypeDecision,
  type PrototypeVariantProps,
  SourceBadge,
} from './-notification-prototype-parts'

// PROTOTYPE - B1 "Run seam": composer-adjacent approval state absorbed into the
// existing composer frame, not stacked above the input or rendered as a banner.

function SeamDecisionButtons({ actions }: Pick<PrototypeVariantProps, 'actions'>) {
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
      <Button variant="ghost" size="sm" radius="md" onClick={actions.cancel}>
        Cancel turn
      </Button>
      <Button variant="ghost" size="sm" radius="md" onClick={actions.decline}>
        Decline
      </Button>
      <Button variant="secondary" size="sm" radius="md" onClick={actions.approveSession}>
        Allow for session
      </Button>
      <Button
        variant="unstyled"
        type="button"
        onClick={actions.approveOnce}
        className="inline-flex h-8 items-center justify-center rounded-md border border-border-light bg-bg-tertiary px-2.5 text-[12px] font-semibold text-text-primary transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
      >
        Allow once
      </Button>
    </div>
  )
}

function SeamResolvedState({
  decision,
}: {
  readonly decision: Exclude<PrototypeDecision, 'pending'>
}) {
  const approved = decision === 'approved-once' || decision === 'approved-session'
  const cancelled = decision === 'cancelled'
  const summary = getResolvedSummary(decision)

  return (
    <div className="flex min-w-0 items-center gap-2">
      {approved ? (
        <CheckCircle2 className="size-3.5 shrink-0 text-success" />
      ) : (
        <CircleAlert className="size-3.5 shrink-0 text-text-muted" />
      )}
      <p className="min-w-0 truncate text-[12px] text-text-tertiary">{summary}</p>
      {cancelled ? null : <SourceBadge>api.github.com</SourceBadge>}
    </div>
  )
}

function getResolvedSummary(decision: Exclude<PrototypeDecision, 'pending'>) {
  if (decision === 'approved-session') {
    return 'Allowed api.github.com for this session.'
  }
  if (decision === 'approved-once') {
    return 'Allowed api.github.com once for this run.'
  }
  if (decision === 'cancelled') {
    return 'Canceled this turn before GitHub access was granted.'
  }
  return 'Declined GitHub access; the run may continue without it.'
}

function PonytailFooterChip({ actions }: Pick<PrototypeVariantProps, 'actions'>) {
  return (
    <div className="flex min-w-0 items-center gap-1.5 rounded-md border border-border/70 bg-bg-tertiary px-2 py-1 text-[10px] text-text-tertiary">
      <Globe2 className="size-3 shrink-0" />
      <span className="truncate">Ponytail full mode</span>
      <Button
        aria-label="Dismiss Ponytail mode note"
        variant="ghost"
        size="icon-xs"
        className="-mr-1"
        onClick={actions.dismissInfo}
      >
        <X className="size-3" />
      </Button>
    </div>
  )
}

export function VariantB1RunSeam({ scenario, actions }: PrototypeVariantProps) {
  const decision = scenario.decision
  const isPending = decision === 'pending'

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-prototype-variant="B1">
      <div className="flex-1 overflow-y-auto chat-scroll">
        <MockConversationStart />
        <div className="mx-auto w-full max-w-[720px] px-12 pb-8">
          <p className="text-[13px] leading-6 text-text-secondary">
            I found the GitHub project context. The run is paused at the composer until network
            access is decided.
          </p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[720px] px-5 pb-20 pt-2">
        <section
          aria-label="Composer run approval state"
          className="relative overflow-hidden rounded-[var(--radius-panel)] border border-input-card-border bg-bg-secondary transition-colors"
        >
          <div className="px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              {isPending ? (
                <span className="size-1.5 shrink-0 rounded-full bg-accent" />
              ) : (
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    decision === 'approved-once' || decision === 'approved-session'
                      ? 'bg-success'
                      : 'bg-text-muted',
                  )}
                />
              )}
              <p className="min-w-0 truncate text-[12px] font-medium text-text-primary">
                {isPending ? 'Run paused' : 'Approval resolved'}
              </p>
              <SourceBadge>GitHub Issues</SourceBadge>
              {isPending ? <PauseCircle className="size-3.5 shrink-0 text-text-tertiary" /> : null}
            </div>

            <div className="mt-2 min-h-12">
              {isPending ? (
                <p className="text-[13px] leading-5 text-text-secondary">
                  Allow GitHub Issues to contact{' '}
                  <span className="font-mono text-text-primary">api.github.com</span>? Choose once
                  for this run or for the current session.
                </p>
              ) : (
                <textarea
                  aria-label="Prototype message input"
                  className="h-12 w-full resize-none bg-transparent text-[13px] leading-5 text-text-primary outline-none placeholder:text-text-muted"
                  placeholder="Ask for follow-up changes"
                />
              )}
            </div>
          </div>

          <div className="flex min-h-11 items-center justify-between gap-3 border-t border-border/65 px-4">
            <div className="flex min-w-0 items-center gap-2 text-[11px] text-text-muted">
              <span className="shrink-0">GPT-5.6 Sol - Medium</span>
              {scenario.infoVisible ? <PonytailFooterChip actions={actions} /> : null}
            </div>
            {isPending ? (
              <SeamDecisionButtons actions={actions} />
            ) : (
              <SeamResolvedState decision={decision} />
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
