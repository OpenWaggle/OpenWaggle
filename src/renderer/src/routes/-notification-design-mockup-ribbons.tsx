import { CheckCircle2, MessageCircleQuestion } from 'lucide-react'
import { EYEBROW, SourceBadge } from './-notification-design-mockup-parts'

/**
 * MOCKUP — the ribbon states other than a pending approval. Static, nothing works.
 *
 * Same B3 ribbon shape as the pending state, so a decision changes the row in place rather than
 * stacking a second card underneath it. Deleted with the rest of the mockup.
 */

/** The same ribbon after a decision. It updates in place rather than adding a second row. */
export function ResolvedRibbon() {
  return (
    <section className="border-b border-border/60 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <CheckCircle2 className="size-3.5 shrink-0 text-success" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`${EYEBROW} text-text-tertiary`}>Allowed once</span>
              <SourceBadge>GitHub Issues</SourceBadge>
            </div>
            <p className="mt-0.5 truncate text-[12px] font-medium text-text-primary">
              You allowed GitHub Issues to reach api.github.com this time.
            </p>
            <p className="mt-0.5 truncate text-[10px] text-text-muted">The run can continue.</p>
          </div>
        </div>
        <span className="text-[11px] text-text-tertiary">Done</span>
      </div>
    </section>
  )
}

/** A question is not an approval, so the ribbon carries options instead of decisions. */
export function QuestionRibbon() {
  return (
    <section className="border-b border-border/60 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <MessageCircleQuestion className="size-3.5 shrink-0 text-accent" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${EYEBROW} text-accent`}>Waiting for you</span>
            <SourceBadge>Waggle</SourceBadge>
          </div>
          <p className="mt-0.5 truncate text-[12px] font-medium text-text-primary">
            Which branch should I use?
          </p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {['main', 'develop', 'release/0.3'].map((option, index) => (
          <span
            className={`rounded border px-2 py-1 text-[11px] ${
              index === 0
                ? 'border-accent/50 bg-accent/10 text-text-primary'
                : 'border-border text-text-secondary'
            }`}
            key={option}
          >
            {option}
          </span>
        ))}
      </div>
    </section>
  )
}
