import type { SessionId } from '@shared/types/brand'
import type {
  InlineVisualizationFrameRegisterResult,
  InlineVisualizationReference,
} from '@shared/types/inline-visualization'
import { Maximize2, X } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { unavailableVisualizationMessage } from './inline-visualization-host'
import { useInlineVisualizationFrame } from './use-inline-visualization-frame'
import { useInlineVisualizationModal } from './use-inline-visualization-modal'
import { useInlineVisualizationRegistration } from './use-inline-visualization-registration'

function VisualizationToolbar({
  expanded,
  buttonRef,
  onToggle,
}: {
  readonly expanded: boolean
  readonly buttonRef: React.RefObject<HTMLButtonElement | null>
  readonly onToggle: () => void
}) {
  const label = expanded ? 'Close expanded visualization' : 'Expand visualization'
  return (
    <div className="sticky top-0 z-10 flex justify-end border-b border-border bg-bg-secondary/95 p-1 backdrop-blur">
      <Button
        ref={buttonRef}
        variant="unstyled"
        type="button"
        aria-label={label}
        title={label}
        className="rounded-md p-1.5 text-text-tertiary hover:bg-bg-hover hover:text-text-primary"
        onClick={onToggle}
      >
        {expanded ? <X className="size-4" /> : <Maximize2 className="size-4" />}
      </Button>
    </div>
  )
}

function VisualizationContent({
  registration,
  unavailableReason,
  frameRef,
  title,
  mode,
  height,
  onLoad,
  onRetry,
}: {
  readonly registration: InlineVisualizationFrameRegisterResult | null
  readonly unavailableReason: string | null
  readonly frameRef: React.RefObject<HTMLIFrameElement | null>
  readonly title: string
  readonly mode: InlineVisualizationReference['mode']
  readonly height: number
  readonly onLoad: () => void
  readonly onRetry: () => void
}) {
  if (unavailableReason) {
    return (
      <div role="alert" className="flex min-h-40 flex-col items-start justify-center gap-3 p-4">
        <p className="text-sm text-text-secondary">
          {unavailableVisualizationMessage(unavailableReason)}
        </p>
        <Button variant="secondary" type="button" onClick={onRetry}>
          Retry visualization
        </Button>
      </div>
    )
  }
  if (!registration) {
    return (
      <div role="status" className="flex min-h-40 items-center p-4 text-sm text-text-tertiary">
        Loading visualization…
      </div>
    )
  }
  return (
    <iframe
      ref={frameRef}
      title={title}
      src={registration.frameUrl}
      sandbox="allow-scripts allow-same-origin"
      referrerPolicy="no-referrer"
      data-visualization-mode={mode ?? 'default'}
      className="block w-full border-0 bg-transparent"
      style={{ height: `${String(height)}px` }}
      onLoad={onLoad}
    />
  )
}

export function InlineVisualization({
  sessionId,
  reference,
}: {
  readonly sessionId: SessionId
  readonly reference: InlineVisualizationReference
}) {
  const title = reference.title ?? 'Interactive visualization'
  const sectionRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = useState(false)
  const dismiss = useCallback(() => setExpanded(false), [])
  const { registration, registrationError, retryRegistration } = useInlineVisualizationRegistration(
    { sectionRef, sessionId, sourcePath: reference.path },
  )
  const { frameRef, height, errorReason, handleLoad, reset } = useInlineVisualizationFrame({
    sessionId,
    frameUrl: registration?.frameUrl ?? null,
    onDismiss: dismiss,
  })

  useInlineVisualizationModal({ expanded, sectionRef, closeButtonRef })

  const retry = () => {
    reset()
    retryRegistration()
  }
  const unavailableReason = errorReason ?? (registrationError ? 'read-failed' : null)
  const accessibilityProps = expanded
    ? ({ role: 'dialog', 'aria-modal': true } as const)
    : ({ role: 'region' } as const)

  return (
    <>
      {expanded ? (
        <Button
          variant="unstyled"
          type="button"
          aria-label="Dismiss expanded visualization"
          data-visualization-backdrop="true"
          className="fixed inset-0 z-40 bg-bg/60"
          onClick={dismiss}
        />
      ) : null}
      <section
        ref={sectionRef}
        aria-label={title}
        {...accessibilityProps}
        data-visualization-path={reference.path}
        className={cn(
          'inline-visualization-surface relative left-1/2 my-3 -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-bg-secondary',
          reference.mode === 'wide' && 'inline-visualization-wide',
          expanded &&
            'inline-visualization-expanded fixed top-4 bottom-4 left-1/2 z-50 m-0 -translate-x-1/2 overflow-auto bg-bg shadow-2xl',
        )}
      >
        {reference.mode === 'wide' ? (
          <VisualizationToolbar
            expanded={expanded}
            buttonRef={closeButtonRef}
            onToggle={() => setExpanded((value) => !value)}
          />
        ) : null}
        <VisualizationContent
          registration={registration}
          unavailableReason={unavailableReason}
          frameRef={frameRef}
          title={title}
          mode={reference.mode}
          height={height}
          onLoad={handleLoad}
          onRetry={retry}
        />
      </section>
    </>
  )
}
