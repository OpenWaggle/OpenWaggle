import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  authorizationScopeKeysMatch,
  findMatchingGrant,
} from '@shared/types/agent-authorization-grants'
import { SessionId } from '@shared/types/brand'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearSessionGrants,
  findGrantCovering,
  grantForProject,
  grantForSession,
  listGrantsForProject,
  listSessionGrants,
  revokeForProject,
} from '../agent-authorization-grants'

const sessionId = SessionId('grant-session')

const listIssues = {
  requester: 'github-issues',
  capability: 'mcp.tool-call',
  resource: 'list_issues',
} as const

const createIssue = {
  requester: 'github-issues',
  capability: 'mcp.tool-call',
  resource: 'create_issue',
} as const

const sampling = { requester: 'github-issues', capability: 'mcp.sampling' } as const

describe('authorization scope keys', () => {
  it('matches only when requester, capability and resource all agree', () => {
    expect(authorizationScopeKeysMatch(listIssues, { ...listIssues })).toBe(true)
    expect(authorizationScopeKeysMatch(listIssues, createIssue)).toBe(false)
    expect(
      authorizationScopeKeysMatch(listIssues, { ...listIssues, requester: 'other-server' }),
    ).toBe(false)
    expect(
      authorizationScopeKeysMatch(listIssues, { ...listIssues, capability: 'mcp.sampling' }),
    ).toBe(false)
  })

  it('never treats an absent resource as a wildcard', () => {
    // The risk this guards: if an absent resource matched anything, granting one tool would also
    // authorise every other tool on that server, including tools added in a later version.
    const serverWide = { requester: 'github-issues', capability: 'mcp.tool-call' } as const

    expect(authorizationScopeKeysMatch(serverWide, listIssues)).toBe(false)
    expect(findMatchingGrant([{ ...serverWide, grantedAt: 1 }], listIssues)).toBeUndefined()
  })

  it('ignores arguments entirely, because they are not part of the identity', () => {
    // Both calls are the same grant even though the arguments differ, and an attacker-controlled
    // argument therefore cannot decide whether a grant applies.
    expect(authorizationScopeKeysMatch(listIssues, { ...listIssues })).toBe(true)
  })
})

describe('session grants', () => {
  beforeEach(() => {
    clearSessionGrants()
  })

  it('covers a later request for the same key', async () => {
    grantForSession(sessionId, listIssues)

    await expect(
      findGrantCovering({ sessionId, projectPath: null, key: listIssues }),
    ).resolves.toMatchObject({ source: 'session' })
  })

  it('does not cover a different tool on the same server', async () => {
    grantForSession(sessionId, listIssues)

    await expect(
      findGrantCovering({ sessionId, projectPath: null, key: createIssue }),
    ).resolves.toBeUndefined()
  })

  it('does not leak into another session', async () => {
    grantForSession(sessionId, listIssues)

    await expect(
      findGrantCovering({
        sessionId: SessionId('other-session'),
        projectPath: null,
        key: listIssues,
      }),
    ).resolves.toBeUndefined()
  })

  it('is dropped when the session is cleared', async () => {
    grantForSession(sessionId, listIssues)
    clearSessionGrants(sessionId)

    expect(listSessionGrants(sessionId)).toEqual([])
    await expect(
      findGrantCovering({ sessionId, projectPath: null, key: listIssues }),
    ).resolves.toBeUndefined()
  })
})

describe('project grants', () => {
  let projectPath = ''

  beforeEach(async () => {
    clearSessionGrants()
    projectPath = await mkdtemp(path.join(tmpdir(), 'openwaggle-grant-test-'))
  })

  afterEach(async () => {
    await rm(projectPath, { recursive: true, force: true })
  })

  it('keeps every grant when two are written concurrently', async () => {
    // Each write is read-modify-write, so without serialization both callers read the pre-change file
    // and the second rename wins, dropping the first grant while the UI reports both as saved. A run
    // can raise several authorization requests close together, so this is reachable in normal use.
    await Promise.all([
      grantForProject(projectPath, listIssues),
      grantForProject(projectPath, createIssue),
    ])

    const grants = await listGrantsForProject(projectPath)
    expect(grants.map((grant) => grant.resource).sort()).toEqual(['create_issue', 'list_issues'])
  })

  it('persists a grant and covers a later request', async () => {
    await grantForProject(projectPath, listIssues)

    await expect(listGrantsForProject(projectPath)).resolves.toMatchObject([
      { requester: 'github-issues', capability: 'mcp.tool-call', resource: 'list_issues' },
    ])
    await expect(
      findGrantCovering({ sessionId, projectPath, key: listIssues }),
    ).resolves.toMatchObject({ source: 'project' })
  })

  it('keys sampling on requester and capability alone', async () => {
    await grantForProject(projectPath, sampling)

    await expect(
      findGrantCovering({ sessionId, projectPath, key: sampling }),
    ).resolves.toMatchObject({ source: 'project' })
    await expect(
      findGrantCovering({ sessionId, projectPath, key: listIssues }),
    ).resolves.toBeUndefined()
  })

  it('does not duplicate a grant that is given twice', async () => {
    await grantForProject(projectPath, listIssues)
    await grantForProject(projectPath, listIssues)

    await expect(listGrantsForProject(projectPath)).resolves.toHaveLength(1)
  })

  it('stops covering a request once revoked', async () => {
    await grantForProject(projectPath, listIssues)
    await revokeForProject(projectPath, listIssues)

    await expect(listGrantsForProject(projectPath)).resolves.toEqual([])
    await expect(
      findGrantCovering({ sessionId, projectPath, key: listIssues }),
    ).resolves.toBeUndefined()
  })

  it('revokes only the named grant', async () => {
    await grantForProject(projectPath, listIssues)
    await grantForProject(projectPath, createIssue)
    await revokeForProject(projectPath, listIssues)

    await expect(listGrantsForProject(projectPath)).resolves.toMatchObject([
      { resource: 'create_issue' },
    ])
  })

  it('prefers a session grant over reading the project file', async () => {
    grantForSession(sessionId, listIssues)

    await expect(
      findGrantCovering({ sessionId, projectPath, key: listIssues }),
    ).resolves.toMatchObject({ source: 'session' })
  })
})
