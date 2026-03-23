import type { ExecutionMode } from '@shared/types/settings'
import { Popover } from '@/components/shared/Popover'
import { cn } from '@/lib/cn'
import { useComposerActionStore } from '@/stores/composer-action-store'
import { useComposerStore } from '@/stores/composer-store'
import { usePreferencesStore } from '@/stores/preferences-store'
import { BranchPicker } from './BranchPicker'

const EXECUTION_MODE_LABEL: Record<ExecutionMode, string> = {
  'default-permissions': 'Default permissions',
  'full-access': 'Full access',
}

interface ComposerStatusBarProps {
  onToast?: (message: string) => void
}

export function ComposerStatusBar({ onToast }: ComposerStatusBarProps) {
  const settings = usePreferencesStore((s) => s.settings)
  const setExecutionMode = usePreferencesStore((s) => s.setExecutionMode)

  const executionMenuOpen = useComposerStore((s) => s.executionMenuOpen)
  const openMenu = useComposerStore((s) => s.openMenu)
  const openActionDialog = useComposerActionStore((s) => s.openActionDialog)

  async function handleExecutionModeChange(mode: ExecutionMode): Promise<void> {
    openMenu(null)
    if (mode === settings.executionMode) return
    if (mode === 'full-access' && settings.executionMode === 'default-permissions') {
      openActionDialog('confirm-full-access')
      return
    }
    await setExecutionMode(mode)
  }

  return (
    <div className="flex items-center justify-between h-9 px-4 border-t border-border">
      <div className="flex items-center gap-1">
        <Popover
          open={executionMenuOpen}
          onOpenChange={(open) => openMenu(open ? 'execution' : null)}
          placement="top-start"
          className="min-w-[150px] py-1"
          trigger={
            <button
              type="button"
              onClick={() => openMenu(executionMenuOpen ? null : 'execution')}
              className="flex items-center gap-[5px] h-6 px-2 rounded-[5px] border border-border text-[12px] text-text-secondary transition-colors hover:bg-bg-hover"
              title="Select execution mode"
            >
              <span>{EXECUTION_MODE_LABEL[settings.executionMode]}</span>
              <span className="text-[9px] text-text-tertiary">&#x2228;</span>
            </button>
          }
        >
          {(['default-permissions', 'full-access'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                void handleExecutionModeChange(mode)
              }}
              className={cn(
                'flex w-full items-center justify-between px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-bg-hover',
                settings.executionMode === mode ? 'text-accent' : 'text-text-secondary',
              )}
            >
              <span>{EXECUTION_MODE_LABEL[mode]}</span>
              {settings.executionMode === mode && <span>•</span>}
            </button>
          ))}
        </Popover>
      </div>

      <div className="flex items-center gap-2">
        <BranchPicker onToast={onToast} />
      </div>
    </div>
  )
}
