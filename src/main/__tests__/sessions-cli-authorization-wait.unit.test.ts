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

describe('Sessions CLI authorization and wait commands', () => {
  it('lists and responds to parked agent-loop interactions with separate approval authority', () => {
    const list = command(['requests', 'list', 'session-1'])
    const respond = command([
      'requests',
      'respond',
      'session-1',
      'run-1',
      'interaction-1',
      '--response-json',
      '{"kind":"input","value":"ship it"}',
    ])
    const approve = command([
      'requests',
      'respond',
      'session-1',
      'run-1',
      'interaction-2',
      '--response-json',
      '{"kind":"confirm","accepted":true}',
      '--approve',
    ])

    expect(buildSessionsCliPayload(list.name, list.arguments)).toMatchObject({
      contract: 'session-query-v2',
      request: { query: { operation: 'requests-list', sessionId: 'session-1' } },
    })
    expect(buildSessionsCliPayload(respond.name, respond.arguments)).toMatchObject({
      contract: 'session-control-v2',
      request: {
        command: {
          operation: 'request-respond',
          sessionId: 'session-1',
          runId: 'run-1',
          interactionId: 'interaction-1',
          kind: 'input',
          response: { kind: 'input', value: 'ship it' },
        },
      },
    })
    expect(buildSessionsCliPayload(approve.name, approve.arguments)).toMatchObject({
      request: { command: { operation: 'approval-respond', kind: 'confirm' } },
    })
  })

  it('sets or clears the persistent Session Authorization override explicitly', () => {
    const yolo = command(['authorization', 'set', 'session-1', 'yolo'])
    const inherit = command(['authorization', 'clear', 'session-1'])

    expect(buildSessionsCliPayload(yolo.name, yolo.arguments)).toMatchObject({
      request: {
        command: {
          operation: 'authorization-set',
          sessionId: 'session-1',
          authorizationMode: 'yolo',
        },
      },
    })
    expect(buildSessionsCliPayload(inherit.name, inherit.arguments)).toMatchObject({
      request: { command: { operation: 'authorization-set', authorizationMode: null } },
    })
  })

  it('builds one bounded wait over several Sessions', () => {
    const wait = command([
      'wait',
      'worker-1',
      'worker-2',
      '--condition',
      'idle',
      '--timeout-ms',
      '30000',
    ])

    expect(buildSessionsCliPayload(wait.name, wait.arguments)).toMatchObject({
      contract: 'session-query-v2',
      request: {
        query: {
          operation: 'wait',
          targets: [
            { sessionId: 'worker-1', condition: 'idle' },
            { sessionId: 'worker-2', condition: 'idle' },
          ],
          timeoutMs: 30_000,
        },
      },
    })
  })
})
