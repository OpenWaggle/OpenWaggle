import { CheckCircle2, CircleAlert, Command, ShieldCheck, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import {
  MockConversationStart,
  type PrototypeDecision,
  type PrototypeVariantProps,
  ResolvedDecision,
  SourceBadge,
} from './-notification-prototype-parts'

// PROTOTYPE - B2 command prompt: composer-adjacent permission console for a paused run.

const COMMAND_RESOLVED_COPY = {
  'approved-once': 'You approved GitHub access to api.github.com this time.',
  'approved-session': 'You approved GitHub access to api.github.com for this session.',
  declined: 'You did not approve GitHub access to api.github.com.',
  cancelled: 'You canceled this turn before granting GitHub access.',
} satisfies Record<Exclude<PrototypeDecision, 'pending'>, string>

function PonytailFooterChip({ onDismiss }: { readonly onDismiss: () => void }) {
  return (
    <span className="group inline-flex max-w-full items-center gap-1.5 rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-muted">
      <span className="truncate">Ponytail full mode</span>
      <Button
        aria-label="Dismiss Ponytail status"
        variant="ghost"
        size="icon-xs"
        className="-mr-1 size-4 opacity-65 group-hover:opacity-100"
        onClick={onDismiss}
      >
        <X className="size-2.5" />
      </Button>
    </span>
  )
}

function PendingCommandPrompt({
  infoVisible,
  actions,
}: {
  readonly infoVisible: boolean
  readonly actions: PrototypeVariantProps['actions']
}) {
  return (
    <section
      aria-label="Command permission prompt"
      className="overflow-hidden rounded-[var(--radius-panel)] border border-input-card-border bg-bg-secondary"
    >
      <div className="flex min-w-0 items-center gap-2 border-b border-border/60 px-4 py-2">
        <Command className="size-3.5 shrink-0 text-text-tertiary" />
        <span className="shrink-0 font-mono text-[10px] font-semibold tracking-[0.12em] text-accent uppercase">
          paused
        </span>
        <span className="min-w-0 truncate font-mono text-[11px] text-text-tertiary">
          GitHub Issues / api.github.com / once or session
        </span>
      </div>

      <div className="px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <SourceBadge>GitHub Issues</SourceBadge>
          <h2 className="text-[13px] font-medium leading-5 text-text-primary">
            Allow api.github.com once?
          </h2>
        </div>
        <p className="mt-1 text-[12px] leading-5 text-text-tertiary">
          Needed to read open issues for this project. Declining keeps the turn running without
          network access.
        </p>
      </div>

      <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2 font-mono text-[10px] text-text-muted">
          <span>Esc keeps blocked</span>
          <span>Enter allows once</span>
          {infoVisible ? <PonytailFooterChip onDismiss={actions.dismissInfo} /> : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={actions.cancel}>
            Cancel turn
          </Button>
          <Button variant="secondary" size="sm" onClick={actions.decline}>
            Decline
          </Button>
          <Button variant="secondary" size="sm" onClick={actions.approveSession}>
            Allow session
          </Button>
          <Button
            variant="accent"
            size="sm"
            leftIcon={<ShieldCheck className="size-3.5" />}
            onClick={actions.approveOnce}
          >
            Allow once
          </Button>
        </div>
      </div>
    </section>
  )
}

function ResolvedCommandComposer({
  decision,
}: {
  readonly decision: Exclude<PrototypeDecision, 'pending'>
}) {
  const approved = decision === 'approved-once' || decision === 'approved-session'

  return (
    <div className="rounded-[var(--radius-panel)] border border-input-card-border bg-bg-secondary px-4 pb-3 pt-3">
      <div className="flex items-center gap-2">
        {approved ? (
          <CheckCircle2 className="size-3.5 shrink-0 text-success" />
        ) : (
          <CircleAlert className="size-3.5 shrink-0 text-text-muted" />
        )}
        <p className="min-w-0 flex-1 truncate text-[12px] text-text-secondary">
          {COMMAND_RESOLVED_COPY[decision]}
        </p>
      </div>
      <div className="mt-3 h-11 text-[13px] leading-5 text-text-muted">
        Ask for follow-up changes
      </div>
      <div className="flex items-center justify-between text-[11px] text-text-muted">
        <span>GPT-5.6 Sol · Medium</span>
        <span>main</span>
      </div>
    </div>
  )
}

export function VariantB2CommandPrompt({ scenario, actions }: PrototypeVariantProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-prototype-variant="B2">
      <div className="flex-1 overflow-y-auto chat-scroll">
        <MockConversationStart />
        <div className="mx-auto w-full max-w-[720px] px-12 pb-8">
          {scenario.decision === 'pending' ? (
            <p className="text-[13px] leading-6 text-text-secondary">
              I’m paused at the composer until you approve the GitHub Issues command.
            </p>
          ) : (
            <div className="py-1">
              <ResolvedDecision decision={scenario.decision} />
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto w-full max-w-[720px] px-5 pb-20">
        {scenario.decision === 'pending' ? (
          <PendingCommandPrompt infoVisible={scenario.infoVisible} actions={actions} />
        ) : (
          <ResolvedCommandComposer decision={scenario.decision} />
        )}
      </div>
    </div>
  )
}
