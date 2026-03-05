import type { PendingApproval } from './pending-tool-interactions'

export type ApprovalTrustStatus = 'checking' | 'trusted' | 'untrusted'

interface PendingApprovalVisibilityInput {
  readonly pendingApproval: PendingApproval | null
  readonly canCheckPendingApprovalTrust: boolean
  readonly pendingApprovalTrustStatus: ApprovalTrustStatus | undefined
}

export function resolvePendingApprovalForUI({
  pendingApproval,
  canCheckPendingApprovalTrust,
  pendingApprovalTrustStatus,
}: PendingApprovalVisibilityInput): PendingApproval | null {
  if (!pendingApproval) {
    return null
  }
  if (!pendingApproval.hasApprovalMetadata) {
    // The tool call was detected via fallback before the CUSTOM approval chunk
    // arrived. Approval actions are not reliable until approval metadata lands.
    return null
  }
  if (!canCheckPendingApprovalTrust) {
    return pendingApproval
  }
  if (pendingApprovalTrustStatus === 'untrusted') {
    return pendingApproval
  }
  // Hide approval controls while trust is being resolved (undefined/checking)
  // or when the command is already trusted.
  return null
}
