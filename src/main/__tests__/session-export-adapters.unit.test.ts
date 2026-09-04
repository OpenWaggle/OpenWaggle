import { describe, expect, it } from 'vitest'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import { buildMcpSessionPayloadV2, sessionInputSchemaV2 } from '../openwaggle-mcp-session-input-v2'
import { buildSessionsCliPayload } from '../sessions-cli'

const SNAPSHOT_MANIFEST = {
  schemaVersion: 1 as const,
  sessionId: 'worker',
  title: 'Worker export',
  branchScope: 'active-branch' as const,
  activeBranchId: 'worker:main',
  selectedBranchId: 'worker:main',
  snapshot: {
    nodeHighWaterMark: 42,
    stateRevision: 7,
    queueRevision: 3,
    capturedAt: 1234,
    nodeMutationRevision: 5,
    selectedHeadNodeId: 'node-42',
  },
  activeRunId: null,
  activeTurnIncomplete: false,
  queue: {
    state: 'running' as const,
    pendingCount: 0,
    bodyScope: 'omitted-by-choice' as const,
    omittedBodyCount: 0,
    items: [],
  },
}

describe('Session export adapters', () => {
  it('maps the CLI export flags into one bounded Host snapshot request', () => {
    const parsed = parseMcpCliArguments([
      'export',
      'session-1',
      '--scope',
      'tree',
      '--include-queue-bodies',
      '--limit',
      '250',
    ])
    expect(
      buildSessionsCliPayload(parsed.positionals[0] ?? '', {
        ...parsed,
        positionals: parsed.positionals.slice(1),
      }),
    ).toMatchObject({
      request: {
        query: {
          operation: 'export',
          sessionId: 'session-1',
          branchScope: 'tree',
          includeQueueBodies: true,
          limit: 250,
        },
      },
    })
  })

  it('maps the same bounded export through MCP v2', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'export',
        sessionId: 'worker',
        branchScope: 'tree',
        includeQueueBodies: true,
        limit: 100,
      }),
    ).toMatchObject({
      request: {
        query: {
          operation: 'export',
          sessionId: 'worker',
          branchScope: 'tree',
          includeQueueBodies: true,
          limit: 100,
        },
      },
    })
  })

  it('maps strict MCP export continuation from the immutable first-page manifest', () => {
    const input = sessionInputSchemaV2.parse({
      operation: 'export',
      sessionId: 'worker',
      limit: 100,
      afterCreatedOrder: 20,
      snapshotManifest: SNAPSHOT_MANIFEST,
    })

    expect(buildMcpSessionPayloadV2(input)).toMatchObject({
      request: {
        query: {
          operation: 'export',
          sessionId: 'worker',
          limit: 100,
          branchScope: 'active-branch',
          branchId: 'worker:main',
          afterCreatedOrder: 20,
          throughCreatedOrder: 42,
          snapshotStateRevision: 7,
          snapshotHeadNodeId: 'node-42',
          capturedAt: 1234,
          snapshotManifest: SNAPSHOT_MANIFEST,
        },
      },
    })
    expect(() =>
      buildMcpSessionPayloadV2({
        operation: 'export',
        sessionId: 'another-session',
        afterCreatedOrder: 20,
        snapshotManifest: SNAPSHOT_MANIFEST,
      }),
    ).toThrow('different Session')
    expect(() =>
      buildMcpSessionPayloadV2({
        operation: 'export',
        sessionId: 'worker',
        afterCreatedOrder: 20,
      }),
    ).toThrow('snapshotManifest')
  })

  it('maps durable file creation, progress reads, and cancellation through the CLI', () => {
    const create = parseMcpCliArguments([
      'create',
      'worker',
      './worker.zip',
      '--format',
      'bundle',
      '--resource',
      'docs/architecture.md',
      '--overwrite',
    ])
    expect(buildSessionsCliPayload('export', create)).toMatchObject({
      contract: 'session-control-v2',
      request: {
        command: {
          operation: 'export-create',
          sessionId: 'worker',
          format: 'bundle',
          resources: [{ kind: 'workspace-file', path: 'docs/architecture.md' }],
          overwriteExisting: true,
        },
      },
    })

    const wait = parseMcpCliArguments([
      'wait',
      'worker',
      'export-1',
      '--timeout-ms',
      '1000',
      '--include-queue-bodies',
    ])
    expect(buildSessionsCliPayload('export', wait)).toMatchObject({
      request: {
        query: {
          operation: 'exports-wait',
          sessionId: 'worker',
          exportOperationId: 'export-1',
          timeoutMs: 1000,
          includeQueueBodies: true,
        },
      },
    })

    expect(
      buildSessionsCliPayload('export', parseMcpCliArguments(['cancel', 'worker', 'export-1'])),
    ).toMatchObject({ request: { command: { operation: 'export-cancel' } } })
  })

  it.each(['exports-list', 'exports-read', 'exports-wait'] as const)(
    'maps explicit queue-body access through the public MCP %s schema',
    (operation) => {
      const input = sessionInputSchemaV2.parse({
        operation,
        sessionId: 'worker',
        ...(operation === 'exports-list' ? {} : { exportOperationId: 'export-1' }),
        ...(operation === 'exports-wait' ? { timeoutMs: 1_000 } : {}),
        includeQueueBodies: true,
      })
      expect(buildMcpSessionPayloadV2(input)).toMatchObject({
        request: {
          query: {
            operation,
            sessionId: 'worker',
            includeQueueBodies: true,
          },
        },
      })
    },
  )

  it.each(['list', 'export-cancel'] as const)(
    'rejects queue-body access on unrelated MCP %s inputs',
    (operation) => {
      expect(
        sessionInputSchemaV2.safeParse({
          operation,
          sessionId: 'worker',
          exportOperationId: 'export-1',
          includeQueueBodies: true,
        }).success,
      ).toBe(false)
    },
  )

  it('maps an explicit MCP export-history read after strict parsing', () => {
    const input = sessionInputSchemaV2.parse({
      operation: 'exports-read',
      sessionId: 'worker',
      exportOperationId: 'export-1',
      includeQueueBodies: true,
    })
    expect(buildMcpSessionPayloadV2(input)).toMatchObject({
      request: {
        query: {
          operation: 'exports-read',
          sessionId: 'worker',
          exportOperationId: 'export-1',
          includeQueueBodies: true,
        },
      },
    })
  })
})
