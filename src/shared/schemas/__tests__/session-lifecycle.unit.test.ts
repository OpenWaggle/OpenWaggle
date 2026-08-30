import { describe, expect, it } from 'vitest'
import { decodeSessionLifecycleRequest, decodeSessionLifecycleResponse } from '../session-lifecycle'

describe('Session lifecycle v2 boundary', () => {
  it('decodes an atomic Worker spawn with exact parent Run and Delegation specification', () => {
    const request = {
      contractVersion: 2,
      requestId: 'request-spawn',
      idempotencyKey: 'idempotency-spawn',
      command: {
        operation: 'spawn',
        parentSessionId: 'session-parent',
        expectedParentRunId: 'run-parent',
        workspace: { mode: 'share-parent' },
        runAuthorizationOverride: 'ask-for-approval',
        delegation: {
          objective: 'Implement the migration verifier.',
          deliverables: ['Verifier implementation', 'Tests'],
          acceptanceCriteria: ['Rejects corrupt targets'],
          dependencies: [{ delegationId: 'delegation-schema', requiredState: 'ready_for_review' }],
          handoffContext: 'The schema is already locked.',
          resourceReferences: ['docs/adr/0025-adopt-single-local-session-host.md'],
        },
      },
    }

    expect(decodeSessionLifecycleRequest(request)).toEqual(request)
  })

  it('keeps root launch distinct from Worker spawn and accepts an explicit Workspace', () => {
    const request = {
      contractVersion: 2,
      requestId: 'request-launch',
      idempotencyKey: 'idempotency-launch',
      command: {
        operation: 'launch',
        projectPath: '/project',
        workspace: { mode: 'existing', workspaceId: 'workspace-shared' },
        specialization: { agentDefinitionName: 'migration-auditor', thinkingLevel: 'high' },
        objective: 'Audit the migration.',
        attachmentIds: [],
      },
    }

    expect(decodeSessionLifecycleRequest(request)).toEqual(request)
  })

  it('rejects undeclared fields and malformed capacity results', () => {
    expect(() =>
      decodeSessionLifecycleRequest({
        contractVersion: 2,
        requestId: 'request-create',
        idempotencyKey: 'idempotency-create',
        command: {
          operation: 'create',
          projectPath: '/project',
          workspace: { mode: 'local' },
          parentSessionId: 'not-valid-for-create',
        },
      }),
    ).toThrow()
    expect(() =>
      decodeSessionLifecycleResponse({
        contractVersion: 2,
        requestId: 'request-spawn',
        idempotencyKey: 'idempotency-spawn',
        replayed: false,
        outcome: {
          operation: 'spawn',
          effect: 'rejected',
          code: 'parent_capacity_reached',
          retryable: true,
          parentConcurrencyLimit: 0,
        },
      }),
    ).toThrow()
  })
})
