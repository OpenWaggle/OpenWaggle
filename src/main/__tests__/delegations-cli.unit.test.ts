import { describe, expect, it } from 'vitest'
import { buildDelegationsCliPayload } from '../delegations-cli-payload'
import { parseMcpCliArguments } from '../mcp-cli-arguments'

function payload(args: readonly string[]) {
  const parsed = parseMcpCliArguments(args)
  const command = parsed.positionals[0]
  if (!command) throw new Error('Missing command.')
  return buildDelegationsCliPayload(
    command,
    { ...parsed, positionals: parsed.positionals.slice(1) },
    { workingDirectory: '/repo/worktree' },
  )
}

describe('Delegations CLI payloads', () => {
  it('resolves an explicit project filter against the caller Working path', () => {
    expect(payload(['list', '--project', '..'])).toMatchObject({
      request: { query: { projectPath: '/repo' } },
    })
    expect(payload(['conflicts', '--project', '../project'])).toMatchObject({
      request: { query: { projectPath: '/repo/project' } },
    })
  })

  it('lists the current Working path with contract filters by default', () => {
    expect(
      payload([
        'list',
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
    expect(payload(['read', 'delegation-1'])).toMatchObject({
      request: { query: { operation: 'delegations-read', delegationId: 'delegation-1' } },
    })
  })

  it('lists conflicts with exact lifecycle filters', () => {
    expect(
      payload([
        'conflicts',
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

  it('uses the same mutation contract for submission and review', () => {
    expect(payload(['accept', 'queen', 'delegation-1', '2', 'Looks', 'good'])).toMatchObject({
      request: {
        command: {
          operation: 'delegation-accept',
          sessionId: 'queen',
          delegationId: 'delegation-1',
          submissionRevision: 2,
          note: 'Looks good',
        },
      },
    })
  })

  it('records an explicit verification without accepting the submission', () => {
    expect(
      payload([
        'verify',
        'queen',
        'delegation-1',
        '2',
        'passed',
        'Fresh',
        'tests',
        'passed',
        '--evidence-json',
        '{"kind":"observed-command","summary":"pnpm test passed"}',
      ]),
    ).toMatchObject({
      request: {
        command: {
          operation: 'delegation-verify',
          sessionId: 'queen',
          delegationId: 'delegation-1',
          submissionRevision: 2,
          outcome: 'passed',
          summary: 'Fresh tests passed',
          evidence: [{ kind: 'observed-command', summary: 'pnpm test passed' }],
        },
      },
    })
  })

  it('records an explicit Worker-owned unresolved state transition', () => {
    expect(
      payload(['state', 'worker', 'delegation-1', 'waiting', 'Blocked', 'on', 'API']),
    ).toMatchObject({
      request: {
        command: {
          operation: 'delegation-state',
          sessionId: 'worker',
          delegationId: 'delegation-1',
          state: 'waiting',
          reason: 'Blocked on API',
        },
      },
    })
  })

  it('records exact Worker scope claims through structured JSON', () => {
    expect(
      payload([
        'claim',
        'worker',
        'delegation-1',
        'Editing',
        'the',
        'renderer',
        '--claim-json',
        '{"access":"write","target":{"type":"workspace-tree","path":"src/renderer"}}',
      ]),
    ).toMatchObject({
      request: {
        command: {
          operation: 'delegation-claim',
          sessionId: 'worker',
          delegationId: 'delegation-1',
          reason: 'Editing the renderer',
          claims: [
            {
              access: 'write',
              target: { type: 'workspace-tree', path: 'src/renderer' },
            },
          ],
        },
      },
    })
  })

  it('records a Queen conflict acknowledgement against exact evidence', () => {
    expect(
      payload([
        'acknowledge-conflict',
        'queen',
        'delegation-1',
        'conflict-1',
        'Workers',
        'coordinated',
      ]),
    ).toMatchObject({
      request: {
        command: {
          operation: 'delegation-conflict-acknowledge',
          sessionId: 'queen',
          delegationId: 'delegation-1',
          conflictId: 'conflict-1',
          reason: 'Workers coordinated',
        },
      },
    })
  })

  it('creates an immutable specification revision for a dependency edit', () => {
    expect(
      payload([
        'dependency',
        'queen',
        'delegation-1',
        'add',
        'delegation-prerequisite',
        'accepted',
        'Need',
        'the',
        'schema',
        'first',
      ]),
    ).toMatchObject({
      request: {
        command: {
          operation: 'delegation-dependency',
          action: 'add',
          dependencyDelegationId: 'delegation-prerequisite',
          requiredState: 'accepted',
          reason: 'Need the schema first',
        },
      },
    })
  })

  it('keeps Worker amendment proposals separate from parent application', () => {
    const specification = JSON.stringify({
      objective: 'Document the verifier.',
      deliverables: ['Documentation'],
      acceptanceCriteria: ['Usage is documented'],
      dependencies: [],
      resourceReferences: [],
    })
    expect(
      payload([
        'propose-amendment',
        'worker',
        'delegation-1',
        '1',
        'Add',
        'documentation',
        '--specification-json',
        specification,
      ]),
    ).toMatchObject({
      request: {
        command: { operation: 'delegation-propose-amendment', reason: 'Add documentation' },
      },
    })
    expect(
      payload([
        'amend',
        'queen',
        'delegation-1',
        '1',
        'Apply',
        'proposal',
        '--specification-json',
        specification,
        '--proposal',
        'proposal-1',
      ]),
    ).toMatchObject({
      request: {
        command: {
          operation: 'delegation-amend',
          expectedSpecificationRevision: 1,
          proposalId: 'proposal-1',
        },
      },
    })
  })

  it('requires explicit reasons for reopening and cancelling contracts', () => {
    expect(payload(['reopen', 'queen', 'delegation-1', 'Target', 'changed'])).toMatchObject({
      request: {
        command: {
          operation: 'delegation-reopen',
          sessionId: 'queen',
          delegationId: 'delegation-1',
          reason: 'Target changed',
        },
      },
    })
    expect(payload(['cancel', 'queen', 'delegation-1', 'No', 'longer', 'needed'])).toMatchObject({
      request: {
        command: {
          operation: 'delegation-cancel',
          reason: 'No longer needed',
        },
      },
    })
  })
})
