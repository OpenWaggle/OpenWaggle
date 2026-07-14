import { MessageSquareMore, PackageOpen } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Popover } from '@/shared/ui/Popover'

export interface ComposerExtensionActionLauncher {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly badge: string
  readonly onOpen: () => void
}

interface ComposerExtensionActionsProps {
  readonly launchers: readonly ComposerExtensionActionLauncher[]
}

export function ComposerExtensionActions({ launchers }: ComposerExtensionActionsProps) {
  const [open, setOpen] = useState(false)

  if (launchers.length === 0) {
    return null
  }

  function handleOpen(launcher: ComposerExtensionActionLauncher) {
    setOpen(false)
    launcher.onOpen()
  }

  return (
    <div className="mb-2 flex justify-end">
      <Popover
        className="w-[300px] overflow-hidden py-1"
        onOpenChange={setOpen}
        open={open}
        placement="top-end"
        trigger={
          <Button
            aria-expanded={open}
            className={cn(
              'h-7 rounded-full border px-2.5 text-[11px]',
              open
                ? 'border-accent/40 bg-accent/10 text-accent'
                : 'border-border bg-bg-secondary/80 text-text-tertiary hover:bg-bg-hover hover:text-text-secondary',
            )}
            onClick={() => setOpen(!open)}
            title="Open extension actions"
            type="button"
            variant="unstyled"
          >
            <MessageSquareMore className="size-3.5" />
            <span>Extensions</span>
            <span className="rounded-full bg-bg-tertiary px-1.5 text-[10px] text-text-muted">
              {launchers.length}
            </span>
          </Button>
        }
      >
        <div className="border-b border-border px-3 py-2">
          <div className="text-[11px] font-semibold text-text-primary">
            Composer extension launchers
          </div>
          <div className="mt-0.5 text-[10px] text-text-muted">
            Compact actions only. Extensions cannot inject composer input controls.
          </div>
        </div>
        <div className="max-h-[260px] overflow-y-auto py-1">
          {launchers.map((launcher) => (
            <Button
              align="start"
              className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] gap-2 rounded-none px-3 py-2 text-left"
              key={launcher.id}
              onClick={() => handleOpen(launcher)}
              type="button"
              variant="unstyled"
            >
              <PackageOpen className="mt-0.5 size-3.5 text-accent" />
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-medium text-text-primary">
                  {launcher.title}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-text-tertiary">
                  {launcher.description}
                </span>
              </span>
              <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-muted">
                {launcher.badge}
              </span>
            </Button>
          ))}
        </div>
      </Popover>
    </div>
  )
}
