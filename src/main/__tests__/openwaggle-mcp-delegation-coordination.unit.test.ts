import { describe, expect, it } from 'vitest'
import { buildMcpSessionPayloadV2 } from '../openwaggle-mcp-session-tool-v2'

describe('OpenWaggle MCP Delegation coordination', () => {
  const specification = {
    objective: 'Document the verifier.',
    deliverables: ['Documentation'],
    acceptanceCriteria: ['Usage is documented'],
    dependencies: [],
    resourceReferences: [],
  }
  it('maps structured Worker scope claims', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'delegation-claim',
        sessionId: 'worker',
        delegationId: 'delegation-1',
        reason: 'Editing the repository.',
        claims: [
          {
            access: 'write',
            target: { type: 'named-resource', scope: 'repository', namespace: 'git', name: 'HEAD' },
          },
        ],
      }),
    ).toMatchObject({
      request: {
        command: {
          operation: 'delegation-claim',
          sessionId: 'worker',
          claims: [{ target: { type: 'named-resource', name: 'HEAD' } }],
        },
      },
    })
  })

  it('maps Queen conflict acknowledgement and dependency revision', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'delegation-conflict-acknowledge',
        sessionId: 'queen',
        delegationId: 'delegation-1',
        conflictId: 'conflict-1',
        reason: 'The Workers coordinated.',
      }),
    ).toMatchObject({ request: { command: { conflictId: 'conflict-1' } } })
    expect(
      buildMcpSessionPayloadV2({
        operation: 'delegation-dependency',
        sessionId: 'queen',
        delegationId: 'delegation-1',
        dependencyAction: 'add',
        dependencyDelegationId: 'delegation-schema',
        dependencyRequiredState: 'accepted',
        reason: 'The schema must land first.',
      }),
    ).toMatchObject({
      request: {
        command: {
          operation: 'delegation-dependency',
          dependencyDelegationId: 'delegation-schema',
          requiredState: 'accepted',
        },
      },
    })
  })

  it('maps conflict discovery filters to the shared query contract', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'delegations-conflicts',
        catalogScope: 'all',
        delegationId: 'delegation-1',
        conflictKinds: ['live-overlap'],
        conflictStatuses: ['unacknowledged'],
      }),
    ).toMatchObject({
      request: {
        query: {
          operation: 'delegations-conflicts',
          delegationId: 'delegation-1',
          kinds: ['live-overlap'],
          statuses: ['unacknowledged'],
        },
      },
    })
  })

  it('maps Worker proposal and parent amendment as distinct operations', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'delegation-propose-amendment',
        sessionId: 'worker',
        delegationId: 'delegation-1',
        specificationRevision: 1,
        delegationSpecification: specification,
        reason: 'Add documentation.',
      }),
    ).toMatchObject({ request: { command: { operation: 'delegation-propose-amendment' } } })
    expect(
      buildMcpSessionPayloadV2({
        operation: 'delegation-amend',
        sessionId: 'queen',
        delegationId: 'delegation-1',
        specificationRevision: 1,
        delegationSpecification: specification,
        proposalId: 'proposal-1',
        reason: 'Apply proposal.',
      }),
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

  it('maps explicit verification as a review record', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'delegation-verify',
        sessionId: 'queen',
        delegationId: 'delegation-1',
        submissionRevision: 2,
        verificationOutcome: 'passed',
        message: 'Fresh tests passed.',
        evidence: [{ kind: 'observed-command', summary: 'pnpm test passed.' }],
      }),
    ).toMatchObject({
      request: {
        command: {
          operation: 'delegation-verify',
          submissionRevision: 2,
          outcome: 'passed',
          summary: 'Fresh tests passed.',
        },
      },
    })
  })
})
