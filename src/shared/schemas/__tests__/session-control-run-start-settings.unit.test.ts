import { describe, expect, it } from 'vitest'
import {
  decodeSessionControlMutationRequest,
  SESSION_CONTROL_CONTRACT_VERSION,
} from '../session-control'

describe('Session Control v2 Run-start settings', () => {
  it('decodes a Run authorization override and thinking level on adaptive message submission', () => {
    // The Host accepts them only if the message starts a Run on an idle Session.
    const request = decodeSessionControlMutationRequest({
      contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
      requestId: 'request-message-mode',
      idempotencyKey: 'idempotency-message-mode',
      command: {
        operation: 'message',
        sessionId: 'session-target',
        runAuthorizationOverride: 'yolo',
        input: { text: 'Continue.', attachmentIds: [], thinkingLevel: 'high' },
      },
    })

    expect(request.command).toMatchObject({
      runAuthorizationOverride: 'yolo',
      input: { thinkingLevel: 'high' },
    })
  })

  it.each([{ operation: 'follow-up' }, { operation: 'replace', expectedRunId: 'run-active' }])(
    'rejects Session settings on $operation, which never carries them',
    (target) => {
      const decode =
        (extra: object, input: object = {}) =>
        () =>
          decodeSessionControlMutationRequest({
            contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
            requestId: 'request-settings',
            idempotencyKey: 'idempotency-settings',
            command: {
              ...target,
              sessionId: 'session-target',
              ...extra,
              input: { text: 'Later.', attachmentIds: [], ...input },
            },
          })
      expect(decode({ runAuthorizationOverride: 'yolo' })).toThrow(/runAuthorizationOverride/)
      expect(decode({}, { thinkingLevel: 'high' })).toThrow(/thinkingLevel/)
    },
  )
})
