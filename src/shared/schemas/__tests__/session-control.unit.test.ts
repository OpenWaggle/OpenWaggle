import { describe, expect, it } from 'vitest'
import {
  decodeSessionControlMutationRequest,
  decodeSessionControlMutationResponse,
  SESSION_CONTROL_CONTRACT_VERSION,
} from '../session-control'

describe('Session Control v2 boundary', () => {
  it('decodes steering as input for one expected active Run', () => {
    const request = decodeSessionControlMutationRequest({
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-steer',
      idempotencyKey: 'idempotency-steer',
      command: {
        operation: 'steer',
        sessionId: 'session-target',
        expectedRunId: 'run-active',
        input: { text: 'Use the corrected migration order.', attachmentIds: [] },
      },
    })

    expect(request).toEqual({
      contractVersion: 2,
      requestId: 'request-steer',
      idempotencyKey: 'idempotency-steer',
      command: {
        operation: 'steer',
        sessionId: 'session-target',
        expectedRunId: 'run-active',
        input: { text: 'Use the corrected migration order.', attachmentIds: [] },
      },
    })
  })

  it('decodes adaptive message submission without a Run authorization override', () => {
    const request = decodeSessionControlMutationRequest({
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-message',
      idempotencyKey: 'idempotency-message',
      command: {
        operation: 'message',
        sessionId: 'session-target',
        input: { text: 'Continue with the migration.', attachmentIds: [] },
      },
    })

    expect(request.command).toEqual({
      operation: 'message',
      sessionId: 'session-target',
      input: { text: 'Continue with the migration.', attachmentIds: [] },
    })
  })

  it('rejects a Run authorization override on adaptive message submission', () => {
    expect(() =>
      decodeSessionControlMutationRequest({
        contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
        requestId: 'request-message-mode',
        idempotencyKey: 'idempotency-message-mode',
        command: {
          operation: 'message',
          sessionId: 'session-target',
          runAuthorizationOverride: 'yolo',
          input: { text: 'Continue.', attachmentIds: [] },
        },
      }),
    ).toThrow(/runAuthorizationOverride/)
  })

  it('decodes explicit Run start with a per-Run authorization override', () => {
    const request = decodeSessionControlMutationRequest({
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-start',
      idempotencyKey: 'idempotency-start',
      command: {
        operation: 'start',
        sessionId: 'session-target',
        runAuthorizationOverride: 'yolo',
        input: {
          text: 'Implement the target schema.',
          attachmentIds: [],
          thinkingLevel: 'high',
        },
      },
    })

    expect(request.command).toEqual({
      operation: 'start',
      sessionId: 'session-target',
      runAuthorizationOverride: 'yolo',
      input: {
        text: 'Implement the target schema.',
        attachmentIds: [],
        thinkingLevel: 'high',
      },
    })
  })

  it('decodes an explicit future Run Follow-up', () => {
    const request = decodeSessionControlMutationRequest({
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-follow-up',
      idempotencyKey: 'idempotency-follow-up',
      command: {
        operation: 'follow-up',
        sessionId: 'session-target',
        runAuthorizationOverride: 'ask-for-approval',
        input: { text: 'Run the full verification matrix next.', attachmentIds: [] },
      },
    })

    expect(request.command).toEqual({
      operation: 'follow-up',
      sessionId: 'session-target',
      runAuthorizationOverride: 'ask-for-approval',
      input: { text: 'Run the full verification matrix next.', attachmentIds: [] },
    })
  })

  it('decodes Run replacement against one expected active Run', () => {
    const request = decodeSessionControlMutationRequest({
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-replace',
      idempotencyKey: 'idempotency-replace',
      command: {
        operation: 'replace',
        sessionId: 'session-target',
        expectedRunId: 'run-active',
        runAuthorizationOverride: 'yolo',
        input: { text: 'Stop that approach and implement this one.', attachmentIds: [] },
      },
    })

    expect(request.command).toEqual({
      operation: 'replace',
      sessionId: 'session-target',
      expectedRunId: 'run-active',
      runAuthorizationOverride: 'yolo',
      input: { text: 'Stop that approach and implement this one.', attachmentIds: [] },
    })
  })

  it('decodes interruption against one expected active Run', () => {
    const request = decodeSessionControlMutationRequest({
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-interrupt',
      idempotencyKey: 'idempotency-interrupt',
      command: {
        operation: 'interrupt',
        sessionId: 'session-target',
        expectedRunId: 'run-active',
      },
    })

    expect(request.command).toEqual({
      operation: 'interrupt',
      sessionId: 'session-target',
      expectedRunId: 'run-active',
    })
  })

  it('decodes promotion of one stable Follow-up into one expected active Run', () => {
    const request = decodeSessionControlMutationRequest({
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-promote',
      idempotencyKey: 'idempotency-promote',
      command: {
        operation: 'promote',
        sessionId: 'session-target',
        expectedRunId: 'run-active',
        followUpId: 'follow-up-next',
      },
    })

    expect(request.command).toEqual({
      operation: 'promote',
      sessionId: 'session-target',
      expectedRunId: 'run-active',
      followUpId: 'follow-up-next',
    })
  })

  it('decodes withdrawal of selected Follow-ups without a queue revision', () => {
    const request = decodeSessionControlMutationRequest({
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-withdraw',
      idempotencyKey: 'idempotency-withdraw',
      command: {
        operation: 'queue-withdraw',
        sessionId: 'session-target',
        followUpIds: ['follow-up-first', 'follow-up-third'],
      },
    })

    expect(request.command).toEqual({
      operation: 'queue-withdraw',
      sessionId: 'session-target',
      followUpIds: ['follow-up-first', 'follow-up-third'],
    })
  })

  it('requires the current queue revision when reordering all Follow-ups', () => {
    const request = decodeSessionControlMutationRequest({
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-reorder',
      idempotencyKey: 'idempotency-reorder',
      command: {
        operation: 'queue-reorder',
        sessionId: 'session-target',
        expectedQueueRevision: 12,
        orderedFollowUpIds: ['follow-up-third', 'follow-up-first'],
      },
    })

    expect(request.command).toEqual({
      operation: 'queue-reorder',
      sessionId: 'session-target',
      expectedQueueRevision: 12,
      orderedFollowUpIds: ['follow-up-third', 'follow-up-first'],
    })
  })

  it('requires the current queue revision when pausing Follow-up delivery', () => {
    const request = decodeSessionControlMutationRequest({
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-pause',
      idempotencyKey: 'idempotency-pause',
      command: {
        operation: 'queue-pause',
        sessionId: 'session-target',
        expectedQueueRevision: 15,
      },
    })

    expect(request.command).toEqual({
      operation: 'queue-pause',
      sessionId: 'session-target',
      expectedQueueRevision: 15,
    })
  })

  it('requires the current queue revision when resuming Follow-up delivery', () => {
    const request = decodeSessionControlMutationRequest({
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-resume',
      idempotencyKey: 'idempotency-resume',
      command: {
        operation: 'queue-resume',
        sessionId: 'session-target',
        expectedQueueRevision: 16,
      },
    })

    expect(request.command).toEqual({
      operation: 'queue-resume',
      sessionId: 'session-target',
      expectedQueueRevision: 16,
    })
  })

  it('decodes a versioned adaptive Message outcome for every boundary adapter', () => {
    const response = decodeSessionControlMutationResponse({
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-message',
      idempotencyKey: 'idempotency-message',
      replayed: false,
      outcome: {
        operation: 'message',
        effect: 'started-run',
        sessionId: 'session-target',
        runId: 'run-next',
        stateRevision: 3,
      },
    })

    expect(response.outcome).toEqual({
      operation: 'message',
      effect: 'started-run',
      sessionId: 'session-target',
      runId: 'run-next',
      stateRevision: 3,
    })
  })

  it('decodes durable export creation with explicit bundle resources', () => {
    const request = decodeSessionControlMutationRequest({
      contractVersion: 2,
      requestId: 'request-export',
      idempotencyKey: 'export-once',
      command: {
        operation: 'export-create',
        sessionId: 'session-target',
        format: 'bundle',
        destinationPath: '/tmp/session.zip',
        branchScope: 'tree',
        resources: [{ kind: 'workspace-file', path: 'docs/architecture.md' }],
      },
    })

    expect(request.command).toMatchObject({
      operation: 'export-create',
      format: 'bundle',
      resources: [{ path: 'docs/architecture.md' }],
    })
  })

  it('decodes export cancellation against one durable operation', () => {
    const request = decodeSessionControlMutationRequest({
      contractVersion: 2,
      requestId: 'request-export-cancel',
      idempotencyKey: 'cancel-once',
      command: {
        operation: 'export-cancel',
        sessionId: 'session-target',
        exportOperationId: 'export-1',
      },
    })

    expect(request.command).toEqual({
      operation: 'export-cancel',
      sessionId: 'session-target',
      exportOperationId: 'export-1',
    })
  })
})
