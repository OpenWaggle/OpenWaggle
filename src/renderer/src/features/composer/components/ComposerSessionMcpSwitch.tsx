import { Check, Plug } from 'lucide-react'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { DENSE_MENU_ITEM_CLASS, MENU_SECTION_LABEL_CLASS } from '@/shared/ui/menu-styles'
import { useSessionMcpSwitch } from '../hooks/useSessionMcpSwitch'

/** The + menu's switch for whether this Session's Runs use the configured MCP servers. */
export function ComposerSessionMcpSwitch({ sessionId }: { readonly sessionId: string }) {
  const mcp = useSessionMcpSwitch(sessionId)
  return (
    <>
      <div className="my-1 border-t border-border-light" />
      <div className={MENU_SECTION_LABEL_CLASS}>This Session</div>
      <Button
        className={DENSE_MENU_ITEM_CLASS}
        fullWidth
        role="menuitemcheckbox"
        aria-checked={mcp.enabled}
        disabled={mcp.pending}
        leftIcon={<Plug aria-hidden="true" className="size-4 text-text-tertiary" />}
        rightIcon={
          <Check
            aria-hidden="true"
            className={cn('size-3.5 text-accent', !mcp.enabled && 'invisible')}
          />
        }
        onClick={() => mcp.setEnabled(!mcp.enabled)}
        variant="row"
      >
        <span className="flex min-w-0 flex-col items-start">
          <span className="text-sm font-medium text-text-primary">Use MCP servers</span>
          <span className="text-xs font-normal text-text-tertiary">
            {mcp.enabled
              ? 'Runs reach the MCP servers configured for this project'
              : 'Off: this Session starts no MCP servers'}
          </span>
        </span>
      </Button>
    </>
  )
}
