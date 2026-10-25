import { describe, expect, it } from 'vitest'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import { buildSessionsCliPayload } from '../sessions-cli-payload'

function payload(args: readonly string[]) {
  const parsed = parseMcpCliArguments(args)
  const command = parsed.positionals[0]
  if (!command) throw new Error('Missing command.')
  return buildSessionsCliPayload(
    command,
    { ...parsed, positionals: parsed.positionals.slice(1) },
    { workingDirectory: '/repo/worktree' },
  )
}

describe('Hive CLI Delegation payloads', () => {
  it('resolves an explicit project filter against the caller Working path', () => {
    expect(payload(['delegations-list', '--project', '..'])).toMatchObject({
      request: { query: { projectPath: '/repo' } },
    })
    expect(payload(['delegations-conflicts', '--project', '../project'])).toMatchObject({
      request: { query: { projectPath: '/repo/project' } },
    })
  })

  it('lists the current Working path with contract filters by default', () => {
    expect(
      payload([
        'delegations-list',
        '--parent',
        'queen',
        '--state',
        'ready_for_review',
        '--state',
        'needs_attention',
      ]),
    ).toMatchObject({
      contract: 'session-query-v2',
      request: {
        query: {
          operation: 'delegations-list',
          workingPath: '/repo/worktree',
          parentSessionId: 'queen',
          states: ['ready_for_review', 'needs_attention'],
        },
      },
    })
  })

  it('reads one stable Delegation identity', () => {
    expect(payload(['delegations-read', 'delegation-1'])).toMatchObject({
      request: { query: { operation: 'delegations-read', delegationId: 'delegation-1' } },
    })
  })

  it('lists conflicts with exact lifecycle filters', () => {
    expect(
      payload([
        'delegations-conflicts',
        '--delegation',
        'delegation-1',
        '--kind',
        'merge-overlap',
        '--status',
        'unacknowledged',
      ]),
    ).toMatchObject({
      request: {
        query: {
          operation: 'delegations-conflicts',
          workingPath: '/repo/worktree',
          delegationId: 'delegation-1',
          kinds: ['merge-overlap'],
          statuses: ['unacknowledged'],
        },
      },
    })
  })

  it('deduplicates repeated finite filters before Host decoding', () => {
    expect(
      payload(['delegations-list', '--all', '--state', 'working', '--state', 'working']),
    ).toMatchObject({
      request: { query: { states: ['working'] } },
    })
    expect(
      payload([
        'delegations-conflicts',
        '--all',
        '--kind',
        'live-overlap',
        '--kind',
        'live-overlap',
        '--status',
        'resolved',
        '--status',
        'resolved',
      ]),
    ).toMatchObject({
      request: { query: { kinds: ['live-overlap'], statuses: ['resolved'] } },
    })
  })
})
