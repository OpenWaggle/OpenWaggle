import { describe, expect, it } from 'vitest'
import {
  assertMcpOriginProvenance,
  assertSuccessfulMcpSessionResult,
  buildMcpSessionPayloadV2,
  sessionInputSchemaV2,
} from '../openwaggle-mcp-session-tool-v2'
import { SESSION_V2_OPERATIONS } from './openwaggle-mcp-session-v2-test-operations'

describe('OpenWaggle MCP Session Control v2 adapter', () => {
  it('surfaces canonical query and mutation failures as MCP errors', () => {
    expect(() =>
      assertSuccessfulMcpSessionResult({
        contract: 'session-query-v2',
        response: {
          contractVersion: 2,
          requestId: 'missing',
          outcome: {
            operation: 'read',
            error: { code: 'session_not_found', message: 'Session not found.' },
          },
        },
      }),
    ).toThrow('session_not_found')
    expect(() =>
      assertSuccessfulMcpSessionResult({
        contract: 'session-control-v2',
        response: {
          contractVersion: 2,
          requestId: 'stale',
          idempotencyKey: 'stale',
          replayed: false,
          outcome: {
            operation: 'steer',
            effect: 'rejected',
            sessionId: 'session-1',
            code: 'run_changed',
          },
        },
      }),
    ).toThrow('run_changed')
  })

  it('exposes the canonical lifecycle, control, query, queue, and wait vocabulary', () => {
    for (const operation of SESSION_V2_OPERATIONS) {
      expect(sessionInputSchemaV2.safeParse({ operation }).success).toBe(true)
    }
  })

  it('rejects unknown public input fields at every owned object boundary', () => {
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'search',
        message: 'migration',
        fullTranscrip: true,
      }).success,
    ).toBe(false)
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'request-respond',
        sessionId: 'session-1',
        runId: 'run-1',
        interactionId: 'interaction-1',
        interactionResponse: { kind: 'input', value: 'answer', typo: true },
      }).success,
    ).toBe(false)
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'delegation-submit',
        sessionId: 'worker',
        delegationId: 'delegation-1',
        summary: 'Done',
        evidence: [{ kind: 'observed-command', summary: 'Tests passed', typo: true }],
      }).success,
    ).toBe(false)
    expect(
      sessionInputSchemaV2.safeParse({
        operation: 'delegation-claim',
        sessionId: 'worker',
        delegationId: 'delegation-1',
        reason: 'Need the file',
        claims: [
          {
            access: 'read',
            target: { type: 'workspace-file', path: 'README.md', typo: true },
          },
        ],
      }).success,
    ).toBe(false)
  })

  it('maps Delegation discovery and exact contract reads', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'delegations-list',
        parentSessionId: 'queen',
        states: ['ready_for_review'],
        catalogScope: 'all',
      }),
    ).toMatchObject({
      request: {
        query: {
          operation: 'delegations-list',
          parentSessionId: 'queen',
          states: ['ready_for_review'],
        },
      },
    })
    expect(
      buildMcpSessionPayloadV2({ operation: 'delegations-read', delegationId: 'delegation-1' }),
    ).toMatchObject({
      request: { query: { operation: 'delegations-read', delegationId: 'delegation-1' } },
    })
  })

  it('maps explicit semantic discovery readiness requirements', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'search',
        message: 'database cutover recovery',
        searchMode: 'semantic',
        requireFresh: true,
        timeoutMs: 2500,
        catalogScope: 'all',
      }),
    ).toMatchObject({
      request: {
        query: {
          operation: 'search',
          query: 'database cutover recovery',
          mode: 'semantic',
          requireFresh: true,
          waitTimeoutMs: 2500,
        },
      },
    })
  })

  it('maps paginated durable Run discovery separately from transcript items', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'turns',
        sessionId: 'worker',
        limit: 25,
        cursor: 'next-run',
      }),
    ).toMatchObject({
      request: {
        query: {
          operation: 'turns',
          sessionId: 'worker',
          limit: 25,
          cursor: 'next-run',
        },
      },
    })
  })

  it.each(['create', 'launch', 'fork', 'handoff'] as const)(
    'maps startFromOrigin for %s new Worktrees',
    (operation) => {
      const common = { workspace: 'new-worktree' as const, startFromOrigin: true }
      const input =
        operation === 'create'
          ? { operation, projectPath: '/repo', ...common }
          : operation === 'launch'
            ? { operation, projectPath: '/repo', objective: 'Work', ...common }
            : { operation, sessionId: 'session-1', ...common }
      expect(buildMcpSessionPayloadV2(input)).toMatchObject({
        request: { command: { workspace: { mode: 'new-worktree', startFromOrigin: true } } },
      })
    },
  )

  it('maps a peer report without creating or changing a Run', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'report',
        sessionId: 'worker',
        sourceRunId: 'run-worker',
        reportTarget: 'queen',
        message: 'The review is ready.',
        requestReply: true,
      }),
    ).toMatchObject({
      request: {
        command: {
          operation: 'report',
          sessionId: 'worker',
          sourceRunId: 'run-worker',
          target: { type: 'queen' },
          input: { text: 'The review is ready.', requestReply: true },
        },
      },
    })
  })

  it('binds report source provenance to the immutable MCP origin session', () => {
    const impersonated = buildMcpSessionPayloadV2({
      operation: 'report',
      sessionId: 'different-worker',
      reportTarget: 'queen',
      message: 'Pretend this came from a peer.',
    })
    expect(() =>
      assertMcpOriginProvenance({ originSessionId: 'origin-worker' }, impersonated),
    ).toThrow('report source must be the immutable --origin-session')

    const authentic = buildMcpSessionPayloadV2({
      operation: 'report',
      sessionId: 'origin-worker',
      reportTarget: 'queen',
      message: 'This came from the bound worker.',
    })
    expect(() =>
      assertMcpOriginProvenance({ originSessionId: 'origin-worker' }, authentic),
    ).not.toThrow()
  })
})
