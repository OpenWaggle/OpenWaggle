import { describe, expect, it } from 'vitest'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import { buildSessionsCliPayload } from '../sessions-cli'

function command(arguments_: readonly string[]) {
  const parsed = parseMcpCliArguments(arguments_)
  return {
    name: parsed.positionals[0] ?? '',
    arguments: { ...parsed, positionals: parsed.positionals.slice(1) },
  }
}

describe('Sessions CLI query contract', () => {
  it('scopes discovery to the caller Working path unless explicitly broadened', () => {
    const current = command(['list'])
    const all = command(['search', 'migration', '--all'])

    expect(
      buildSessionsCliPayload(current.name, current.arguments, {
        workingDirectory: '/repo/worktree-a',
      }),
    ).toMatchObject({ request: { query: { workingPath: '/repo/worktree-a' } } })
    expect(
      buildSessionsCliPayload(all.name, all.arguments, {
        workingDirectory: '/repo/worktree-a',
      }),
    ).not.toHaveProperty('request.query.workingPath')
  })

  it('builds optimized item and queue reads without bodies by default', () => {
    const turns = command(['turns', 'session-1', '--limit', '25', '--cursor', 'next-run'])
    const items = command([
      'items',
      'session-1',
      '--run',
      'run-1',
      '--after',
      '41',
      '--limit',
      '200',
    ])
    const queue = command(['queue', 'list', 'session-1'])
    const queueWithBodies = command(['queue', 'list', 'session-1', '--include-bodies'])

    expect(buildSessionsCliPayload(turns.name, turns.arguments)).toMatchObject({
      request: {
        query: {
          operation: 'turns',
          sessionId: 'session-1',
          limit: 25,
          cursor: 'next-run',
        },
      },
    })
    expect(buildSessionsCliPayload(items.name, items.arguments)).toMatchObject({
      contract: 'session-query-v2',
      request: {
        query: {
          operation: 'items',
          sessionId: 'session-1',
          runId: 'run-1',
          afterCreatedOrder: 41,
          limit: 200,
        },
      },
    })
    expect(buildSessionsCliPayload(queue.name, queue.arguments)).toMatchObject({
      request: { query: { operation: 'queue-list', sessionId: 'session-1' } },
    })
    expect(JSON.stringify(buildSessionsCliPayload(queue.name, queue.arguments))).not.toContain(
      'includeBodies',
    )
    expect(buildSessionsCliPayload(queueWithBodies.name, queueWithBodies.arguments)).toMatchObject({
      request: { query: { operation: 'queue-list', includeBodies: true } },
    })
  })

  it('accepts zero-valued cursors, revisions, and bounded wait timeouts', () => {
    const items = command(['items', 'session-1', '--after', '0'])
    const wait = command(['wait', 'session-1', '--timeout-ms', '0'])
    const pause = command(['queue', 'pause', 'session-1', '--queue-revision', '0'])

    expect(buildSessionsCliPayload(items.name, items.arguments)).toMatchObject({
      request: { query: { afterCreatedOrder: 0 } },
    })
    expect(buildSessionsCliPayload(wait.name, wait.arguments)).toMatchObject({
      request: { query: { timeoutMs: 0 } },
    })
    expect(buildSessionsCliPayload(pause.name, pause.arguments)).toMatchObject({
      request: { command: { expectedQueueRevision: 0 } },
    })
  })
})
