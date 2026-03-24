import type { JsonObject } from '@shared/types/json'
import { isApprovalRequiredToolName } from '@shared/types/tool-approval'
import { choose } from '@shared/utils/decision'
import { deriveCommandPattern, deriveWebFetchPattern } from '@shared/utils/tool-trust-patterns'
import { Check, CheckCheck, ShieldAlert, X } from 'lucide-react'
import { useState } from 'react'
import { parseToolArgs } from '@/lib/tool-args'
import { getToolConfig } from '@/lib/tool-display'

import { ApprovalButton } from './ApprovalButton'
import type { ApprovalResponseAction, PendingApproval } from './pending-tool-interactions'

interface ApprovalBannerProps {
  toolCallId: string
  toolName: string
  toolArgs: string
  approvalId: string
  onApprovalResponse: (
    pendingApproval: PendingApproval,
    response: ApprovalResponseAction,
  ) => Promise<void>
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

function deriveTrustPatternLabel(toolName: string, detail: string | null): string | null {
  if (toolName === 'runCommand' && detail) {
    return deriveCommandPattern(detail)
  }

  if (toolName === 'webFetch' && detail) {
    return deriveWebFetchPattern(detail)
  }

  const config = getToolConfig(toolName)
  return `All ${config.displayName} operations`
}

export function ApprovalBanner({
  toolCallId,
  toolName,
  toolArgs,
  approvalId,
  onApprovalResponse,
}: ApprovalBannerProps) {
  const [loading, setLoading] = useState(false)

  const config = getToolConfig(toolName)
  const Icon = config.icon

  const parsedArgs = parseToolArgs(toolArgs)
  const detail = formatToolDetail(toolName, parsedArgs)
  const canTrust = isApprovalRequiredToolName(toolName)
  const trustPatternLabel = canTrust ? deriveTrustPatternLabel(toolName, detail) : null

  function handleResponse(response: ApprovalResponseAction): void {
    setLoading(true)
    void onApprovalResponse(
      { approvalId, toolCallId, toolName, toolArgs, hasApprovalMetadata: true },
      response,
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
          <ApprovalButton
            icon={X}
            label="Deny"
            variant="deny"
            disabled={loading}
            onClick={() => handleResponse({ kind: 'deny' })}
          />
          <ApprovalButton
            icon={Check}
            label="Approve"
            variant="approve"
            disabled={loading}
            onClick={() => handleResponse({ kind: 'approve-once' })}
          />
          {canTrust && (
            <ApprovalButton
              icon={CheckCheck}
              label="Always approve"
              variant="approve-outline"
              disabled={loading}
              onClick={() => handleResponse({ kind: 'approve-and-trust' })}
            />
          )}
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

      {/* Trust pattern hint for "Always approve" */}
      {trustPatternLabel && (
        <p className="text-[11.5px] text-text-tertiary">
          &ldquo;Always approve&rdquo; will remember the pattern{' '}
          <code className="text-text-secondary font-mono">{trustPatternLabel}</code>
        </p>
      )}
    </div>
  )
}
