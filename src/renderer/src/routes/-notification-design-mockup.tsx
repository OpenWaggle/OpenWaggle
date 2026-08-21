import { AlertTriangle, Bell, ChevronDown, Info, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'

/**
 * MOCKUP — static picture of the agreed notification and approval design.
 *
 * Nothing here works. No timers, no IPC, no state. It exists so the layout decision can be
 * looked at rather than described, and it should be deleted once the real components land.
 *
 * The decisions it shows, all recorded in CONTEXT.md:
 *  - Agent notifications float in a corner stack, clear of the composer, most severe in front.
 *  - The composer area is reserved for requests that hold the run, so whatever needs an answer
 *    is always the thing nearest the prompt input.
 *  - An approval reads as an eyebrow, a plain-language sentence, a queue counter, and the raw
 *    payload in a capped monospace box that never becomes the label.
 */

function MockTranscript() {
  return (
    <div className="mx-auto w-full max-w-[720px] space-y-6 px-12 py-8">
      <div className="flex justify-end">
        <div className="max-w-[78%] rounded-2xl rounded-br-md bg-bg-tertiary px-4 py-3 text-[13px] leading-5 text-text-primary">
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
        <div className="mt-2 flex items-center gap-2 text-[11px] text-text-muted">
          <span className="size-1.5 rounded-full bg-text-muted/55" />
          Listed 24 open issues
        </div>
      </div>
      <div className="rounded-lg border border-border/70 bg-bg-secondary/40 px-3 py-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-text-muted">
          Warning notification
        </p>
        <p className="mt-1 text-[12px] leading-5 text-text-secondary">
          Rate limit for api.github.com is nearly exhausted. 8 requests remain.
        </p>
      </div>
    </div>
  )
}

/** Corner stack. Three notices, most severe in front, the rest peeking below it. */
function MockNotificationStack() {
  return (
    <div className="pointer-events-none absolute top-6 right-6 z-40 w-90">
      <div className="relative">
        <div className="absolute inset-x-0 top-0 translate-y-4 scale-[0.94] rounded-lg border border-border/60 bg-bg-secondary px-4 py-3 shadow-lg shadow-black/40">
          <div className="h-24" />
        </div>
        <div className="absolute inset-x-0 top-0 translate-y-2 scale-[0.97] rounded-lg border border-warning/25 bg-bg-secondary px-4 py-3 shadow-lg shadow-black/40">
          <div className="h-24" />
        </div>

        <div className="relative rounded-lg border border-error/40 bg-error/12 px-4 py-3 shadow-2xl shadow-black/60 backdrop-blur-sm">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-error" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-text-muted">
                Error notification
              </p>
              <p className="mt-1 text-[12px] leading-5 text-text-secondary">
                GitHub Issues could not reach api.github.com. The request timed out.
              </p>
              <p className="mt-1.5 text-[11px] text-text-muted">Stays until you dismiss it</p>
            </div>
            <X className="mt-0.5 size-3.5 shrink-0 text-text-muted" />
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end gap-1.5 pr-1 text-[10px] text-text-muted">
        <ChevronDown className="size-3" />
        Hover to expand. 2 more behind
      </div>
    </div>
  )
}

/** What an expanded, non-severe stack looks like. Shown side by side for comparison only. */
function MockNotificationStackExpanded() {
  const notices = [
    {
      icon: Bell,
      tone: 'border-warning/30 bg-warning/10',
      iconTone: 'text-warning',
      label: 'Warning notification',
      body: 'Rate limit for api.github.com is nearly exhausted. 8 requests remain.',
      life: 'Leaves after 5 seconds of focused time',
    },
    {
      icon: Info,
      tone: 'border-accent/25 bg-bg-secondary/95',
      iconTone: 'text-accent',
      label: 'Notification',
      body: 'Ponytail loaded: full',
      life: 'Leaves after 5 seconds of focused time. No chat history',
    },
  ]

  return (
    <div className="w-90 space-y-2">
      {notices.map((notice) => (
        <div
          className={`rounded-lg border px-4 py-3 shadow-xl shadow-black/25 ${notice.tone}`}
          key={notice.label}
        >
          <div className="flex items-start gap-2.5">
            <notice.icon className={`mt-0.5 size-4 shrink-0 ${notice.iconTone}`} />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-text-muted">
                {notice.label}
              </p>
              <p className="mt-1 text-[12px] leading-5 text-text-secondary">{notice.body}</p>
              <p className="mt-1.5 text-[11px] text-text-muted">{notice.life}</p>
            </div>
            <X className="mt-0.5 size-3.5 shrink-0 text-text-muted" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Docked to the composer, because it holds the run until answered. */
function MockApprovalPanel() {
  return (
    <div className="rounded-t-xl border border-b-0 border-border bg-bg-secondary/60 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-text-muted">
          Pending approval
        </span>
        <span className="text-[13px] font-medium text-text-primary">
          GitHub Issues wants to connect to api.github.com
        </span>
        <span className="ml-auto rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] tabular-nums text-text-tertiary">
          1/2
        </span>
      </div>

      <p className="mt-2 text-[12px] leading-5 text-text-secondary">
        It will read issues for this project. Nothing is written.
      </p>

      <div className="mt-3 rounded-lg border border-border/65 bg-bg/70 p-3">
        <p className="text-[11px] font-medium text-text-muted">Request details</p>
        <pre className="mt-2 max-h-40 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-text-secondary">
          {`Server: github-issues
Tool: List issues (list_issues)
Arguments: {
  "repo": "OpenWaggle/OpenWaggle",
  "state": "open"
}`}
        </pre>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary">
          Allow once
        </Button>
        <Button size="sm" variant="secondary">
          Allow…
        </Button>
        <Button size="sm" variant="ghost">
          Continue without
        </Button>
      </div>
    </div>
  )
}

function MockComposer() {
  return (
    <div className="mx-auto w-full max-w-[720px] px-5 pb-5">
      <MockApprovalPanel />
      <div className="rounded-b-xl rounded-t-none border border-border bg-bg-secondary px-4 py-3">
        <p className="text-[13px] text-text-muted">Ask for follow-up changes</p>
        <div className="mt-6 flex items-center gap-2 text-[11px] text-text-tertiary">
          <span className="rounded border border-border px-1.5 py-0.5">YOLO (Full access) ∨</span>
          <span className="rounded border border-border px-1.5 py-0.5">main ∨</span>
          <span className="ml-auto">Extension status widgets sit here, once per run</span>
        </div>
      </div>
    </div>
  )
}

function MockupNote({ children }: { readonly children: string }) {
  return (
    <p className="mx-auto max-w-[720px] px-5 text-[11px] leading-5 text-text-muted">{children}</p>
  )
}

export function NotificationDesignMockup() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-auto bg-bg">
      <div className="border-b border-border bg-bg-secondary/40 px-5 py-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-text-muted">
          Mockup, not functional
        </p>
        <p className="mt-1 text-[12px] text-text-secondary">
          Notification and approval layout, following the T3 Code split.
        </p>
      </div>

      <div className="relative flex-1">
        <MockTranscript />
        <MockComposer />
        <MockNotificationStack />
      </div>

      <div className="space-y-3 border-t border-border py-5">
        <MockupNote>
          Above: the collapsed corner stack. The error is in front because it outranks the two
          behind it, and it carries no timer. Hovering expands the stack to this:
        </MockupNote>
        <div className="mx-auto max-w-[720px] px-5">
          <MockNotificationStackExpanded />
        </div>
        <MockupNote>
          Nothing in the corner can be answered, so nothing in the corner blocks the run. The
          warning also left one row in the chat above. The informational notice left none.
        </MockupNote>
      </div>
    </div>
  )
}
