import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { OpenWaggleMcpServeOptions } from '../openwaggle-mcp-server-policy'
import {
  mcpSessionPathAllowed,
  prepareMcpSessionTargetScope,
} from '../openwaggle-mcp-session-scope-v2'
import {
  buildMcpSessionPayloadV2,
  filterMcpSessionQueryResult,
  mcpTransientAuthority,
  prepareMcpSessionFilesystemScope,
} from '../openwaggle-mcp-session-tool-v2'

let fixtureRoot = ''
let allowedRoot = ''
let privateRoot = ''

function allowedProject(name = 'project') {
  return path.join(allowedRoot, name)
}

function scopedOptions(): OpenWaggleMcpServeOptions {
  return {
    transport: 'stdio',
    grants: new Set(),
    workspaceRoots: [allowedRoot],
    sessionIds: new Set(['session-explicit']),
    profile: 'test',
    userDataRoot: '/tmp/openwaggle-test',
    version: 'test',
  }
}

describe('OpenWaggle MCP Session Control v2 scope', () => {
  beforeEach(async () => {
    fixtureRoot = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-mcp-session-scope-')),
    )
    allowedRoot = path.join(fixtureRoot, 'allowed')
    privateRoot = path.join(fixtureRoot, 'private')
    await Promise.all([
      fs.mkdir(allowedProject(), { recursive: true }),
      fs.mkdir(allowedProject('a'), { recursive: true }),
      fs.mkdir(allowedProject('b'), { recursive: true }),
      fs.mkdir(privateRoot, { recursive: true }),
    ])
  })

  afterEach(async () => {
    await fs.rm(fixtureRoot, { recursive: true, force: true })
  })

  it('rejects an apparently in-root Session path whose symlink escapes the canonical grant', async () => {
    const escaped = path.join(allowedRoot, 'escaped')
    await fs.symlink(privateRoot, escaped)

    expect(mcpSessionPathAllowed([allowedRoot], escaped)).toBe(false)
    expect(mcpSessionPathAllowed([allowedRoot], allowedProject())).toBe(true)
  })

  it('builds a least-authority Host identity from canonical MCP grants', async () => {
    const options = {
      ...scopedOptions(),
      grants: new Set(['sessions:discover' as const, 'sessions:read' as const]),
    }
    const payload = await prepareMcpSessionFilesystemScope(
      options,
      buildMcpSessionPayloadV2({
        operation: 'search',
        message: 'private protocol',
        projectPath: allowedProject(),
        fullTranscript: true,
      }),
    )

    expect(mcpTransientAuthority(options, payload)).toEqual({
      profileId: 'mcp:test',
      profileName: 'test',
      capabilities: ['sessions:discover', 'sessions:read'],
      scope: {
        workspaceRoots: [allowedRoot],
        projectPaths: [await fs.realpath(allowedProject())],
        sessionIds: ['session-explicit'],
      },
      authorizationCeiling: 'ask-for-approval',
    })
    await expect(
      prepareMcpSessionFilesystemScope(
        options,
        buildMcpSessionPayloadV2({
          operation: 'search',
          message: 'private protocol',
          projectPath: privateRoot,
        }),
      ),
    ).rejects.toThrow('outside this server profile')
  })

  it('does not let an exact-Session grant mint authority for an unrelated project', async () => {
    const options = { ...scopedOptions(), workspaceRoots: [] }
    await expect(
      prepareMcpSessionFilesystemScope(
        options,
        buildMcpSessionPayloadV2({
          operation: 'launch',
          projectPath: privateRoot,
          objective: 'Work outside the granted Session.',
        }),
      ),
    ).rejects.toThrow('requires an explicit MCP workspace grant')
  })

  it('removes Session discovery results outside the MCP workspace and exact-Session scope', async () => {
    const result = await filterMcpSessionQueryResult(scopedOptions(), async () => ({}), {
      contract: 'session-query-v2',
      response: {
        outcome: {
          operation: 'list',
          sessions: [
            { sessionId: 'session-allowed', projectPath: allowedProject() },
            { sessionId: 'session-explicit', projectPath: privateRoot },
            { sessionId: 'session-private', projectPath: privateRoot },
          ],
          nextCursor: 'cursor',
        },
      },
    })

    expect(result).toMatchObject({
      response: {
        outcome: {
          sessions: [{ sessionId: 'session-allowed' }, { sessionId: 'session-explicit' }],
          nextCursor: 'cursor',
        },
      },
    })
  })

  it('filters Delegation discovery through each linked Worker Session scope', async () => {
    const result = await filterMcpSessionQueryResult(
      scopedOptions(),
      async (payload) => {
        const query = payload.contract === 'session-query-v2' ? payload.request.query : undefined
        const projectPath =
          query && 'sessionId' in query && query.sessionId === 'worker-allowed'
            ? allowedProject()
            : privateRoot
        return {
          response: { outcome: { operation: 'read', session: { projectPath } } },
        }
      },
      {
        response: {
          outcome: {
            operation: 'delegations-list',
            delegations: [
              { delegationId: 'allowed', workerSessionId: 'worker-allowed' },
              { delegationId: 'private', workerSessionId: 'worker-private' },
            ],
          },
        },
      },
    )

    expect(result).toMatchObject({
      response: { outcome: { delegations: [{ delegationId: 'allowed' }] } },
    })
  })

  it('omits Delegation conflicts unless both linked Worker Sessions are visible', async () => {
    const result = await filterMcpSessionQueryResult(
      scopedOptions(),
      async (payload) => {
        const query = payload.contract === 'session-query-v2' ? payload.request.query : undefined
        const projectPath =
          query && 'sessionId' in query && query.sessionId === 'worker-allowed'
            ? allowedProject()
            : privateRoot
        return {
          response: { outcome: { operation: 'read', session: { projectPath } } },
        }
      },
      {
        response: {
          outcome: {
            operation: 'delegations-conflicts',
            conflicts: [
              {
                conflictId: 'both-visible',
                leftWorkerSessionId: 'worker-allowed',
                rightWorkerSessionId: 'session-explicit',
              },
              {
                conflictId: 'hidden-peer',
                leftWorkerSessionId: 'worker-allowed',
                rightWorkerSessionId: 'worker-private',
              },
            ],
          },
        },
      },
    )

    expect(result).toMatchObject({
      response: { outcome: { conflicts: [{ conflictId: 'both-visible' }] } },
    })
  })

  it('resolves Worker report references only against Sessions visible to the MCP grant', async () => {
    const submittedPayloads: unknown[] = []
    const payload = buildMcpSessionPayloadV2({
      operation: 'report',
      sessionId: 'session-explicit',
      reportTarget: 'worker-reference',
      workerReference: 'reviewer',
      message: 'Please review this.',
    })

    const scopedPayload = await prepareMcpSessionTargetScope(
      scopedOptions(),
      async (candidatePayload) => {
        submittedPayloads.push(candidatePayload)
        if (candidatePayload.contract !== 'session-query-v2') return {}
        const query = candidatePayload.request.query
        if (query.operation === 'list') {
          return {
            response: {
              outcome: {
                operation: 'list',
                sessions: [
                  {
                    sessionId: 'worker-allowed',
                    title: 'Allowed Worker',
                    agentDefinitionName: 'reviewer',
                    projectPath: allowedProject(),
                  },
                  {
                    sessionId: 'worker-private',
                    title: 'Private Worker',
                    agentDefinitionName: 'reviewer',
                    projectPath: privateRoot,
                  },
                ],
              },
            },
          }
        }
        return {
          response: {
            outcome: {
              operation: 'read',
              session: { projectPath: allowedProject() },
            },
          },
        }
      },
      payload,
    )

    expect(scopedPayload).toMatchObject({
      request: {
        command: {
          operation: 'report',
          target: { type: 'session', sessionId: 'worker-allowed' },
        },
      },
    })
    expect(submittedPayloads).toHaveLength(2)
  })

  it('does not expose hidden Workers in ambiguous report-reference errors', async () => {
    const payload = buildMcpSessionPayloadV2({
      operation: 'report',
      sessionId: 'session-explicit',
      reportTarget: 'worker-reference',
      workerReference: 'reviewer',
      message: 'Please review this.',
    })

    await expect(
      prepareMcpSessionTargetScope(
        scopedOptions(),
        async () => ({
          response: {
            outcome: {
              operation: 'list',
              sessions: [
                {
                  sessionId: 'worker-allowed-a',
                  title: 'Reviewer',
                  projectPath: allowedProject('a'),
                },
                {
                  sessionId: 'worker-allowed-b',
                  agentDefinitionName: 'Reviewer',
                  projectPath: allowedProject('b'),
                },
                {
                  sessionId: 'worker-private',
                  title: 'Reviewer',
                  projectPath: privateRoot,
                },
              ],
            },
          },
        }),
        payload,
      ),
    ).rejects.toThrow(
      'Worker reference "reviewer" is ambiguous in the granted scope: worker-allowed-a, worker-allowed-b.',
    )
  })
})
