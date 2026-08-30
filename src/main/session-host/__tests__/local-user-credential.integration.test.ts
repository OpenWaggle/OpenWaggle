import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalSessionAuthenticator } from '../local-session-authenticator'
import { credentialsMatch, ensureLocalUserCredential } from '../local-user-credential'

describe('Local Session credentials', () => {
  let temporaryRoot = ''

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-credential-'))
  })

  afterEach(async () => {
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('creates one owner-only 256-bit credential and reuses it on later starts', async () => {
    const credentialPath = path.join(temporaryRoot, 'local-user.credential')
    const first = await ensureLocalUserCredential(credentialPath)
    const second = await ensureLocalUserCredential(credentialPath)
    const stats = await fs.stat(credentialPath)

    expect(first).toBe(second)
    expect(Buffer.from(first, 'base64url')).toHaveLength(32)
    expect(stats.mode & 0o777).toBe(0o600)
    expect(credentialsMatch(first, second)).toBe(true)
    expect(credentialsMatch(first, 'invalid')).toBe(false)
  })

  it('converges concurrent first-start callers on the atomically installed credential', async () => {
    const credentialPath = path.join(temporaryRoot, 'concurrent.credential')
    const credentials = await Promise.all(
      Array.from({ length: 12 }, () => ensureLocalUserCredential(credentialPath)),
    )
    const installed = (await fs.readFile(credentialPath, 'utf8')).trim()

    expect(new Set(credentials)).toEqual(new Set([installed]))
    expect(Buffer.from(installed, 'base64url')).toHaveLength(32)
  })

  it('refuses an invalid existing credential instead of silently replacing trust material', async () => {
    const credentialPath = path.join(temporaryRoot, 'local-user.credential')
    await fs.writeFile(credentialPath, 'not-a-credential\n', { mode: 0o600 })

    await expect(ensureLocalUserCredential(credentialPath)).rejects.toThrow('invalid encoding')
    await expect(fs.readFile(credentialPath, 'utf8')).resolves.toBe('not-a-credential\n')
  })

  it('authenticates local-user and delegates explicitly named profiles without exposing secrets', async () => {
    const localUserCredential = Buffer.alloc(32, 7).toString('base64url')
    const namedProfile = vi.fn(async () => ({ callerId: 'profile:review-bot' }))
    const authenticate = createLocalSessionAuthenticator({
      localUserCredential,
      namedProfiles: { authenticate: namedProfile },
    })

    await expect(
      authenticate({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [2],
        clientKind: 'cli',
        clientVersion: 'test',
        credential: localUserCredential,
      }),
    ).resolves.toEqual({
      callerId: `local-user:${createHash('sha256')
        .update(localUserCredential)
        .digest('hex')
        .slice(0, 20)}`,
    })
    await expect(
      authenticate({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [2],
        clientKind: 'gui',
        clientVersion: 'test',
        credential: localUserCredential,
      }),
    ).resolves.toEqual({ callerId: 'gui:local-user' })
    await expect(
      authenticate({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [2],
        clientKind: 'mcp',
        clientVersion: 'test',
        profile: 'review-bot',
        credential: 'profile-secret',
      }),
    ).resolves.toEqual({ callerId: 'profile:review-bot' })
    expect(namedProfile).toHaveBeenCalledWith({
      profile: 'review-bot',
      credential: 'profile-secret',
      clientKind: 'mcp',
      clientVersion: 'test',
    })
  })

  it('accepts a machine-authenticated MCP authority while rejecting profile or client-kind confusion', async () => {
    const localUserCredential = Buffer.alloc(32, 9).toString('base64url')
    const authenticate = createLocalSessionAuthenticator({ localUserCredential })
    const transientAuthority = {
      profileId: 'mcp:review',
      profileName: 'review',
      capabilities: ['sessions:discover' as const],
      scope: { workspaceRoots: ['/allowed'], sessionIds: ['session-explicit'] },
      authorizationCeiling: 'ask-for-approval' as const,
    }

    await expect(
      authenticate({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [2],
        clientKind: 'mcp',
        clientVersion: 'test',
        credential: localUserCredential,
        transientAuthority,
      }),
    ).resolves.toMatchObject({
      callerId: expect.stringMatching(/^transient-mcp:/),
      profileAuthority: transientAuthority,
      baseProfileScope: transientAuthority.scope,
    })
    await expect(
      authenticate({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [2],
        clientKind: 'cli',
        clientVersion: 'test',
        credential: localUserCredential,
        transientAuthority,
      }),
    ).rejects.toThrow('restricted to MCP clients')
    await expect(
      authenticate({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [2],
        clientKind: 'mcp',
        clientVersion: 'test',
        profile: 'review',
        credential: localUserCredential,
        transientAuthority,
      }),
    ).rejects.toThrow('cannot be combined')
  })

  it('keeps the transient MCP principal stable across request-specific project filters', async () => {
    const localUserCredential = Buffer.alloc(32, 7).toString('base64url')
    const authenticate = createLocalSessionAuthenticator({ localUserCredential })
    const authority = {
      profileId: 'mcp:review',
      profileName: 'review',
      capabilities: ['sessions:discover' as const],
      scope: { workspaceRoots: ['/allowed'], sessionIds: ['session-explicit'] },
      authorizationCeiling: 'ask-for-approval' as const,
    }
    const authenticateProject = (projectPath: string) =>
      authenticate({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [2],
        clientKind: 'mcp',
        clientVersion: 'test',
        credential: localUserCredential,
        transientAuthority: {
          ...authority,
          scope: { ...authority.scope, projectPaths: [projectPath] },
        },
      })

    const [first, second] = await Promise.all([
      authenticateProject('/allowed/first'),
      authenticateProject('/allowed/second'),
    ])

    expect(first.callerId).toBe(second.callerId)
    expect(first.profileAuthority?.scope.projectPaths).toEqual(['/allowed/first'])
    expect(second.profileAuthority?.scope.projectPaths).toEqual(['/allowed/second'])
  })

  it('keeps transient MCP identity stable across set ordering and duplicates', async () => {
    const localUserCredential = Buffer.alloc(32, 8).toString('base64url')
    const authenticate = createLocalSessionAuthenticator({ localUserCredential })
    const authenticateAuthority = (reversed: boolean) =>
      authenticate({
        protocol: 'openwaggle-local-session',
        supportedRevisions: [2],
        clientKind: 'mcp',
        clientVersion: 'test',
        credential: localUserCredential,
        transientAuthority: {
          profileId: 'mcp:review',
          profileName: 'review',
          capabilities: reversed
            ? ['sessions:read', 'sessions:discover', 'sessions:read']
            : ['sessions:discover', 'sessions:read'],
          scope: {
            workspaceRoots: reversed
              ? ['/workspace/b', '/workspace/a']
              : ['/workspace/a', '/workspace/b'],
            sessionIds: reversed ? ['session-b', 'session-a'] : ['session-a', 'session-b'],
          },
          authorizationCeiling: 'ask-for-approval',
        },
      })

    const [first, second] = await Promise.all([
      authenticateAuthority(false),
      authenticateAuthority(true),
    ])

    expect(first.callerId).toBe(second.callerId)
  })
})

import { createHash } from 'node:crypto'
