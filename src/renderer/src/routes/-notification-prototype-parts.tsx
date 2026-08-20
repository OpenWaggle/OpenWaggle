import { CheckCircle2, CircleAlert, ShieldCheck } from 'lucide-react'
import { Button } from '@/shared/ui/Button'

export type PrototypeDecision =
  | 'pending'
  | 'approved-once'
  | 'approved-session'
  | 'declined'
  | 'cancelled'

export interface PrototypeScenario {
  readonly decision: PrototypeDecision
  readonly infoVisible: boolean
}

export interface PrototypeScenarioActions {
  readonly approveOnce: () => void
  readonly approveSession: () => void
  readonly decline: () => void
  readonly cancel: () => void
  readonly dismissInfo: () => void
  readonly reset: () => void
}

export interface PrototypeVariantProps {
  readonly scenario: PrototypeScenario
  readonly actions: PrototypeScenarioActions
}

const RESOLVED_DECISION_COPY = {
  'approved-once': 'You allowed GitHub access to api.github.com this time.',
  'approved-session': 'You allowed GitHub access to api.github.com for this session.',
  declined: 'You did not approve GitHub access to api.github.com.',
  cancelled: 'You canceled this turn before granting GitHub access.',
} satisfies Record<Exclude<PrototypeDecision, 'pending'>, string>

export function SourceBadge({ children }: { readonly children: string }) {
  return (
    <span className="rounded bg-bg-tertiary px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary">
      {children}
    </span>
  )
}

export function MockConversationStart() {
  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6 px-12 py-6">
      <div className="flex justify-end">
        <div className="max-w-[78%] rounded-2xl rounded-br-md bg-bg-tertiary px-4 py-3 text-[13px] leading-5 text-text-primary">
          Check the open GitHub issues and tell me which one we should fix first.
        </div>
      </div>
      <div>
        <p className="text-[13px] leading-6 text-text-secondary">
          I’ll inspect the project context, then compare the open issues against the current code.
        </p>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-text-muted">
          <span className="size-1.5 rounded-full bg-text-muted/55" />
          Read project instructions and repository state
        </div>
      </div>
    </div>
  )
}

export function MockComposer() {
  return (
    <div className="mx-auto w-full max-w-[720px] px-5 pb-5 pt-2">
      <div className="rounded-2xl border border-border bg-bg-secondary px-4 pb-3 pt-3 shadow-[0_10px_30px_rgba(0,0,0,0.12)]">
        <textarea
          aria-label="Prototype message input"
          className="h-11 w-full resize-none bg-transparent text-[13px] leading-5 text-text-primary outline-none placeholder:text-text-muted"
          placeholder="Ask for follow-up changes"
        />
        <div className="flex items-center justify-between text-[11px] text-text-muted">
          <span>GPT-5.6 Sol · Medium</span>
          <span>main</span>
        </div>
      </div>
    </div>
  )
}

export function DecisionActions({ actions }: { readonly actions: PrototypeScenarioActions }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" size="sm" onClick={actions.decline}>
        Keep blocked
      </Button>
      <Button
        variant="primary"
        size="sm"
        leftIcon={<ShieldCheck className="size-3.5" />}
        onClick={actions.approveOnce}
      >
        Allow once
      </Button>
    </div>
  )
}

export function ResolvedDecision({
  decision,
}: {
  readonly decision: Exclude<PrototypeDecision, 'pending'>
}) {
  const approved = decision === 'approved-once' || decision === 'approved-session'
  return (
    <div className="flex min-w-0 items-center gap-2 text-[12px] text-text-tertiary">
      {approved ? (
        <CheckCircle2 className="size-3.5 shrink-0 text-success" />
      ) : (
        <CircleAlert className="size-3.5 shrink-0 text-text-muted" />
      )}
      <span className="min-w-0 truncate">{RESOLVED_DECISION_COPY[decision]}</span>
      <SourceBadge>GitHub Issues</SourceBadge>
    </div>
  )
}
