import { AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { type MouseEvent, useEffect, useId, useRef } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import {
  type DesktopNativeAdmissionNotice as Notice,
  useDesktopNativeAdmissionStore,
} from './desktop-native-admission-store'

const NOT_RECOVERABLE_MESSAGE = 'Desktop tools are paused and cannot be recovered from this window.'
const UNREADABLE_MESSAGE =
  'Could not read desktop ownership status. Native actions may be unavailable; try reopening OpenWaggle.'
const RECOVERED_MESSAGE =
  'Desktop tools recovered. Terminals, browser previews, and archiving are available again.'

interface DesktopNativeAdmissionNoticeProps {
  /** Settings has no app header and its own title bar under the window controls. */
  readonly placement: 'top' | 'bottom'
}

/**
 * Persistent notice for quarantined desktop tools with the user-attested recovery (ADR 0049).
 * It cannot be dismissed while quarantined: it is the only way to lift the quarantine.
 */
export function DesktopNativeAdmissionNotice({ placement }: DesktopNativeAdmissionNoticeProps) {
  const notice = useDesktopNativeAdmissionStore((state) => state.notice)
  const recover = useDesktopNativeAdmissionStore((state) => state.recover)
  const dismiss = useDesktopNativeAdmissionStore((state) => state.dismiss)
  const { regionRef, dismissRef, trackRecoverFocus, releaseFocus } = useNoticeFocus(notice)
  const failureId = useId()

  function chooseRecover(event: MouseEvent<HTMLButtonElement>) {
    trackRecoverFocus(event.currentTarget)
    recover()
  }

  function chooseDismiss(event: MouseEvent<HTMLButtonElement>) {
    // Only a keyboard activation (detail 0) needs focus handed on; a pointer user would only see
    // the page scroll to wherever the neighbouring control is.
    if (event.detail === 0) releaseFocus(event.currentTarget)
    dismiss()
  }

  if (notice.kind === 'hidden') return null
  const quarantined = notice.kind === 'quarantined' ? notice : null
  const recovered = notice.kind === 'recovered'
  const Icon = recovered ? CheckCircle2 : AlertTriangle

  return (
    <section
      ref={regionRef}
      aria-label="Desktop tools status"
      aria-describedby={quarantined?.failure ? failureId : undefined}
      tabIndex={-1}
      className={cn(
        'flex shrink-0 items-start gap-3 px-4 py-2.5 text-sm',
        recovered
          ? 'border-success/30 bg-success/8 text-text-secondary'
          : 'border-error/30 bg-error/8 text-error-text',
        placement === 'top' ? 'border-b' : 'border-t',
      )}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      {/* The action sits under the text on the left, clear of toasts at the top right. */}
      <div className="min-w-0 flex-1 space-y-1.5">
        {/* A live region that exists before the outcome, so the confirmation is announced. */}
        <p aria-live="polite" className="break-words">
          {noticeMessage(notice)}
        </p>
        {quarantined?.failure ? (
          <p id={failureId} role="alert" className="break-words font-medium">
            {quarantined.failure}
          </p>
        ) : null}
        {quarantined?.recoverable ? (
          <Button
            variant="danger"
            size="xs"
            radius="md"
            aria-disabled={quarantined.recovering}
            aria-busy={quarantined.recovering}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            onClick={chooseRecover}
          >
            {quarantined.recovering ? 'Recovering…' : 'Recover desktop tools'}
          </Button>
        ) : null}
      </div>
      {quarantined ? null : (
        <Button
          ref={dismissRef}
          variant="ghost"
          size="icon-xs"
          radius="sm"
          align="center"
          aria-label="Dismiss desktop tools notice"
          onClick={chooseDismiss}
        >
          <X aria-hidden="true" className="size-3.5" />
        </Button>
      )}
    </section>
  )
}

function noticeMessage(notice: Exclude<Notice, { kind: 'hidden' }>) {
  if (notice.kind === 'recovered') return RECOVERED_MESSAGE
  if (notice.kind === 'unreadable') return UNREADABLE_MESSAGE
  return notice.recoverable ? notice.issue : NOT_RECOVERABLE_MESSAGE
}

/** Keep keyboard focus in the notice only when an outcome removes the Recover button that had it. */
function useNoticeFocus(notice: Notice) {
  const regionRef = useRef<HTMLElement>(null)
  const dismissRef = useRef<HTMLButtonElement>(null)
  const actionHadFocus = useRef(false)
  const actionGone =
    notice.kind === 'recovered' || (notice.kind === 'quarantined' && !notice.recoverable)

  useEffect(() => {
    if (!actionGone || !actionHadFocus.current) return
    actionHadFocus.current = false
    if (document.activeElement !== document.body) return
    const target = dismissRef.current ?? regionRef.current
    target?.focus()
  }, [actionGone])

  return {
    regionRef,
    dismissRef,
    trackRecoverFocus: (button: HTMLButtonElement) => {
      actionHadFocus.current = document.activeElement === button
    },
    /** The notice is about to unmount: hand focus to a neighbour instead of the document. */
    releaseFocus: (button: HTMLButtonElement) => {
      if (document.activeElement === button && regionRef.current) focusNeighbour(regionRef.current)
    },
  }
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])'

/**
 * The nearest usable control after the notice, else before it, searched within the shell column
 * first: in Settings the notice is last there, and what follows it, such as toasts or the inert
 * sidebar, is not a sensible target. Stops only once focus has actually moved.
 */
function focusNeighbour(region: HTMLElement) {
  for (const root of [region.parentElement, document.body]) {
    if (root && focusNeighbourWithin(root, region)) return
  }
}

function focusNeighbourWithin(root: HTMLElement, region: HTMLElement) {
  const usable = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) =>
      !region.contains(element) &&
      element.closest('[inert], [aria-hidden="true"], [hidden]') === null,
  )
  const follows = (element: HTMLElement) =>
    Boolean(region.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)
  const ordered = [
    ...usable.filter(follows),
    ...usable.filter((element) => !follows(element)).reverse(),
  ]
  return ordered.some((element) => {
    element.focus()
    return document.activeElement === element
  })
}
