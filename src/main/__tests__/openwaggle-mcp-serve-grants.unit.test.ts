import { describe, expect, it, vi } from 'vitest'
import type { OpenWaggleMcpServeOptions } from '../openwaggle-mcp-server-policy'
import { OPENWAGGLE_MCP_SESSION_OPERATIONS_V2 } from '../openwaggle-mcp-session-operations-v2'

vi.mock('electron', () => ({ app: { getPath: vi.fn(), getVersion: vi.fn(() => 'test') } }))

const { MCP_SESSION_OPERATION_BASE_CAPABILITIES_V2 } = await import(
  '../openwaggle-mcp-session-operation-grants-v2'
)
const { buildMcpSessionPayloadV2, mcpSessionHostIdentity, sessionInputSchemaForGrantsV2 } =
  await import('../openwaggle-mcp-session-tool-v2')
const { advertisedSessionInputSchemaV2 } = await import('../openwaggle-mcp-session-input-v2')
const { requiredSessionQueryCapabilities, requiredSessionControlCapabilities } = await import(
  '../domain/session-control/session-capability-authorization'
)

function options(identity: OpenWaggleMcpServeOptions['identity']): OpenWaggleMcpServeOptions {
  return {
    transport: 'stdio',
    grants: new Set(['sessions:discover', 'sessions:read']),
    workspaceRoots: ['/workspace'],
    sessionIds: new Set(['session-1']),
    identity,
    userDataRoot: '/user-data',
    version: 'test',
  }
}

describe('mcp serve grants (#350)', () => {
  it('advertises exactly the operations whose base capabilities were granted', () => {
    const schema = advertisedSessionInputSchemaV2(new Set(['sessions:read']))
    const advertised = OPENWAGGLE_MCP_SESSION_OPERATIONS_V2.filter(
      (operation) => schema.safeParse({ operation }).success,
    )

    expect(advertised).toEqual([
      'read',
      'turns',
      'items',
      'status',
      'requests-list',
      'wait',
      'agent-definitions-list',
      'agent-definitions-search',
    ])
  })

  it('lists the advertised operations but still accepts any operation, for its grant error', async () => {
    const schema = sessionInputSchemaForGrantsV2(new Set(['sessions:discover']))
    const listed = JSON.stringify(schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }))

    expect(listed).toContain('"const":"list"')
    expect(listed).not.toContain('"const":"read"')
    expect(
      await schema['~standard'].validate({ operation: 'read', sessionId: 'session-1' }),
    ).toMatchObject({ value: { operation: 'read' } })
    expect(await schema['~standard'].validate({ operation: 'read', typo: true })).toMatchObject({
      issues: expect.any(Array),
    })
  })

  it('keeps the base capability table in step with the Session Host requirements', () => {
    const read = buildMcpSessionPayloadV2({ operation: 'read', sessionId: 'session-1' })
    const steer = buildMcpSessionPayloadV2({
      operation: 'steer',
      sessionId: 'session-1',
      expectedRunId: 'run-1',
      message: 'hi',
    })
    if (read.contract !== 'session-query-v2' || steer.contract !== 'session-control-v2') {
      throw new Error('Unexpected payload contracts.')
    }

    expect(requiredSessionQueryCapabilities(read.request.query)).toEqual(
      MCP_SESSION_OPERATION_BASE_CAPABILITIES_V2.read,
    )
    expect(requiredSessionControlCapabilities(steer.request.command)).toEqual(
      MCP_SESSION_OPERATION_BASE_CAPABILITIES_V2.steer,
    )
  })

  it('authenticates an owner server with transient authority only', () => {
    expect(
      mcpSessionHostIdentity(
        options({ kind: 'owner', label: 'local-stdio', authorizationCeiling: 'ask-for-approval' }),
      ),
    ).toEqual({
      clientKind: 'mcp',
      transientAuthority: {
        profileId: 'mcp:local-stdio',
        profileName: 'local-stdio',
        capabilities: ['sessions:discover', 'sessions:read'],
        scope: { workspaceRoots: ['/workspace'], sessionIds: ['session-1'] },
        authorizationCeiling: 'ask-for-approval',
      },
    })
  })

  it('authenticates a profile server as the profile, sending its grants only as a narrowing', () => {
    expect(
      mcpSessionHostIdentity(options({ kind: 'profile', profile: 'ci', credential: 'secret' })),
    ).toEqual({
      clientKind: 'mcp',
      profile: 'ci',
      profileCredential: 'secret',
      transientAuthority: {
        profileId: 'mcp-profile:ci',
        profileName: 'ci',
        capabilities: ['sessions:discover', 'sessions:read'],
        scope: { workspaceRoots: ['/workspace'], sessionIds: ['session-1'] },
        authorizationCeiling: 'yolo',
      },
    })
  })
})
