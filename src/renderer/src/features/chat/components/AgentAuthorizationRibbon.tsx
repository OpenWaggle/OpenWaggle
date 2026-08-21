import type { AgentAuthorizationScopeKey } from '@shared/types/agent-authorization-grants'
import type {
  AgentLoopConfirmInteraction,
  AgentLoopInteractionResponse,
} from '@shared/types/agent-loop-interaction'
import { ChevronDown, LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { allowScopeChoices, ribbonTargetLine } from '../lib/agent-authorization-ribbon-model'

/**
 * The decision row for an authorization request.
 *
 * One compact row rather than a card, which is prototype B3, chosen from a screenshot. It is added
 * above the composer and changes nothing about it: the draft, the caret, the placeholder, the
 * enabled state and the Enter key all survive its arrival, so a sentence in progress can be
 * finished and sent either before or after deciding.
 *
 * `Allow…` holds the scopes rather than putting them in the button row, so a standing approval is
 * never one stray click away and always states what it covers.
 */
function RibbonIdentity({
  interaction,
  scopeKey,
  queuedCount,
}: {
  readonly interaction: AgentLoopConfirmInteraction
  readonly scopeKey: AgentAuthorizationScopeKey
  readonly queuedCount: number
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <LockKeyhole className="size-3.5 shrink-0 text-accent" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold tracking-[0.14em] text-accent uppercase">
            Needs decision
          </span>
          <span className="rounded bg-bg-tertiary px-1.5 py-0.5 font-mono text-[10px] text-text-tertiary">
            {scopeKey.requester}
          </span>
          {queuedCount > 0 ? (
            <span className="text-[10px] text-text-muted tabular-nums">1/{queuedCount + 1}</span>
          ) : null}
        </div>
        <p
          className="mt-0.5 truncate text-[12px] font-medium text-text-primary"
          id={`authorization-${interaction.interactionId}`}
        >
          {interaction.title}
        </p>
        <p className="mt-0.5 truncate text-[10px] text-text-muted">{ribbonTargetLine(scopeKey)}</p>
      </div>
    </div>
  )
}

function AllowScopeMenu({
  scopeKey,
  projectName,
  busy,
  submit,
}: {
  readonly scopeKey: AgentAuthorizationScopeKey
  readonly projectName: string | null
  readonly busy: boolean
  readonly submit: (response: AgentLoopInteractionResponse) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <Button
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={busy}
        onClick={() => setOpen((current) => !current)}
        size="xs"
        variant="secondary"
      >
        <span className="inline-flex items-center gap-1">
          Allow…
          <ChevronDown className="size-3" />
        </span>
      </Button>
      {open ? (
        <div
          className="absolute right-0 bottom-full z-20 mb-1 w-max max-w-80 overflow-hidden rounded-lg border border-border bg-bg-secondary shadow-xl shadow-black/40"
          role="menu"
        >
          {allowScopeChoices(scopeKey, projectName).map((choice) => (
            <Button
              align="start"
              className="w-full rounded-none px-3 py-2 text-left text-[11px]"
              disabled={busy}
              key={choice.scope}
              onClick={() => {
                setOpen(false)
                submit({ kind: 'confirm', accepted: true, scope: choice.scope })
              }}
              role="menuitem"
              variant="ghost"
            >
              {choice.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function RibbonDetails({ message }: { readonly message: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        aria-expanded={open}
        className="mt-2 gap-1 text-[10px] text-text-muted"
        onClick={() => setOpen((current) => !current)}
        size="xs"
        variant="ghost"
      >
        <ChevronDown className={`size-3 ${open ? '' : '-rotate-90'}`} />
        Details
      </Button>
      {open ? (
        <div className="mt-2 max-w-full min-w-0 rounded-lg border border-border/65 bg-bg/70 p-3">
          {/* The payload lives here, never in the label. Pre-wrapped because every consent body is
              built as several lines, and capped so a large one scrolls instead of pushing the
              composer off screen. */}
          <pre className="max-h-40 max-w-full min-w-0 overflow-auto font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-text-secondary [overflow-wrap:anywhere]">
            {message}
          </pre>
        </div>
      ) : null}
    </>
  )
}

export function AgentAuthorizationRibbon({
  interaction,
  scopeKey,
  projectName,
  queuedCount,
  busy,
  error,
  submit,
}: {
  readonly interaction: AgentLoopConfirmInteraction
  readonly scopeKey: AgentAuthorizationScopeKey
  readonly projectName: string | null
  readonly queuedCount: number
  readonly busy: boolean
  readonly error: string | null
  readonly submit: (response: AgentLoopInteractionResponse) => void
}) {
  return (
    <section
      aria-labelledby={`authorization-${interaction.interactionId}`}
      className="border-b border-border/60 px-4 py-2.5"
      data-authorization-ribbon="true"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <RibbonIdentity interaction={interaction} queuedCount={queuedCount} scopeKey={scopeKey} />
        <div className="flex items-center gap-2">
          <Button
            disabled={busy}
            onClick={() => submit({ kind: 'confirm', accepted: false })}
            size="xs"
            variant="ghost"
          >
            Continue without
          </Button>
          <AllowScopeMenu
            busy={busy}
            projectName={projectName}
            scopeKey={scopeKey}
            submit={submit}
          />
          <Button
            disabled={busy}
            onClick={() => submit({ kind: 'confirm', accepted: true })}
            size="xs"
            variant="accent"
          >
            Allow once
          </Button>
        </div>
      </div>

      {interaction.message ? <RibbonDetails message={interaction.message} /> : null}

      {error ? (
        <p className="mt-2 text-[11px] leading-5 text-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  )
}
