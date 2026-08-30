import { describe, expect, it } from 'vitest'
import { buildSessionsToolPayload } from '../sessions-tool-extension'

describe('Pi-native Sessions tool lifecycle payload', () => {
  it('binds Worker spawn to the current durable Session and exact parent Run', () => {
    expect(
      buildSessionsToolPayload(
        {
          action: 'spawn',
          objective: 'Review the authorization boundary',
          workspace: 'new-worktree',
          baseRef: 'release',
          startFromOrigin: true,
          agent: 'security-reviewer',
          authorization: 'yolo',
          deliverables: ['Findings'],
          acceptanceCriteria: ['No critical gaps'],
          resourceReferences: ['docs/security-model.md'],
        },
        { sessionId: 'session-queen', runId: 'run-current' },
      ),
    ).toMatchObject({
      contract: 'session-lifecycle-v2',
      request: {
        command: {
          operation: 'spawn',
          parentSessionId: 'session-queen',
          expectedParentRunId: 'run-current',
          workspace: { mode: 'new-worktree', baseRef: 'release', startFromOrigin: true },
          specialization: { agentDefinitionName: 'security-reviewer' },
          runAuthorizationOverride: 'yolo',
          delegation: {
            objective: 'Review the authorization boundary',
            deliverables: ['Findings'],
            acceptanceCriteria: ['No critical gaps'],
            resourceReferences: ['docs/security-model.md'],
          },
        },
      },
    })
  })

  it('creates or launches an independent Hive without adding Spawn lineage', () => {
    expect(
      buildSessionsToolPayload(
        { action: 'create', title: 'Future investigation', workspace: 'current' },
        {
          sessionId: 'session-queen',
          runId: 'run-current',
          workingDirectory: '/repo/worktree',
          projectPath: '/repo',
        },
      ),
    ).toMatchObject({
      request: {
        command: {
          operation: 'create',
          projectPath: '/repo',
          title: 'Future investigation',
          workspace: { mode: 'current' },
        },
      },
    })
    expect(
      buildSessionsToolPayload(
        {
          action: 'launch',
          objective: 'Investigate a separate concern',
          workspace: 'new-worktree',
          baseRef: 'main',
          authorization: 'yolo',
        },
        { sessionId: 'session-queen', runId: 'run-current', projectPath: '/repo' },
      ),
    ).toMatchObject({
      request: {
        command: {
          operation: 'launch',
          projectPath: '/repo',
          objective: 'Investigate a separate concern',
          workspace: { mode: 'new-worktree', baseRef: 'main' },
          runAuthorizationOverride: 'yolo',
        },
      },
    })
  })

  it('rejects Worker Worktree controls for non-Worktree placement', () => {
    expect(() =>
      buildSessionsToolPayload(
        {
          action: 'spawn',
          objective: 'Review',
          workspace: 'local',
          startFromOrigin: false,
        },
        { sessionId: 'session-queen', runId: 'run-current' },
      ),
    ).toThrow('baseRef and startFromOrigin require Workspace new-worktree')
  })
})
