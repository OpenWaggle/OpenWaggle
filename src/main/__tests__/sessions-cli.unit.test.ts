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

describe('Sessions CLI command contract', () => {
  it('keeps follow-up and Steering as explicit different operations', () => {
    const followUp = command(['follow-up', 'session-1', '--text', 'Do this', '--yolo'])
    const steer = command([
      'steer',
      'session-1',
      '--text',
      'Change direction',
      '--expected-run',
      'run-1',
    ])

    expect(buildSessionsCliPayload(followUp.name, followUp.arguments)).toMatchObject({
      contract: 'session-control-v2',
      request: {
        command: {
          operation: 'follow-up',
          sessionId: 'session-1',
          runAuthorizationOverride: 'yolo',
          input: { text: 'Do this' },
        },
      },
    })
    expect(buildSessionsCliPayload(steer.name, steer.arguments)).toMatchObject({
      contract: 'session-control-v2',
      request: {
        command: {
          operation: 'steer',
          sessionId: 'session-1',
          expectedRunId: 'run-1',
          input: { text: 'Change direction' },
        },
      },
    })
  })

  it('builds a Worker spawn with explicit parent Run and Workspace placement', () => {
    const spawn = command([
      'spawn',
      'session-parent',
      '--text',
      'Review security',
      '--expected-run',
      'run-parent',
      '--workspace',
      'new-worktree',
      '--agent',
      'security-reviewer',
      '--deliverable',
      'Review notes',
      '--accept',
      'No critical findings',
    ])

    expect(buildSessionsCliPayload(spawn.name, spawn.arguments)).toMatchObject({
      contract: 'session-lifecycle-v2',
      request: {
        command: {
          operation: 'spawn',
          parentSessionId: 'session-parent',
          expectedParentRunId: 'run-parent',
          workspace: { mode: 'new-worktree' },
          specialization: { agentDefinitionName: 'security-reviewer' },
          delegation: {
            objective: 'Review security',
            deliverables: ['Review notes'],
            acceptanceCriteria: ['No critical findings'],
          },
        },
      },
    })
  })

  it('rejects ambiguous adaptive Message authorization overrides', () => {
    const adaptive = command(['message', 'session-1', '--text', 'Continue', '--yolo'])
    expect(() => buildSessionsCliPayload(adaptive.name, adaptive.arguments)).toThrow(
      'does not accept Run authorization',
    )
  })

  it('rejects YOLO steering and accepts explicit approval mode for a new Run', () => {
    const steer = command([
      'steer',
      'session-1',
      '--text',
      'Change direction',
      '--expected-run',
      'run-1',
      '--yolo',
    ])
    const start = command([
      'start',
      'session-1',
      '--text',
      'Continue safely',
      '--authorization',
      'ask-for-approval',
    ])

    expect(() => buildSessionsCliPayload(steer.name, steer.arguments)).toThrow(
      'Steer does not accept Run authorization',
    )
    expect(buildSessionsCliPayload(start.name, start.arguments)).toMatchObject({
      request: { command: { runAuthorizationOverride: 'ask-for-approval' } },
    })
  })

  it('builds an explicit upstream report without creating or steering a Run', () => {
    const report = command([
      'report',
      'session-worker',
      '--text',
      'Ready for review',
      '--upstream',
      '--source-run',
      'run-worker',
      '--request-reply',
    ])

    expect(buildSessionsCliPayload(report.name, report.arguments)).toMatchObject({
      contract: 'session-control-v2',
      request: {
        command: {
          operation: 'report',
          sessionId: 'session-worker',
          sourceRunId: 'run-worker',
          target: { type: 'upstream' },
          input: { text: 'Ready for review', requestReply: true },
        },
      },
    })
  })

  it('builds an explicit all-descendants interruption without targeting the parent Run', () => {
    const stopAll = command(['interrupt-descendants', 'session-queen'])

    expect(buildSessionsCliPayload(stopAll.name, stopAll.arguments)).toMatchObject({
      contract: 'session-control-v2',
      request: {
        command: { operation: 'interrupt-descendants', sessionId: 'session-queen' },
      },
    })
  })

  it('builds explicit Delegation submission and acceptance operations', () => {
    const submit = command([
      'delegation',
      'submit',
      'worker',
      'delegation-1',
      'Implementation',
      'ready',
      '--evidence-json',
      '{"kind":"observed-command","summary":"Tests passed"}',
    ])
    const accept = command([
      'delegation',
      'accept',
      'parent',
      'delegation-1',
      '1',
      'Reviewed',
      'and',
      'accepted',
    ])

    expect(buildSessionsCliPayload(submit.name, submit.arguments)).toMatchObject({
      request: {
        command: {
          operation: 'delegation-submit',
          sessionId: 'worker',
          delegationId: 'delegation-1',
          summary: 'Implementation ready',
          evidence: [{ kind: 'observed-command' }],
        },
      },
    })
    expect(buildSessionsCliPayload(accept.name, accept.arguments)).toMatchObject({
      request: {
        command: {
          operation: 'delegation-accept',
          sessionId: 'parent',
          delegationId: 'delegation-1',
          submissionRevision: 1,
          note: 'Reviewed and accepted',
        },
      },
    })
  })

  it('builds paginated discovery and explicit full-transcript queries', () => {
    const list = command(['list', '--project', '/project', '--limit', '25', '--archived'])
    const search = command([
      'search',
      'socket',
      'ownership',
      '--full-transcript',
      '--include-archived',
      '--mode',
      'semantic',
      '--require-fresh',
      '--timeout-ms',
      '2500',
    ])

    expect(buildSessionsCliPayload(list.name, list.arguments)).toMatchObject({
      contract: 'session-query-v2',
      request: {
        query: {
          operation: 'list',
          projectPath: '/project',
          limit: 25,
          archived: true,
        },
      },
    })
    expect(buildSessionsCliPayload(search.name, search.arguments)).toMatchObject({
      contract: 'session-query-v2',
      request: {
        query: {
          operation: 'search',
          query: 'socket ownership',
          searchScope: 'full-transcript',
          includeArchived: true,
          mode: 'semantic',
          requireFresh: true,
          waitTimeoutMs: 2500,
        },
      },
    })
  })
})
