import { Maximize2, Minimize2 } from 'lucide-react'
import { useRightPanelMaximizeStore } from '@/shared/lib/right-panel-maximize'
import { Button } from './Button'

/** Maximize or restore the Right panel; rendered by every surface header (ADR 0043). */
export function RightPanelMaximizeButton() {
  const target = useRightPanelMaximizeStore((state) => state.target)
  if (target === null) return null
  const label = target.maximized ? 'Restore panel' : 'Maximize panel'
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      aria-pressed={target.maximized}
      title={target.shortcutLabel ? `${label} (${target.shortcutLabel})` : label}
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
