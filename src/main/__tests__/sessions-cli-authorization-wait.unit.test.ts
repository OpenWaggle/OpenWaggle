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

describe('Hive CLI authorization and wait commands', () => {
  it('lists parked agent-loop interactions and answers approvals with allow or deny', () => {
    const list = command(['requests-list', 'session-1'])
    const respond = command(['request-respond', 'session-1', 'run-1', 'interaction-1'])
    const approve = command(['approval-respond', 'session-1', 'run-1', 'interaction-2', 'allow'])
    const keep = command([
      'approval-respond',
      'session-1',
      'run-1',
      'interaction-2',
      'allow',
      '--for',
      'project',
    ])
    const deny = command(['approval-respond', 'session-1', 'run-1', 'interaction-2', 'deny'])

    expect(buildSessionsCliPayload(list.name, list.arguments)).toMatchObject({
      contract: 'session-query-v2',
      request: { query: { operation: 'requests-list', sessionId: 'session-1' } },
    })
    expect(
      buildSessionsCliPayload(respond.name, respond.arguments, {
        structured: { interactionResponse: { kind: 'input', value: 'ship it' } },
      }),
    ).toMatchObject({
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
      request: {
        command: {
          operation: 'approval-respond',
          kind: 'confirm',
          response: { kind: 'confirm', accepted: true },
        },
      },
    })
    expect(buildSessionsCliPayload(keep.name, keep.arguments)).toMatchObject({
      request: { command: { response: { kind: 'confirm', accepted: true, scope: 'project' } } },
    })
    expect(buildSessionsCliPayload(deny.name, deny.arguments)).toMatchObject({
      request: { command: { response: { kind: 'confirm', accepted: false } } },
    })
  })

  it.each([
    [[], 'approval-respond takes allow or deny'],
    [['yes'], 'approval-respond takes allow or deny'],
    [['allow', '--for', 'forever'], '--for must be once, session or project'],
    [['deny', '--for', 'session'], '--for applies only to allow'],
  ] as const)('refuses the approval answer %j', (answer, message) => {
    const approve = command(['approval-respond', 'session-1', 'run-1', 'interaction-2', ...answer])
    expect(() => buildSessionsCliPayload(approve.name, approve.arguments)).toThrow(message)
  })

  it('sets or clears the persistent Session Authorization override explicitly', () => {
    const yolo = command(['authorization-set', 'session-1', 'yolo'])
    const inherit = command(['authorization-set', 'session-1', 'inherit'])

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
