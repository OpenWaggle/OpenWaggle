import { PanelRight, PanelRightClose } from 'lucide-react'
import { usePreferencesStore } from '@/features/settings/state'
import { toggleRightPanel } from '@/shared/lib/right-panel-surfaces'
import { formatAriaShortcutBinding, formatShortcutBinding } from '@/shared/lib/shortcut-display'
import { Button } from '@/shared/ui/Button'

/** The header's single Right panel control: shows or hides the panel (ADR 0043). */
export function RightPanelToggleButton({
  open,
  disabled,
}: {
  readonly open: boolean
  readonly disabled: boolean
}) {
  const binding = usePreferencesStore(
    (state) => state.settings.shortcutBindings['rightPanel.toggle'],
  )
  const label = open ? 'Hide right panel' : 'Show right panel'
  const title = binding ? `${label} (${formatShortcutBinding(binding)})` : label
  return (
    <Button
      variant={open ? 'subtle' : 'ghost'}
      size="none"
      radius="sm"
      aria-label={label}
      aria-pressed={open}
      aria-keyshortcuts={formatAriaShortcutBinding(binding)}
      disabled={disabled}
      className="no-drag h-7 px-1.5"
      title={title}
      onClick={toggleRightPanel}
    >
      {open ? (
        <PanelRightClose aria-hidden="true" className="size-3.5 text-text-secondary" />
      ) : (
        <PanelRight aria-hidden="true" className="size-3.5 text-text-secondary" />
      )}
    </Button>
  )
}
