import { describe, expect, it } from 'vitest'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import { buildMcpSessionPayloadV2, sessionInputSchemaV2 } from '../openwaggle-mcp-session-input-v2'
import { buildSessionsCliPayload } from '../sessions-cli'

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
