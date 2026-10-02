import { Maximize2, Minimize2 } from 'lucide-react'
import { useRightPanelMaximizeStore } from '@/shared/lib/right-panel-maximize'
import { Button } from './Button'

/** Maximize or restore the Right panel; rendered by every surface header (ADR 0043). */
export function RightPanelMaximizeButton() {
  const target = useRightPanelMaximizeStore((state) => state.target)
  if (target === null || !target.canMaximize) return null
  // A fixed name with a pressed state; the tooltip says what a click does next.
  const hint = target.maximized ? 'Restore panel' : 'Maximize panel'
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Maximize panel"
      aria-pressed={target.maximized}
      title={target.shortcutLabel ? `${hint} (${target.shortcutLabel})` : hint}
      onClick={target.toggle}
    >
      {target.maximized ? (
        <Minimize2 className="size-3.5" aria-hidden="true" />
      ) : (
        <Maximize2 className="size-3.5" aria-hidden="true" />
      )}
    </Button>
  )
}
