import { describe, expect, it } from 'vitest'
import { resolvePendingApprovalForUI } from '../pending-approval-visibility'
import type { PendingApproval } from '../pending-tool-interactions'

const PENDING_APPROVAL: PendingApproval = {
  toolName: 'runCommand',
  toolArgs: '{"command":"echo pre-approved command"}',
  approvalId: 'approval-1',
  toolCallId: 'tool-1',
  hasApprovalMetadata: true,
}

const PENDING_APPROVAL_WITHOUT_METADATA: PendingApproval = {
  ...PENDING_APPROVAL,
  hasApprovalMetadata: false,
}

describe('resolvePendingApprovalForUI', () => {
  it('returns null when there is no pending approval', () => {
    expect(
      resolvePendingApprovalForUI({
        pendingApproval: null,
        canCheckPendingApprovalTrust: true,
        pendingApprovalTrustStatus: undefined,
      }),
    ).toBeNull()
  })

  it('hides pending approval when approval metadata has not arrived yet', () => {
    expect(
      resolvePendingApprovalForUI({
        pendingApproval: PENDING_APPROVAL_WITHOUT_METADATA,
        canCheckPendingApprovalTrust: false,
        pendingApprovalTrustStatus: undefined,
      }),
    ).toBeNull()
  })

  it('keeps pending approval visible when trust checks are not available', () => {
    expect(
      resolvePendingApprovalForUI({
        pendingApproval: PENDING_APPROVAL,
        canCheckPendingApprovalTrust: false,
        pendingApprovalTrustStatus: undefined,
      }),
    ).toEqual(PENDING_APPROVAL)
  })

  it('hides pending approval while trust resolution is in-flight', () => {
    expect(
      resolvePendingApprovalForUI({
        pendingApproval: PENDING_APPROVAL,
        canCheckPendingApprovalTrust: true,
        pendingApprovalTrustStatus: undefined,
      }),
    ).toBeNull()

    expect(
      resolvePendingApprovalForUI({
        pendingApproval: PENDING_APPROVAL,
        canCheckPendingApprovalTrust: true,
        pendingApprovalTrustStatus: 'checking',
      }),
    ).toBeNull()
  })

  it('hides pending approval when trust resolution returns trusted', () => {
    expect(
      resolvePendingApprovalForUI({
        pendingApproval: PENDING_APPROVAL,
        canCheckPendingApprovalTrust: true,
        pendingApprovalTrustStatus: 'trusted',
      }),
    ).toBeNull()
  })

  it('shows pending approval when trust resolution returns untrusted', () => {
    expect(
      resolvePendingApprovalForUI({
        pendingApproval: PENDING_APPROVAL,
        canCheckPendingApprovalTrust: true,
        pendingApprovalTrustStatus: 'untrusted',
      }),
    ).toEqual(PENDING_APPROVAL)
  })
})
