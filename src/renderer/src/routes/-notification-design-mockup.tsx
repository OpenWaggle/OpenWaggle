import { ChevronDown, LockKeyhole, Network } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { EYEBROW, SourceBadge } from './-notification-design-mockup-parts'
import { QuestionRibbon, ResolvedRibbon } from './-notification-design-mockup-ribbons'
import {
  CollapsedToastStack,
  ExpandedToastStack,
  TOAST_VIEWPORT,
} from './-notification-design-mockup-toasts'

/**
 * MOCKUP — static picture of the agreed notification and approval design. Nothing works.
 *
 * Two separately chosen designs, deliberately:
 *
 *  - Approvals keep prototype B3, the decision ribbon, which was chosen from a screenshot. One
 *    compact row as the composer's top seam: state eyebrow, requester badge, the question, and a
 *    target/scope/effect line, with the decision buttons on the same row. Recovered from
 *    `-notification-prototype-b3-ribbon.tsx` at commit a95124df.
 *  - Notifications follow T3 Code, floating top right. See `-notification-design-mockup-toasts`.
 *
 * Two things B3 predates and now has to carry:
 *
 *  - The agreed action hierarchy is `Continue without`, `Allow once` as primary, and an `Allow…`
 *    menu holding session and project scope, so persistent approval never sits in the button row.
 *  - Raw payloads live behind `Details` and never replace the human sentence, so the multi-line
 *    consent bodies get somewhere to go without turning the ribbon into a card.
 */

function MockTranscript() {
  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6 px-12 pt-8 pb-4">
      <div className="flex justify-end">
        <div className="max-w-[70%] rounded-2xl rounded-br-md bg-bg-tertiary px-4 py-3 text-[13px] leading-5 text-text-primary">
          Check the open GitHub issues and tell me which one we should fix first.
        </div>
      </div>
      <div>
        <p className="text-[13px] leading-6 text-text-secondary">
          I’ll read the repository state, then compare the open issues against the current code.
        </p>
        <div className="mt-3 flex items-center gap-2 text-[11px] text-text-muted">
          <span className="size-1.5 rounded-full bg-text-muted/55" />
          Read project instructions and repository state
        </div>
      </div>
      <div className="rounded-lg border border-border/70 bg-bg-secondary/40 px-3 py-2">
        <p className={`${EYEBROW} text-text-tertiary`}>Warning notification</p>
        <p className="mt-1 text-[12px] leading-5 text-text-secondary">
          Rate limit for api.github.com is nearly exhausted. 8 requests remain.
        </p>
      </div>
    </div>
  )
}

/** B3's ribbon. One row: state, requester, question, target line, decisions. */
function ApprovalRibbon({ detailsOpen = false }: { readonly detailsOpen?: boolean }) {
  return (
    <section aria-label="Run permission decision" className="border-b border-border/60 px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <LockKeyhole className="size-3.5 shrink-0 text-accent" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`${EYEBROW} text-accent`}>Needs decision</span>
              <SourceBadge>GitHub Issues</SourceBadge>
            </div>
            <p className="mt-0.5 truncate text-[12px] font-medium text-text-primary">
              Allow GitHub Issues to reach api.github.com?
            </p>
            <p className="mt-0.5 truncate text-[10px] text-text-muted">
              api.github.com · one run · read open issues
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button size="xs" variant="ghost">
            Continue without
          </Button>
          <Button size="xs" variant="secondary">
            <span className="inline-flex items-center gap-1">
              Allow…
              <ChevronDown className="size-3" />
            </span>
          </Button>
          <Button size="xs" variant="accent">
            Allow once
          </Button>
        </div>
      </div>

      <Button className="mt-2 gap-1 text-[10px] text-text-muted" size="xs" variant="ghost">
        <ChevronDown className={`size-3 ${detailsOpen ? '' : '-rotate-90'}`} />
        Details
      </Button>

      {detailsOpen ? (
        <div className="mt-2 max-w-full min-w-0 rounded-lg border border-border/65 bg-bg/70 p-3">
          <pre className="max-h-40 max-w-full min-w-0 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-text-secondary [overflow-wrap:anywhere]">
            {`Server: github-issues
Tool: List issues (list_issues)
Arguments: {
  "repo": "OpenWaggle/OpenWaggle",
  "state": "open"
}`}
          </pre>
        </div>
      ) : null}
    </section>
  )
}

