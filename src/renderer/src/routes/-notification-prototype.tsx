import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { useEffect, useEffectEvent, useState } from 'react'
import { Button } from '@/shared/ui/Button'
import { NotificationDisplayPrototypeN1Pulse } from './-notification-display-prototype-n1-pulse'
import { NotificationDisplayPrototypeN2Shelf } from './-notification-display-prototype-n2-shelf'
import { NotificationDisplayPrototypeN3Lane } from './-notification-display-prototype-n3-lane'
import { VariantB1RunSeam } from './-notification-prototype-b1-seam'
import { VariantB2CommandPrompt } from './-notification-prototype-b2-command'
import { VariantB3DecisionRibbon } from './-notification-prototype-b3-ribbon'
import type {
  PrototypeDecision,
  PrototypeScenarioActions,
  PrototypeVariantProps,
} from './-notification-prototype-parts'
import type { NotificationPrototypeVariant } from './-route-search'

// PROTOTYPE — Composer approval and notification-display studies, switchable
// via `?variant=` on the existing chat route. Delete or absorb after the design decisions.

type ApprovalPrototypeVariant = Extract<NotificationPrototypeVariant, 'B1' | 'B2' | 'B3'>
type DisplayPrototypeVariant = Extract<NotificationPrototypeVariant, 'N1' | 'N2' | 'N3'>

interface NotificationPrototypeRouteViewProps {
  readonly variant: NotificationPrototypeVariant
  readonly onVariantChange: (variant: NotificationPrototypeVariant) => void
}

const VARIANT_LABELS: Record<NotificationPrototypeVariant, string> = {
  B1: 'Integrated seam',
  B2: 'Command surface',
  B3: 'Decision ribbon',
  N1: 'Composer run pulse',
  N2: 'Viewport notice shelf',
  N3: 'Transcript-edge lane',
}

const PREVIOUS_VARIANT: Record<NotificationPrototypeVariant, NotificationPrototypeVariant> = {
  B1: 'B3',
  B2: 'B1',
  B3: 'B2',
  N1: 'N3',
  N2: 'N1',
  N3: 'N2',
}

const NEXT_VARIANT: Record<NotificationPrototypeVariant, NotificationPrototypeVariant> = {
  B1: 'B2',
  B2: 'B3',
  B3: 'B1',
  N1: 'N2',
  N2: 'N3',
  N3: 'N1',
}

function PrototypeHeader({
  variant,
  onReset,
}: {
  readonly variant: ApprovalPrototypeVariant
  readonly onReset: () => void
}) {
  return (
    <header className="flex min-h-14 items-center justify-between gap-4 border-b border-border/60 bg-bg-secondary/55 px-6">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold tracking-[0.18em] text-accent uppercase">
            Throwaway prototype
          </span>
          <span className="text-[10px] text-text-muted">Variant {variant}</span>
        </div>
        <p className="mt-0.5 truncate text-[13px] font-medium text-text-primary">
          {VARIANT_LABELS[variant]} · composer approval study
        </p>
      </div>
      <Button
        variant="ghost"
        size="xs"
        leftIcon={<RotateCcw className="size-3" />}
        onClick={onReset}
      >
        Reset scenario
      </Button>
    </header>
  )
}

function PrototypeSwitcher({
  variant,
  onVariantChange,
}: {
  readonly variant: NotificationPrototypeVariant
  readonly onVariantChange: (variant: NotificationPrototypeVariant) => void
}) {
  const changeVariantFromKeyboard = useEffectEvent((key: 'ArrowLeft' | 'ArrowRight') => {
    onVariantChange(key === 'ArrowLeft' ? PREVIOUS_VARIANT[variant] : NEXT_VARIANT[variant])
  })

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, [contenteditable="true"]')
      ) {
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        changeVariantFromKeyboard(event.key)
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        changeVariantFromKeyboard(event.key)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-bg-tertiary/95 p-1 shadow-[0_12px_36px_rgba(0,0,0,0.36)] backdrop-blur">
      <Button
        aria-label="Previous prototype variant"
        variant="ghost"
        size="icon-md"
        radius="full"
        onClick={() => onVariantChange(PREVIOUS_VARIANT[variant])}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <div className="min-w-[190px] px-3 text-center">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-accent uppercase">
          Variant {variant}
        </p>
        <p className="text-[11px] text-text-secondary">{VARIANT_LABELS[variant]}</p>
      </div>
      <Button
        aria-label="Next prototype variant"
        variant="ghost"
        size="icon-md"
        radius="full"
        onClick={() => onVariantChange(NEXT_VARIANT[variant])}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  )
}

const VARIANT_COMPONENTS: Record<
  ApprovalPrototypeVariant,
  (props: PrototypeVariantProps) => React.JSX.Element
> = {
  B1: VariantB1RunSeam,
  B2: VariantB2CommandPrompt,
  B3: VariantB3DecisionRibbon,
}

const DISPLAY_VARIANT_COMPONENTS: Record<DisplayPrototypeVariant, () => React.JSX.Element> = {
  N1: NotificationDisplayPrototypeN1Pulse,
  N2: NotificationDisplayPrototypeN2Shelf,
  N3: NotificationDisplayPrototypeN3Lane,
}

function isApprovalPrototypeVariant(
  variant: NotificationPrototypeVariant,
): variant is ApprovalPrototypeVariant {
  return variant === 'B1' || variant === 'B2' || variant === 'B3'
}

export function NotificationPrototypeRouteView({
  variant,
  onVariantChange,
}: NotificationPrototypeRouteViewProps) {
  const [decision, setDecision] = useState<PrototypeDecision>('pending')
  const [infoVisible, setInfoVisible] = useState(true)

  if (!isApprovalPrototypeVariant(variant)) {
    const DisplayVariant = DISPLAY_VARIANT_COMPONENTS[variant]
    return (
      <>
        <DisplayVariant />
        <PrototypeSwitcher variant={variant} onVariantChange={onVariantChange} />
      </>
    )
  }

  const Variant = VARIANT_COMPONENTS[variant]
  const scenario = { decision, infoVisible }
  const actions: PrototypeScenarioActions = {
    approveOnce: () => setDecision('approved-once'),
    approveSession: () => setDecision('approved-session'),
    decline: () => setDecision('declined'),
    cancel: () => setDecision('cancelled'),
    dismissInfo: () => setInfoVisible(false),
    reset: () => {
      setDecision('pending')
      setInfoVisible(true)
    },
  }

  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-bg">
      <PrototypeHeader variant={variant} onReset={actions.reset} />
      <Variant scenario={scenario} actions={actions} />
      <PrototypeSwitcher variant={variant} onVariantChange={onVariantChange} />
    </main>
  )
}
