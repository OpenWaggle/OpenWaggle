import { Check, ShieldAlert, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { getToolConfig, getToolSummary } from '@/lib/tool-display'

interface ApprovalBannerProps {
  toolName: string
  toolArgs: string
  approvalId: string
  onApprovalResponse: (approvalId: string, approved: boolean) => Promise<void>
}

export function ApprovalBanner({
  toolName,
  toolArgs,
  approvalId,
  onApprovalResponse,
}: ApprovalBannerProps): React.JSX.Element {
  const [loading, setLoading] = useState(false)

  const config = getToolConfig(toolName)
  const Icon = config.icon

  let parsedArgs: Record<string, unknown> = {}
  try {
    parsedArgs = JSON.parse(toolArgs)
  } catch {
    // keep empty
  }

  const summary = getToolSummary(toolName, parsedArgs)

  function handleResponse(approved: boolean): void {
    setLoading(true)
    void onApprovalResponse(approvalId, approved).finally(() => {
      setLoading(false)
    })
  }

  return (
    <div className="rounded-xl border border-warning/25 bg-warning/6 px-4 py-3">
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-4 w-4 shrink-0 text-warning" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-sm text-text-primary">
            <Icon className="h-3.5 w-3.5 text-text-muted shrink-0" />
            <span className="font-medium">{config.displayName}</span>
            {summary && (
              <span className="truncate text-text-tertiary font-mono text-[13px]">{summary}</span>
            )}
          </div>
          <p className="text-[13px] text-text-tertiary mt-0.5">
            This action requires your approval before proceeding.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            disabled={loading}
            onClick={() => handleResponse(false)}
            className={cn(
              'flex items-center gap-1 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors',
              'bg-error/15 text-error hover:bg-error/25 disabled:opacity-50',
            )}
          >
            <X className="h-3 w-3" />
            Deny
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => handleResponse(true)}
            className={cn(
              'flex items-center gap-1 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors',
              'bg-success/15 text-success hover:bg-success/25 disabled:opacity-50',
            )}
          >
            <Check className="h-3 w-3" />
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}
