import { describe, expect, it } from 'vitest'
import { buildSessionsToolPayload } from '../sessions-tool-extension'

describe('Pi-native Sessions Delegation coordination', () => {
  const specification = {
    objective: 'Document the verifier.',
    deliverables: ['Documentation'],
    acceptanceCriteria: ['Usage is documented'],
    dependencies: [],
    resourceReferences: [],
  }
  it('maps contribution and review operations from the current Session', () => {
    expect(
      buildSessionsToolPayload(
        {
          action: 'delegation_claim',
          delegationId: 'delegation-1',
          reason: 'Editing the Session host.',
          claims: [
            {
              access: 'write',
              target: { type: 'workspace-tree', path: 'src/main/session-host' },
            },
          ],
        },
        { sessionId: 'worker', runId: 'run-worker' },
      ),
    ).toMatchObject({ request: { command: { operation: 'delegation-claim' } } })
    expect(
      buildSessionsToolPayload(
        {
          action: 'delegation_dependency',
          delegationId: 'delegation-1',
          dependencyAction: 'add',
          dependencyDelegationId: 'delegation-schema',
          requiredState: 'accepted',
          reason: 'The schema must land first.',
        },
        { sessionId: 'parent', runId: 'run-parent' },
      ),
    ).toMatchObject({ request: { command: { operation: 'delegation-dependency' } } })
    expect(
      buildSessionsToolPayload(
        {
          action: 'delegation_conflict_acknowledge',
          delegationId: 'delegation-1',
          conflictId: 'conflict-1',
          reason: 'The Workers coordinated.',
        },
        { sessionId: 'parent', runId: 'run-parent' },
      ),
    ).toMatchObject({ request: { command: { conflictId: 'conflict-1' } } })
  })

  it('maps state, submission, reopening, and exact acceptance', () => {
    expect(
      buildSessionsToolPayload(
        {
          action: 'delegation_state',
          delegationId: 'delegation-1',
          state: 'waiting',
          reason: 'Waiting for a dependency.',
        },
        { sessionId: 'worker', runId: 'run-worker' },
      ),
    ).toMatchObject({ request: { command: { operation: 'delegation-state' } } })
    expect(
      buildSessionsToolPayload(
        { action: 'delegation_submit', delegationId: 'delegation-1', summary: 'Ready.' },
        { sessionId: 'worker', runId: 'run-worker' },
      ),
    ).toMatchObject({ request: { command: { operation: 'delegation-submit' } } })
    expect(
      buildSessionsToolPayload(
        {
          action: 'delegation_reopen',
          delegationId: 'delegation-1',
          reason: 'The target changed.',
        },
        { sessionId: 'parent', runId: 'run-parent' },
      ),
    ).toMatchObject({ request: { command: { operation: 'delegation-reopen' } } })
    expect(
      buildSessionsToolPayload(
        { action: 'delegation_accept', delegationId: 'delegation-1', submissionRevision: 2 },
        { sessionId: 'parent', runId: 'run-parent' },
      ),
    ).toMatchObject({ request: { command: { operation: 'delegation-accept' } } })
  })

  it('maps Worker proposal and parent amendment separately', () => {
    expect(
      buildSessionsToolPayload(
        {
          action: 'delegation_propose_amendment',
          delegationId: 'delegation-1',
          baseSpecificationRevision: 1,
          specification,
          reason: 'Add documentation.',
        },
        { sessionId: 'worker', runId: 'run-worker' },
      ),
    ).toMatchObject({ request: { command: { operation: 'delegation-propose-amendment' } } })
    expect(
      buildSessionsToolPayload(
        {
          action: 'delegation_amend',
          delegationId: 'delegation-1',
          expectedSpecificationRevision: 1,
          specification,
          reason: 'Apply proposal.',
          proposalId: 'proposal-1',
        },
        { sessionId: 'parent', runId: 'run-parent' },
      ),
    ).toMatchObject({ request: { command: { operation: 'delegation-amend' } } })
  })

  it('maps conflict discovery through the native Sessions tool', () => {
    expect(
      buildSessionsToolPayload(
        {
          action: 'delegations_conflicts',
          catalogScope: 'all',
          delegationId: 'delegation-1',
          kinds: ['merge-overlap'],
          statuses: ['resolved'],
        },
        { sessionId: 'parent', runId: 'run-parent' },
      ),
    ).toMatchObject({
      request: {
        query: {
          operation: 'delegations-conflicts',
          delegationId: 'delegation-1',
          kinds: ['merge-overlap'],
          statuses: ['resolved'],
        },
      },
    })
  })

  it('records reviewer verification without changing acceptance state', () => {
    expect(
      buildSessionsToolPayload(
        {
          action: 'delegation_verify',
          delegationId: 'delegation-1',
          submissionRevision: 2,
          outcome: 'passed',
          summary: 'Fresh tests passed.',
          evidence: [{ kind: 'observed-command', summary: 'pnpm test passed.' }],
        },
        { sessionId: 'parent', runId: 'run-parent' },
      ),
    ).toMatchObject({
      request: {
        command: {
          operation: 'delegation-verify',
          submissionRevision: 2,
          outcome: 'passed',
        },
      },
    })
  })
})
