import { describe, expect, it } from 'vitest'
import {
  decodeLocalSessionClientFrame,
  decodeLocalSessionClientHello,
  decodeLocalSessionCommandPayload,
  decodeLocalSessionCommandPayloadForRevision,
  decodeLocalSessionNegotiationResult,
} from '../../../shared/schemas/local-session-protocol'
import { negotiateLocalSessionProtocol } from '../local-session-negotiation'

describe('Local Session protocol negotiation', () => {
  it('selects the highest mutually supported revision and its exact capabilities', () => {
    const hello = decodeLocalSessionClientHello({
      protocol: 'openwaggle-local-session',
      supportedRevisions: [6, 5, 4, 3, 2, 1],
      clientKind: 'cli',
      clientVersion: '0.4.0-alpha.1',
    })

    expect(negotiateLocalSessionProtocol(hello, 'host-current')).toMatchObject({
      accepted: true,
      revision: 6,
      hostInstanceId: 'host-current',
      capabilities: expect.arrayContaining(['waggle:run-v1', 'ui:compact-v1', 'host-ui:invoke-v1']),
    })
  })

  it('requests an authenticated safe handoff from an incompatible newer client', () => {
    expect(
      negotiateLocalSessionProtocol(
        {
          protocol: 'openwaggle-local-session',
          supportedRevisions: [8, 7],
          clientKind: 'gui',
          clientVersion: 'future',
        },
        'host-current',
        {
          blockingRuns: [{ sessionId: 'session-live', runId: 'run-live' }],
          blockingOperations: [
            { operationId: 'operation-live', operation: 'export', targetScope: 'session-live' },
          ],
        },
      ),
    ).toMatchObject({
      accepted: false,
      code: 'host_upgrade_pending',
      hostInstanceId: 'host-current',
      blockingRuns: [{ sessionId: 'session-live', runId: 'run-live' }],
      blockingOperations: [{ operationId: 'operation-live' }],
    })
  })

  it('rejects an incompatible older client and undeclared negotiation fields explicitly', () => {
    expect(
      negotiateLocalSessionProtocol(
        {
          protocol: 'openwaggle-local-session',
          supportedRevisions: [0],
          clientKind: 'gui',
          clientVersion: 'legacy',
        },
        'host-current',
      ),
    ).toMatchObject({ accepted: false, code: 'incompatible_protocol' })
    expect(() =>
      decodeLocalSessionClientHello({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [6],
        clientKind: 'cli',
        clientVersion: 'current',
        undeclared: true,
      }),
    ).toThrow()
  })

  it('preserves exact revision-five through revision-two capability tuples', () => {
    expect(() =>
      decodeLocalSessionNegotiationResult({
        accepted: true,
        protocol: 'openwaggle-local-session',
        revision: 5,
        hostInstanceId: 'host-ui',
        capabilities: [
          'events:subscribe',
          'events:replay',
          'sessions:mutate-v2',
          'sessions:query-v2',
          'sessions:snapshot',
          'access:profiles-v1',
          'ui:mutate-v1',
          'waggle:run-v1',
          'waggle:cancel-v1',
          'ui:compact-v1',
          'host-ui:invoke-v1',
        ],
      }),
    ).not.toThrow()
    expect(() =>
      decodeLocalSessionNegotiationResult({
        accepted: true,
        protocol: 'openwaggle-local-session',
        revision: 4,
        hostInstanceId: 'host-compaction',
        capabilities: [
          'events:subscribe',
          'events:replay',
          'sessions:mutate-v2',
          'sessions:query-v2',
          'sessions:snapshot',
          'access:profiles-v1',
          'ui:mutate-v1',
          'waggle:run-v1',
          'waggle:cancel-v1',
          'ui:compact-v1',
        ],
      }),
    ).not.toThrow()
    expect(() =>
      decodeLocalSessionNegotiationResult({
        accepted: true,
        protocol: 'openwaggle-local-session',
        revision: 3,
        hostInstanceId: 'host-previous',
        capabilities: [
          'events:subscribe',
          'events:replay',
          'sessions:mutate-v2',
          'sessions:query-v2',
          'sessions:snapshot',
          'access:profiles-v1',
          'ui:mutate-v1',
          'waggle:run-v1',
          'waggle:cancel-v1',
        ],
      }),
    ).not.toThrow()
    expect(() =>
      decodeLocalSessionNegotiationResult({
        accepted: true,
        protocol: 'openwaggle-local-session',
        revision: 2,
        hostInstanceId: 'host-legacy',
        capabilities: [
          'events:subscribe',
          'events:replay',
          'sessions:mutate-v2',
          'sessions:query-v2',
          'sessions:snapshot',
          'access:profiles-v1',
          'ui:mutate-v1',
        ],
      }),
    ).not.toThrow()
  })

  it('decodes an older Host upgrade response before the Host drains', () => {
    expect(
      decodeLocalSessionNegotiationResult({
        accepted: false,
        protocol: 'openwaggle-local-session',
        code: 'host_upgrade_pending',
        hostInstanceId: 'host-revision-three',
        supportedRevisions: [3, 2],
        blockingRuns: [],
        blockingOperations: [],
      }),
    ).toMatchObject({ code: 'host_upgrade_pending', supportedRevisions: [3, 2] })
  })

  it('decodes command and subscription frames exactly after negotiation', () => {
    expect(
      decodeLocalSessionClientFrame({
        kind: 'subscribe',
        requestId: 'request-subscribe',
        after: { hostInstanceId: 'host-current', sequence: 12 },
      }),
    ).toMatchObject({ kind: 'subscribe', requestId: 'request-subscribe' })
    expect(() =>
      decodeLocalSessionClientFrame({
        kind: 'command',
        requestId: 'request-command',
        payload: { operation: 'status' },
        undeclared: true,
      }),
    ).toThrow()
    expect(
      decodeLocalSessionCommandPayload({
        contract: 'session-control-v2',
        request: {
          contractVersion: 2,
          requestId: 'request-message',
          idempotencyKey: 'idempotency-message',
          command: {
            operation: 'message',
            sessionId: 'session-target',
            input: { text: 'Continue.', attachmentIds: [] },
          },
        },
      }),
    ).toMatchObject({ contract: 'session-control-v2' })
    const waggleCommand = {
      contract: 'session-waggle-v1',
      request: {
        contractVersion: 1,
        requestId: 'request-waggle',
        idempotencyKey: 'idempotency-waggle',
        sessionId: 'session-target',
        payload: { text: 'Review.', thinkingLevel: 'medium', attachments: [] },
        model: 'openai/gpt-5.4',
        config: {
          mode: 'sequential',
          agents: [
            { label: 'Architect', model: '$inherit', roleDescription: 'Plans', color: 'blue' },
            {
              label: 'Reviewer',
              model: 'openai/gpt-5.4',
              roleDescription: 'Reviews',
              color: 'amber',
            },
          ],
          stop: { primary: 'consensus', maxTurnsSafety: 4 },
        },
      },
    }
    expect(decodeLocalSessionCommandPayload(waggleCommand)).toMatchObject({
      contract: 'session-waggle-v1',
    })
    expect(() => decodeLocalSessionCommandPayloadForRevision(waggleCommand, 2)).toThrow(
      /revision 3/,
    )
    expect(decodeLocalSessionCommandPayloadForRevision(waggleCommand, 3)).toMatchObject({
      contract: 'session-waggle-v1',
    })
    const compactionCommand = {
      contract: 'local-compaction-v1',
      request: {
        requestId: 'request-compaction',
        sessionId: 'session-target',
        model: 'openai/gpt-5.4',
        customInstructions: 'Keep the current task.',
      },
    }
    expect(() => decodeLocalSessionCommandPayloadForRevision(compactionCommand, 3)).toThrow(
      /revision 4/,
    )
    expect(decodeLocalSessionCommandPayloadForRevision(compactionCommand, 4)).toEqual(
      compactionCommand,
    )
    const hostUiCommand = {
      contract: 'host-ui-v1',
      request: {
        contractVersion: 1,
        requestId: 'request-host-ui',
        channel: 'sessions:list-details',
        args: [{ kind: 'value', value: 20 }],
      },
    }
    expect(() => decodeLocalSessionCommandPayloadForRevision(hostUiCommand, 4)).toThrow(
      /revision 5/,
    )
    expect(decodeLocalSessionCommandPayloadForRevision(hostUiCommand, 5)).toEqual(hostUiCommand)
    const mcpHostUiCommand = {
      contract: 'host-ui-v1',
      request: {
        contractVersion: 1,
        requestId: 'request-mcp-host-ui',
        channel: 'mcp:get-settings',
        args: [],
      },
    }
    expect(() => decodeLocalSessionCommandPayloadForRevision(mcpHostUiCommand, 5)).toThrow(
      /revision 6/,
    )
    expect(decodeLocalSessionCommandPayloadForRevision(mcpHostUiCommand, 6)).toEqual(
      mcpHostUiCommand,
    )
    expect(() =>
      decodeLocalSessionCommandPayload({
        contract: 'session-control-v2',
        request: {
          contractVersion: 2,
          requestId: 'request-message',
          idempotencyKey: 'idempotency-message',
          command: {
            operation: 'message',
            sessionId: 'session-target',
            input: { text: 'Continue.', attachmentIds: [] },
          },
        },
        bypassAuthorization: true,
      }),
    ).toThrow()
  })
})
