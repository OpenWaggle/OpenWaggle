import { SESSION_TITLE_MAX_LENGTH } from '@shared/session-title'
import { describe, expect, it } from 'vitest'
import { decodeSessionControlMutationRequest } from '../session-control'
import { decodeSessionLifecycleRequest } from '../session-lifecycle'

describe('Session title boundary contract', () => {
  it.each(['', '   ', 'x'.repeat(SESSION_TITLE_MAX_LENGTH + 1)])(
    'rejects an invalid lifecycle title',
    (title) => {
      expect(() =>
        decodeSessionLifecycleRequest({
          contractVersion: 2,
          requestId: 'request-title',
          idempotencyKey: 'idempotency-title',
          command: { operation: 'create', projectPath: '/project', title },
        }),
      ).toThrow()
    },
  )

  it.each(['', '   ', 'x'.repeat(SESSION_TITLE_MAX_LENGTH + 1)])(
    'rejects an invalid organization title',
    (title) => {
      expect(() =>
        decodeSessionControlMutationRequest({
          contractVersion: 2,
          requestId: 'request-rename',
          idempotencyKey: 'idempotency-rename',
          command: { operation: 'rename', sessionId: 'session-target', title },
        }),
      ).toThrow()
    },
  )

  it('accepts the maximum non-blank lifecycle and organization title', () => {
    const title = 'x'.repeat(SESSION_TITLE_MAX_LENGTH)
    expect(
      decodeSessionLifecycleRequest({
        contractVersion: 2,
        requestId: 'request-title-maximum',
        idempotencyKey: 'idempotency-title-maximum',
        command: { operation: 'fork', sourceSessionId: 'source', title },
      }).command,
    ).toMatchObject({ title })
    expect(
      decodeSessionControlMutationRequest({
        contractVersion: 2,
        requestId: 'request-rename-maximum',
        idempotencyKey: 'idempotency-rename-maximum',
        command: { operation: 'rename', sessionId: 'session-target', title },
      }).command,
    ).toMatchObject({ title })
  })
})
