import type { SessionId } from '@shared/types/brand'
import type {
  InlineVisualizationFrameRegisterResult,
  InlineVisualizationReference,
} from '@shared/types/inline-visualization'
import type { JsonValue } from '@shared/types/json'
import { Maximize2, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import {
  clearInlineVisualizationState,
  reportInlineVisualizationState,
} from '../state/inline-visualization-state'
import { unavailableVisualizationMessage } from './inline-visualization-host'
import { useInlineVisualizationFocusLayer } from './use-inline-visualization-focus-layer'
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
      <div
        role="status"
        className="flex min-h-40 items-center p-4 text-sm text-text-tertiary"
        style={{ height: `${String(height)}px` }}
      >
        Loading visualization…
      </div>
    )
  }
  return (
    <iframe
      ref={frameRef}
      title={title}
      sandbox="allow-scripts allow-same-origin"
      referrerPolicy="no-referrer"
      data-visualization-mode={mode ?? 'default'}
      className="block w-full border-0 bg-transparent"
      style={{ height: `${String(height)}px` }}
      onLoad={onLoad}
    />
  )
}

function VisualizationSurface({
  expanded,
  mode,
  sectionRef,
  title,
  sourcePath,
  onDismiss,
  children,
}: {
  readonly expanded: boolean
  readonly mode: InlineVisualizationReference['mode']
  readonly sectionRef: React.RefObject<HTMLElement | null>
  readonly title: string
  readonly sourcePath: string
  readonly onDismiss: () => void
  readonly children: React.ReactNode
}) {
  const accessibilityProps = expanded
    ? ({ role: 'dialog', 'aria-modal': true } as const)
    : ({ role: 'region' } as const)
  return (
    <section
      ref={sectionRef}
      aria-label={title}
      {...accessibilityProps}
      data-visualization-path={sourcePath}
      data-visualization-focus-layer={expanded ? 'true' : undefined}
      className={cn(
        'inline-visualization-surface overflow-hidden bg-bg-secondary p-0 text-text-primary',
        !expanded && 'relative left-1/2 mx-0 my-3 -translate-x-1/2 rounded-lg border border-border',
        !expanded && mode === 'wide' && 'inline-visualization-wide',
        expanded &&
          'inline-visualization-expanded fixed inset-0 z-[80] m-0 h-dvh w-screen max-w-none overflow-hidden rounded-none border-0 bg-bg/60 backdrop-blur-[2px]',
      )}
    >
      {expanded ? (
        <Button
          variant="unstyled"
          type="button"
          aria-label="Dismiss expanded visualization"
          className="absolute inset-0 cursor-default"
          onClick={onDismiss}
        />
      ) : null}
      {children}
    </section>
  )
}

export function InlineVisualization({
  sessionId,
  interactionSessionId,
  reference,
}: {
  readonly sessionId: SessionId
  readonly interactionSessionId: SessionId | null
  readonly reference: InlineVisualizationReference
}) {
  const title = reference.title ?? 'Interactive visualization'
  const sectionRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [stateInstanceId] = useState(() => crypto.randomUUID())
  const stateScope = `${interactionSessionId ?? ''}\u0000${reference.path}\u0000${title}`
  const { expanded, expand, dismiss } = useInlineVisualizationFocusLayer(sectionRef)
  const { registration, registrationError, releaseRegistration, retryRegistration } =
    useInlineVisualizationRegistration({
      sectionRef,
      sessionId,
      sourcePath: reference.path,
    })
  const handleStateChange = useCallback(
    (state: JsonValue | null) => {
      clearInlineVisualizationState(stateInstanceId)
      if (state === null || interactionSessionId === null) return
      reportInlineVisualizationState({
        instanceId: stateInstanceId,
        sessionId: interactionSessionId,
        sourcePath: reference.path,
        title,
        state,
      })
    },
    [interactionSessionId, reference.path, stateInstanceId, title],
  )
  const handleUnavailable = useCallback(() => {
    clearInlineVisualizationState(stateInstanceId)
    releaseRegistration()
  }, [releaseRegistration, stateInstanceId])
  const { frameRef, height, errorReason, handleLoad, reset } = useInlineVisualizationFrame({
    interactionSessionId,
    frameUrl: registration?.frameUrl ?? null,
    registrationId: registration?.registrationId ?? null,
    onDismiss: dismiss,
    onUnavailable: handleUnavailable,
    onStateChange: handleStateChange,
  })

  useEffect(() => {
    if (stateScope.length > 0) clearInlineVisualizationState(stateInstanceId)
    return () => clearInlineVisualizationState(stateInstanceId)
  }, [stateInstanceId, stateScope])

  useEffect(() => {
    if (!registration) clearInlineVisualizationState(stateInstanceId)
  }, [registration, stateInstanceId])

  useInlineVisualizationModal({ expanded, sectionRef, closeButtonRef, onDismiss: dismiss })

  const retry = () => {
    clearInlineVisualizationState(stateInstanceId)
    reset()
    retryRegistration()
  }
  const unavailableReason = errorReason ?? (registrationError ? 'read-failed' : null)

  return (
    <VisualizationSurface
      expanded={expanded}
      mode={reference.mode}
      sectionRef={sectionRef}
      title={title}
      sourcePath={reference.path}
      onDismiss={dismiss}
    >
      <div
        className={cn(
          'contents',
          expanded &&
            'absolute inset-2 block overflow-auto rounded-xl border border-border bg-bg shadow-2xl sm:inset-4',
        )}
      >
        {reference.mode === 'wide' ? (
          <VisualizationToolbar
            expanded={expanded}
            buttonRef={closeButtonRef}
            onToggle={expanded ? dismiss : expand}
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
      </div>
    </VisualizationSurface>
  )
}