/** B3's composer: `rounded-2xl border border-border bg-bg-secondary`, ribbon as top seam. */
function ComposerShell({
  ribbon,
  placeholder,
  paused = false,
}: {
  readonly ribbon: React.ReactNode
  readonly placeholder: string
  readonly paused?: boolean
}) {
  return (
    <div className="rounded-2xl border border-border bg-bg-secondary">
      {ribbon}
      <div className="px-4 pt-3 pb-3">
        <p className="h-11 text-[13px] leading-5 text-text-muted">{placeholder}</p>
        <div className="flex min-h-7 items-center justify-between gap-3 text-[11px] text-text-muted">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate">GPT-5.6 Sol · Medium</span>
            <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-tertiary">
              YOLO (Full access) ∨
            </span>
            {paused ? (
              <span className="inline-flex items-center gap-1 rounded border border-border bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-tertiary">
                <Network className="size-3" />
                Waiting on network
              </span>
            ) : null}
          </div>
          <span className="shrink-0">{paused ? 'Run paused' : 'main'}</span>
        </div>
      </div>
    </div>
  )
}

function Section({
  title,
  note,
  children,
}: {
  readonly title: string
  readonly note: string
  readonly children: React.ReactNode
}) {
  return (
    <section className="border-t border-border px-5 py-6">
      <p className={`mx-auto max-w-[720px] ${EYEBROW} text-text-muted`}>{title}</p>
      <p className="mx-auto mt-1 max-w-[720px] text-[12px] leading-5 text-text-secondary">{note}</p>
      <div className="mx-auto mt-4 max-w-[720px]">{children}</div>
    </section>
  )
}

export function NotificationDesignMockup() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-bg">
      <div className="border-b border-border bg-bg-secondary/40 px-5 py-2">
        <p className={`${EYEBROW} text-text-muted`}>Mockup, not functional</p>
        <p className="mt-1 text-[12px] text-text-secondary">
          Approvals keep the B3 decision ribbon you chose. Notifications follow T3 Code and float
          top right.
        </p>
      </div>

      <div className="relative">
        <MockTranscript />
        <div className="mx-auto w-full max-w-[720px] px-5 pb-5">
          <ComposerShell
            paused
            placeholder="Approve or block above to continue"
            ribbon={<ApprovalRibbon />}
          />
        </div>
        <div className={TOAST_VIEWPORT}>
          <CollapsedToastStack />
        </div>
      </div>

      <Section
        note="Persistent approval never sits in the button row. Allow… opens a menu holding Allow for this session and Always allow for this project, and the project option names the exact requester, capability and destination it grants."
        title="Ribbon with Details open"
      >
        <ComposerShell
          paused
          placeholder="Approve or block above to continue"
          ribbon={<ApprovalRibbon detailsOpen />}
        />
      </Section>

      <Section
        note="One row per request. It changes state in place instead of adding a second card, and the transcript keeps the same single entry."
        title="After the decision"
      >
        <ComposerShell placeholder="Ask for follow-up changes" ribbon={<ResolvedRibbon />} />
      </Section>

      <Section
        note="On hover the corner stack expands to full cards one gap apart, most severe first. Info and warning leave after five seconds of focused time, the clock pauses when the window loses focus, and the error stays until dismissed."
        title="Notification stack, expanded on hover"
      >
        <div className="flex justify-end">
          <ExpandedToastStack />
        </div>
      </Section>

      <Section
        note="A question is not an approval, so it offers options rather than a grant, and no access mode can ever answer it for you."
        title="Composer holding the run for a question"
      >
        <ComposerShell
          paused
          placeholder="Pick an option above, or type a different answer"
          ribbon={<QuestionRibbon />}
        />
      </Section>

      <Section
        note="No ribbon, normal footer. This is what the composer returns to once nothing is pending."
        title="Composer at rest"
      >
        <ComposerShell placeholder="Ask anything · / skills & Waggle · @ files" ribbon={null} />
      </Section>
    </div>
  )
}
