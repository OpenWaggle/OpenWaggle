import type { JsonObject } from '@shared/types/json'
import { choose } from '@shared/utils/decision'
import { Check, ShieldAlert, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'
import { parseToolArgs } from '@/lib/tool-args'
import { getToolConfig } from '@/lib/tool-display'

import type { PendingApproval } from './pending-tool-interactions'

interface ApprovalBannerProps {
  toolCallId: string
  toolName: string
  toolArgs: string
  approvalId: string
  onApprovalResponse: (pendingApproval: PendingApproval, approved: boolean) => Promise<void>
}

/**
 * Format the tool arguments into a human-readable detail string.
 * Shows the most relevant info for each tool type.
 */
function formatToolDetail(toolName: string, args: JsonObject): string | null {
  return choose(toolName)
    .case('runCommand', () => (typeof args.command === 'string' ? args.command : null))
    .case('writeFile', () => (typeof args.path === 'string' ? args.path : null))
    .case('editFile', () => (typeof args.path === 'string' ? args.path : null))
    .case('readFile', () => (typeof args.path === 'string' ? args.path : null))
    .case('listFiles', () => (typeof args.path === 'string' ? args.path : null))
    .case('browserNavigate', () => (typeof args.url === 'string' ? args.url : null))
    .case('webFetch', () => (typeof args.url === 'string' ? args.url : null))
    .catchAll(() => {
      // Fall back to the primary arg from tool config
      const config = getToolConfig(toolName)
      const value = args[config.primaryArg]
      return typeof value === 'string' ? value : null
    })
}

export function ApprovalBanner({
  toolCallId,
  toolName,
  toolArgs,
  approvalId,
  onApprovalResponse,
}: ApprovalBannerProps): React.JSX.Element {
  const [loading, setLoading] = useState(false)

  const config = getToolConfig(toolName)
  const Icon = config.icon

  const parsedArgs = parseToolArgs(toolArgs)
  const detail = formatToolDetail(toolName, parsedArgs)

  function handleResponse(approved: boolean): void {
    setLoading(true)
    void onApprovalResponse(
      { approvalId, toolCallId, toolName, toolArgs, hasApprovalMetadata: true },
      approved,
    ).finally(() => {
      setLoading(false)
    })
  }

  return (
    <div className="rounded-xl border border-warning/25 bg-warning/6 px-4 py-3 space-y-2.5">
      {/* Header: icon + tool name + action buttons */}
      <div className="flex items-center gap-3">
        <ShieldAlert className="h-4 w-4 shrink-0 text-warning" />
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon className="h-3.5 w-3.5 text-text-muted shrink-0" />
          <span className="text-sm font-medium text-text-primary">{config.displayName}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-auto">
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

      {/* Detail: full command/path shown in a readable code block */}
      {detail && (
        <div className="rounded-md bg-bg/60 border border-border/50 px-3 py-2">
          <code className="text-[12.5px] text-text-secondary break-all whitespace-pre-wrap font-mono leading-relaxed">
            {detail}
          </code>
        </div>
      )}
    </div>
  )
}
