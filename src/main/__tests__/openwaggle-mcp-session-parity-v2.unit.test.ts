import { ATTACHMENT } from '@shared/constants/resource-limits'
import { SESSION_QUERY_MAX_PATH_LENGTH } from '@shared/types/session-query'
import { describe, expect, it } from 'vitest'
import {
  buildMcpSessionPayloadV2,
  mcpTransientAuthority,
  type SessionToolInputV2,
  sessionInputSchemaV2,
} from '../openwaggle-mcp-session-tool-v2'

describe('OpenWaggle MCP Session Control v2 CLI parity', () => {
  it('maps stable branch-scoped item pagination through the native query contract', () => {
    const input = {
      operation: 'items',
      sessionId: 'session-1',
      runId: 'run-1',
      branchScope: 'active-branch',
      branchId: 'branch-1',
      afterCreatedOrder: 10,
      throughCreatedOrder: 20,
      snapshotHeadNodeId: 'node-20',
      limit: 5,
    } as const

    expect(sessionInputSchemaV2.safeParse(input).success).toBe(true)
    expect(buildMcpSessionPayloadV2(input)).toMatchObject({
      contract: 'session-query-v2',
      request: {
        query: {
          operation: 'items',
          sessionId: 'session-1',
          runId: 'run-1',
          branchScope: 'active-branch',
          branchId: 'branch-1',
          afterCreatedOrder: 10,
          throughCreatedOrder: 20,
          snapshotHeadNodeId: 'node-20',
          limit: 5,
        },
      },
    })
  })

  it('retains the native tree-versus-branch selection invariant', () => {
    expect(() =>
      buildMcpSessionPayloadV2({
        operation: 'items',
        sessionId: 'session-1',
        branchScope: 'tree',
        branchId: 'branch-1',
      }),
    ).toThrow('--branch requires --scope active-branch')
  })

  it.each<SessionToolInputV2>([
    {
      operation: 'launch',
      projectPath: '/repo',
      objective: 'Inspect the attachment.',
      attachmentPaths: ['/repo/launch.txt'],
    },
    {
      operation: 'spawn',
      sessionId: 'parent',
      expectedRunId: 'run-parent',
      objective: 'Inspect the attachment.',
      attachmentPaths: ['/repo/spawn.txt'],
    },
    {
      operation: 'message',
      sessionId: 'session-1',
      message: 'Inspect the attachment.',
      attachmentPaths: ['/repo/message.txt'],
    },
    {
      operation: 'start',
      sessionId: 'session-1',
      message: 'Inspect the attachment.',
      attachmentPaths: ['/repo/start.txt'],
    },
    {
      operation: 'follow-up',
      sessionId: 'session-1',
      message: 'Inspect the attachment.',
      attachmentPaths: ['/repo/follow-up.txt'],
    },
    {
      operation: 'steer',
      sessionId: 'session-1',
      expectedRunId: 'run-1',
      message: 'Inspect the attachment.',
      attachmentPaths: ['/repo/steer.txt'],
    },
    {
      operation: 'replace',
      sessionId: 'session-1',
      expectedRunId: 'run-1',
      message: 'Inspect the attachment.',
      attachmentPaths: ['/repo/replace.txt'],
    },
  ])('maps attachment paths for $operation through the native transport', (input) => {
    expect(sessionInputSchemaV2.safeParse(input).success).toBe(true)
    expect(buildMcpSessionPayloadV2(input)).toMatchObject({
      transport: { attachmentPaths: input.attachmentPaths },
    })
  })

  it('bounds attachment paths and rejects them on unsupported operations', () => {
    const maximumPaths = Array.from(
      { length: ATTACHMENT.MAX_COUNT },
      (_, index) => `/repo/attachment-${String(index)}.txt`,
    )
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'message',
        attachmentPaths: maximumPaths,
      }).success,
    ).toBe(true)
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'message',
        attachmentPaths: [...maximumPaths, '/repo/one-too-many.txt'],
      }).success,
    ).toBe(false)
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'message',
        attachmentPaths: ['/repo/repeated.txt', '/repo/repeated.txt'],
      }).success,
    ).toBe(false)
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'message',
        attachmentPaths: ['p'.repeat(SESSION_QUERY_MAX_PATH_LENGTH + 1)],
      }).success,
    ).toBe(false)
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'archive',
        sessionId: 'session-1',
        attachmentPaths: ['/repo/not-applicable.txt'],
      }).success,
    ).toBe(false)
  })

  it('passes attachment roots into the transient Host authority that fences path preparation', () => {
    const attachmentRoots = ['/repo/attachments']
    const payload = buildMcpSessionPayloadV2({
      operation: 'message',
      sessionId: 'session-1',
      message: 'Inspect the attachment.',
      attachmentPaths: ['/repo/attachments/evidence.txt'],
    })

    expect(
      mcpTransientAuthority(
        {
          transport: 'stdio',
          grants: new Set(['sessions:message']),
          workspaceRoots: ['/repo'],
          attachmentRoots,
          sessionIds: new Set(['session-1']),
          profile: 'attachment-test',
          authorizationCeiling: 'ask-for-approval',
          userDataRoot: '/tmp/openwaggle-test',
          version: 'test',
        },
        payload,
      ),
    ).toMatchObject({
      scope: { attachmentRoots },
    })
  })
})
