import { describe, expect, it } from 'vitest'
import { buildMcpSessionPayloadV2 } from '../openwaggle-mcp-session-tool-v2'

describe('OpenWaggle MCP Session v2 option contract', () => {
  it('keeps spawn resource references separate from export resources', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'spawn',
        sessionId: 'queen',
        expectedRunId: 'run-1',
        objective: 'Review',
        resourceReferences: ['docs/spec.md'],
      }),
    ).toMatchObject({
      request: {
        command: {
          delegation: { resourceReferences: ['docs/spec.md'] },
        },
      },
    })
    expect(() =>
      buildMcpSessionPayloadV2({
        operation: 'spawn',
        sessionId: 'queen',
        expectedRunId: 'run-1',
        objective: 'Review',
        exportResources: ['not-worker-context.md'],
      }),
    ).toThrow('exportResources is supported only by the export-create operation')
    expect(() =>
      buildMcpSessionPayloadV2({
        operation: 'export-create',
        sessionId: 'queen',
        destinationPath: '/tmp/export.jsonl',
        resourceReferences: ['not-an-export-resource.md'],
      }),
    ).toThrow('resourceReferences is supported only by the spawn operation')
  })

  it('rejects lifecycle Worktree controls unless new-worktree is explicit', () => {
    expect(() =>
      buildMcpSessionPayloadV2({
        operation: 'launch',
        projectPath: '/repo',
        objective: 'Review',
        baseRef: 'release',
      }),
    ).toThrow('baseRef and startFromOrigin require workspace new-worktree')
    expect(() =>
      buildMcpSessionPayloadV2({
        operation: 'create',
        projectPath: '/repo',
        workspace: 'local',
        startFromOrigin: false,
      }),
    ).toThrow('baseRef and startFromOrigin require workspace new-worktree')
  })

  it('maps queue authorization repair through the singular Follow-up identity', () => {
    expect(
      buildMcpSessionPayloadV2({
        operation: 'queue-update-authorization',
        sessionId: 'session-1',
        followUpId: 'follow-up-1',
        runAuthorizationOverride: 'inherit',
      }),
    ).toMatchObject({
      request: {
        command: {
          operation: 'queue-update-authorization',
          sessionId: 'session-1',
          followUpId: 'follow-up-1',
        },
      },
    })
  })
})
