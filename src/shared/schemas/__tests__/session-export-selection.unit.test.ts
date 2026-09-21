import { decodeSessionControlMutationRequest } from '@shared/schemas/session-control'
import { decodeSessionQueryRequest } from '@shared/schemas/session-query'
import { describe, expect, it } from 'vitest'

describe('Session export branch selection schemas', () => {
  it('rejects a branch selector for tree query exports', () => {
    expect(() =>
      decodeSessionQueryRequest({
        contractVersion: 2,
        requestId: 'tree-query',
        query: {
          operation: 'export',
          sessionId: 'session-1',
          limit: 10,
          branchScope: 'tree',
          branchId: 'branch-main',
        },
      }),
    ).toThrow('active-branch export')
  })

  it('rejects a branch selector for tree durable exports', () => {
    expect(() =>
      decodeSessionControlMutationRequest({
        contractVersion: 2,
        requestId: 'tree-create',
        idempotencyKey: 'tree-create-once',
        command: {
          operation: 'export-create',
          sessionId: 'session-1',
          format: 'jsonl',
          destinationPath: '/tmp/session.jsonl',
          branchScope: 'tree',
          branchId: 'branch-main',
        },
      }),
    ).toThrow('active-branch export')
  })
})
