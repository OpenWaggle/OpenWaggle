import type { AgentAuthorizationScopeKey } from '@shared/types/agent-authorization-grants'
import type {
  AgentLoopConfirmInteraction,
  AgentLoopInteractionResponse,
} from '@shared/types/agent-loop-interaction'
import { ChevronDown, LockKeyhole } from 'lucide-react'
import { type FocusEvent, type KeyboardEvent, useRef, useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { PlainTextBlock } from '@/shared/ui/PlainTextBlock'
import { allowScopeChoices, ribbonTargetLine } from '../lib/agent-authorization-ribbon-model'
import { restoreFocusBeforeRequest } from '../lib/pending-request-focus'
import { useChatDisplayText } from './ChatDisplayPathContext'

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
  const requester = useChatDisplayText(scopeKey.requester)
  const title = useChatDisplayText(interaction.title)
  const targetLine = useChatDisplayText(ribbonTargetLine(scopeKey))
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <LockKeyhole className="size-3.5 shrink-0 text-accent" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold tracking-widest text-accent uppercase">
            Needs decision
          </span>
          <span className="rounded bg-bg-tertiary px-1.5 py-0.5 font-mono text-xs text-text-tertiary">
            {requester}
          </span>
          {queuedCount > 0 ? (
            <span className="text-xs text-text-muted tabular-nums">1/{queuedCount + 1}</span>
          ) : null}
        </div>
        <p
          className="mt-0.5 truncate text-xs font-medium text-text-primary"
          id={`authorization-${interaction.interactionId}`}
        >
          {title}
        </p>
        <p className="mt-0.5 truncate text-xs text-text-muted">{targetLine}</p>
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
  const containerRef = useRef<HTMLDivElement>(null)

  // Escape closes the menu and stops there, so the section handler does not also return the caret on
  // the same keystroke. Without this the menu stayed mounted, floating over the transcript with
  // "Always allow…" armed, while focus moved back to the composer: one stray click away from writing
  // a persistent grant, which is the exact thing holding the scopes behind `Allow…` was meant to
  // prevent.
  function closeOnEscape(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'Escape' || !open) return
    event.stopPropagation()
    setOpen(false)
  }

  // Handlers sit on the controls rather than a wrapping div so the menu closes whenever focus
  // genuinely leaves it, including a click elsewhere on the page.
  function closeOnBlur(event: FocusEvent<HTMLButtonElement>) {
    if (containerRef.current?.contains(event.relatedTarget)) return
    setOpen(false)
  }

  return (
    <div className="relative" ref={containerRef}>
      <Button
        aria-expanded={open}
        disabled={busy}
        onBlur={closeOnBlur}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={closeOnEscape}
        size="xs"
        variant="secondary"
      >
        <span className="inline-flex items-center gap-1">
          Allow…
          <ChevronDown className="size-3" />
        </span>
      </Button>
      {open ? (
        // A group of buttons, not `role="menu"`. Declaring the ARIA menu pattern without arrow-key
        // navigation or a focus move into the menu told screen-reader users a menu had opened and
        // then gave them none of the behaviour it promises.
        <fieldset
          className="absolute right-0 bottom-full z-20 mb-1 w-max max-w-80 overflow-hidden rounded-lg border border-border bg-bg-secondary shadow-xl shadow-bg/40"
          disabled={busy}
        >
          <legend className="sr-only">Approval scope</legend>
          {allowScopeChoices(scopeKey, projectName).map((choice) => (
            <Button
              align="start"
              className="w-full rounded-none px-3 py-2 text-left text-xs"
              disabled={busy}
              key={choice.scope}
              onBlur={closeOnBlur}
              onClick={() => {
                setOpen(false)
                submit({ kind: 'confirm', accepted: true, scope: choice.scope })
              }}
              onKeyDown={closeOnEscape}
              variant="ghost"
            >
              {choice.label}
            </Button>
          ))}
        </fieldset>
      ) : null}
    </div>
  )
}

function RibbonDetails({ message }: { readonly message: string }) {
  const [open, setOpen] = useState(false)
  const displayMessage = useChatDisplayText(message)

  return (
    <>
      <Button
        aria-expanded={open}
        className="mt-2 gap-1 text-xs text-text-muted"
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
          <PlainTextBlock reason="prose" className="max-h-40 max-w-full min-w-0 bg-transparent p-0">
            {displayMessage}
          </PlainTextBlock>
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
  const displayError = useChatDisplayText(error ?? '')
  return (
    <section
      aria-labelledby={`authorization-${interaction.interactionId}`}
      // No `aria-live` here: this section is mounted together with its content, so a live region on
      // it announces nothing. `PoliteAnnouncer` carries the announcement from a region that is
      // always present.
      className="border-b border-border/60 px-4 py-2.5"
      data-authorization-ribbon="true"
      data-request-ribbon="true"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        restoreFocusBeforeRequest()
      }}
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

      {displayError ? (
        <p className="mt-2 text-xs leading-5 text-error" role="alert">
          {displayError}
        </p>
      ) : null}
    </section>
  )
}
