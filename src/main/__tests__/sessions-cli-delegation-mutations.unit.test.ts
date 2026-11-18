import { describe, expect, it } from 'vitest'
import { parseMcpCliArguments } from '../mcp-cli-arguments'
import type { SessionsCliStructuredInput } from '../sessions-cli-delegation-input'
import { buildSessionsCliPayload } from '../sessions-cli-payload'

function payload(args: readonly string[], structured: SessionsCliStructuredInput = {}) {
  const parsed = parseMcpCliArguments(args)
  const command = parsed.positionals[0]
  if (!command) throw new Error('Missing command.')
  return buildSessionsCliPayload(
    command,
    { ...parsed, positionals: parsed.positionals.slice(1) },
    { workingDirectory: '/repo/worktree', structured },
  )
}

describe('Hive CLI Delegation mutation payloads', () => {
  it('uses the same mutation contract for submission and review', () => {
    expect(
      payload(['delegation-accept', 'queen', 'delegation-1', '2', 'Looks', 'good']),
    ).toMatchObject({
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
        'delegation-verify',
        'queen',
        'delegation-1',
        '2',
        'passed',
        'Fresh',
        'tests',
        'passed',
        '--evidence-command',
        'pnpm test passed',
        '--evidence-diff',
        'Two files changed',
        '--evidence-note',
        'Checked by hand',
        '--evidence-artifact',
        'https://ci.example.test/run/1',
        '--evidence-source',
        'src/main/a.ts:12',
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
          evidence: [
            { kind: 'observed-command', summary: 'pnpm test passed' },
            { kind: 'workspace-diff', summary: 'Two files changed' },
            { kind: 'asserted-note', summary: 'Checked by hand' },
            {
              kind: 'artifact',
              summary: 'https://ci.example.test/run/1',
              reference: 'https://ci.example.test/run/1',
            },
            {
              kind: 'source-reference',
              summary: 'src/main/a.ts:12',
              reference: 'src/main/a.ts:12',
            },
          ],
        },
      },
    })
  })

  it('records an explicit Worker-owned unresolved state transition', () => {
    expect(
      payload(['delegation-state', 'worker', 'delegation-1', 'waiting', 'Blocked', 'on', 'API']),
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

  it('records exact Worker scope claims from the claim options', () => {
    expect(
      payload([
        'delegation-claim',
        'worker',
        'delegation-1',
        'Editing',
        'the',
        'renderer',
        '--write-tree',
        'src/renderer',
        '--read',
        'package.json',
        '--write',
        'src/main/a.ts',
        '--read-tree',
        'docs',
        '--read-resource',
        'project:ports/5173',
        '--write-resource',
        'repository:branches/feat/x',
      ]),
    ).toMatchObject({
      request: {
        command: {
          operation: 'delegation-claim',
          sessionId: 'worker',
          delegationId: 'delegation-1',
          reason: 'Editing the renderer',
          claims: [
            { access: 'read', target: { type: 'workspace-file', path: 'package.json' } },
            { access: 'write', target: { type: 'workspace-file', path: 'src/main/a.ts' } },
            { access: 'read', target: { type: 'workspace-tree', path: 'docs' } },
            { access: 'write', target: { type: 'workspace-tree', path: 'src/renderer' } },
            {
              access: 'read',
              target: {
                type: 'named-resource',
                scope: 'project',
                namespace: 'ports',
                name: '5173',
              },
            },
            {
              access: 'write',
              target: {
                type: 'named-resource',
                scope: 'repository',
                namespace: 'branches',
                name: 'feat/x',
              },
            },
          ],
        },
      },
    })
  })

  it('records a Queen conflict acknowledgement against exact evidence', () => {
    expect(
      payload([
        'delegation-conflict-acknowledge',
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
        'delegation-dependency',
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
    const specification = {
      objective: 'Document the verifier.',
      deliverables: ['Documentation'],
      acceptanceCriteria: ['Usage is documented'],
      dependencies: [],
      resourceReferences: [],
    }
    expect(
      payload(
        ['delegation-propose-amendment', 'worker', 'delegation-1', '1', 'Add', 'documentation'],
        { specification },
      ),
    ).toMatchObject({
      request: {
        command: {
          operation: 'delegation-propose-amendment',
          reason: 'Add documentation',
          specification,
        },
      },
    })
    expect(
      payload(
        [
          'delegation-amend',
          'queen',
          'delegation-1',
          '1',
          'Apply',
          'proposal',
          '--proposal',
          'proposal-1',
        ],
        { specification },
      ),
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
    expect(
      payload(['delegation-reopen', 'queen', 'delegation-1', 'Target', 'changed']),
    ).toMatchObject({
      request: {
        command: {
          operation: 'delegation-reopen',
          sessionId: 'queen',
          delegationId: 'delegation-1',
          reason: 'Target changed',
        },
      },
    })
    expect(
      payload(['delegation-cancel', 'queen', 'delegation-1', 'No', 'longer', 'needed']),
    ).toMatchObject({
      request: {
        command: {
          operation: 'delegation-cancel',
          reason: 'No longer needed',
        },
      },
    })
  })

  it('refuses a malformed named-resource claim', () => {
    expect(() =>
      payload([
        'delegation-claim',
        'worker',
        'delegation-1',
        'Ports',
        '--read-resource',
        'ports/5173',
      ]),
    ).toThrow('--read-resource takes <project|repository>:<namespace>/<name>')
    expect(() =>
      payload([
        'delegation-claim',
        'worker',
        'delegation-1',
        'Ports',
        '--write-resource',
        'workspace:ports/5173',
      ]),
    ).toThrow('--write-resource takes')
  })

  it('requires the specification an amendment applies', () => {
    expect(() =>
      payload(['delegation-amend', 'queen', 'delegation-1', '1', 'Narrow', '--objective', 'x']),
    ).toThrow('Delegation amendment requires a Delegation specification.')
  })
})
