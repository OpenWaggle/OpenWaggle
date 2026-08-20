import { CheckCircle2, CircleAlert, Info, LockKeyhole, Network, X } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import {
  MockConversationStart,
  type PrototypeDecision,
  type PrototypeScenarioActions,
  type PrototypeVariantProps,
  SourceBadge,
} from './-notification-prototype-parts'

// PROTOTYPE — B3 "Decision ribbon": composer-adjacent approval state where the
// composer top seam becomes the paused-run permission control.

interface DecisionRibbonProps {
  readonly decision: PrototypeDecision
  readonly actions: PrototypeScenarioActions
}

function decisionCopy(decision: PrototypeDecision) {
  if (decision === 'approved-once' || decision === 'approved-session') {
    return {
      label: decision === 'approved-session' ? 'Allowed for session' : 'Allowed once',
      title:
        decision === 'approved-session'
          ? 'You allowed GitHub access to api.github.com for this session.'
          : 'You allowed GitHub access to api.github.com this time.',
      detail: 'The run can continue.',
    }
  }

  if (decision === 'declined') {
    return {
      label: 'Not approved',
      title: 'You did not approve GitHub access to api.github.com.',
      detail: 'The run will continue without GitHub Issues.',
    }
  }

  if (decision === 'cancelled') {
    return {
      label: 'Turn cancelled',
      title: 'You canceled this turn before granting GitHub access.',
      detail: 'No network request was made.',
    }
  }

  return {
    label: 'Needs decision',
    title: 'Allow GitHub Issues to reach api.github.com?',
    detail: 'api.github.com · one run · read open issues',
  }
}

function DecisionStateIcon({ decision }: { readonly decision: PrototypeDecision }) {
  if (decision === 'approved-once' || decision === 'approved-session') {
    return <CheckCircle2 className="size-3.5 shrink-0 text-success" />
  }

  if (decision === 'declined') {
    return <CircleAlert className="size-3.5 shrink-0 text-text-muted" />
  }

  return <LockKeyhole className="size-3.5 shrink-0 text-accent" />
}

function PonytailInfoChip({ onDismiss }: { readonly onDismiss: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded border border-border bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-tertiary">
      <Info className="size-3 shrink-0" />
      <span className="truncate">Ponytail · Full mode</span>
      <Button
        aria-label="Dismiss Ponytail info"
        variant="ghost"
        size="icon-xs"
        className="-mr-1 size-4"
        onClick={onDismiss}
      >
        <X className="size-3" />
      </Button>
    </span>
  )
}

function DecisionSeam({ decision, actions }: DecisionRibbonProps) {
  const copy = decisionCopy(decision)
  const pending = decision === 'pending'

  return (
    <section aria-label="Run permission decision" className="border-b border-border/60 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <DecisionStateIcon decision={decision} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  'text-[10px] font-semibold tracking-[0.14em] uppercase',
                  pending ? 'text-accent' : 'text-text-tertiary',
                )}
              >
                {copy.label}
              </span>
              <SourceBadge>GitHub Issues</SourceBadge>
            </div>
            <p className="mt-0.5 truncate text-[12px] font-medium text-text-primary">
              {copy.title}
            </p>
            <p className="mt-0.5 truncate text-[10px] text-text-muted">{copy.detail}</p>
          </div>
        </div>

        {pending ? (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="xs" onClick={actions.decline}>
              Continue without
            </Button>
            <Button variant="secondary" size="xs" onClick={actions.approveSession}>
              Allow this session
            </Button>
            <Button variant="accent" size="xs" onClick={actions.approveOnce}>
              Allow once
            </Button>
          </div>
        ) : (
          <span className="text-[11px] text-text-tertiary">Done</span>
        )}
      </div>
    </section>
  )
}

function RibbonComposer({ scenario, actions }: PrototypeVariantProps) {
  const pending = scenario.decision === 'pending'

  return (
    <div className="mx-auto w-full max-w-[720px] px-5 pb-20 pt-2">
      <div className="rounded-2xl border border-border bg-bg-secondary">
        <DecisionSeam decision={scenario.decision} actions={actions} />
        <div className="px-4 pb-3 pt-3">
          <textarea
            aria-label="Prototype message input"
            className="h-11 w-full resize-none bg-transparent text-[13px] leading-5 text-text-primary outline-none placeholder:text-text-muted"
            placeholder={
              pending ? 'Approve or block above to continue' : 'Ask for follow-up changes'
            }
          />
          <div className="flex min-h-7 items-center justify-between gap-3 text-[11px] text-text-muted">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate">GPT-5.6 Sol · Medium</span>
              {pending ? (
                <span className="inline-flex items-center gap-1 rounded border border-border bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-tertiary">
                  <Network className="size-3" />
                  Waiting on network
                </span>
              ) : null}
              {scenario.infoVisible ? <PonytailInfoChip onDismiss={actions.dismissInfo} /> : null}
            </div>
            <span className="shrink-0">{pending ? 'Run paused' : 'main'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function VariantB3DecisionRibbon({ scenario, actions }: PrototypeVariantProps) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col" data-prototype-variant="B3">
      <div className="flex-1 overflow-y-auto chat-scroll">
        <MockConversationStart />
        <div className="mx-auto w-full max-w-[720px] px-12 pb-8">
          <p className="text-[13px] leading-6 text-text-secondary">
            GitHub is prepared to inspect the issue tracker. The run is paused at the composer
            boundary until you decide whether to grant network access.
          </p>
        </div>
      </div>
      <RibbonComposer scenario={scenario} actions={actions} />
    </div>
  )
}
