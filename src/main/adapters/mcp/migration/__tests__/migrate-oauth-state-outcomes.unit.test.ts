import type { JsonObject } from '@shared/types/json'
import { describe, expect, it } from 'vitest'
import { type McpOAuthMigrationSink, SIGN_IN_NOT_READ_YET } from '../oauth-state-migration'
import { oldIdentityKey, OPENWAGGLE_GLOBAL } from './migration-fixtures'
import {
  migrate,
  oauthSink,
  oldOAuthState,
  remoteInstall,
  SENTRY,
  SENTRY_KEY,
} from './oauth-migration.test-support'

describe('which old MCP OAuth sign-ins migrate, and when', () => {
  it.each<[string, JsonObject, string]>([
    [
      'tokens without their client registration',
      { clientsByIssuer: {} },
      'the client registration for the tokens is missing',
    ],
    ['a client registration without tokens', { tokensByIssuer: {} }, 'no tokens are stored'],
  ])('skips and records %s', async (_name, overrides, reason) => {
    const fs = remoteInstall()
    const { sink, written } = oauthSink({ 'oauth.sentry-id': oldOAuthState(overrides) })

    const first = await migrate(fs, sink)
    const second = await migrate(fs, sink)

    expect(written.size).toBe(0)
    expect(first.oauth).toEqual([
      { server: 'sentry-prod', key: SENTRY_KEY, status: 'skipped', reason },
    ])
    expect(second.oauth.map((result) => result.status)).toEqual(['already-migrated'])
  })

  it('takes the only authorization server when the state names no last issuer', async () => {
    const fs = remoteInstall()
    const { sink, written } = oauthSink({
      'oauth.sentry-id': oldOAuthState({ lastTokenIssuer: undefined }),
    })

    const report = await migrate(fs, sink)

    expect(report.oauth.map((result) => result.status)).toEqual(['migrated'])
    expect(written.get(SENTRY_KEY)).toMatchObject({ tokens: { access_token: 'access-1' } })
  })

  it('looks only at remote servers with old state and a URL it can parse, each once', async () => {
    const project = '/work/project'
    const projectFile = `${project}/.openwaggle/mcp.json`
    const fs = remoteInstall(
      {
        local: { command: 'npx', args: ['server'] },
        unrecorded: { url: 'https://unrecorded.example.com/mcp' },
        broken: { url: 'not a url' },
      },
      {
        [oldIdentityKey(OPENWAGGLE_GLOBAL, 'local')]: { instanceId: 'local-id', enabled: true },
        [oldIdentityKey(OPENWAGGLE_GLOBAL, 'broken')]: { instanceId: 'broken-id', enabled: true },
        [oldIdentityKey(projectFile, 'sentry-prod')]: { instanceId: 'sentry-id', enabled: true },
      },
      // The project defines the same server again; one sign-in key covers both.
      { [projectFile]: { mcpServers: { 'sentry-prod': SENTRY } } },
    )
    const reads: string[] = []
    const sink: McpOAuthMigrationSink = {
      readOld: async (name) => {
        reads.push(name)
        return oldOAuthState()
      },
      write: () => true,
    }

    const report = await migrate(fs, sink, [project])

    expect(reads).toEqual(['oauth.sentry-id'])
    expect(report.oauth).toEqual([{ server: 'sentry-prod', key: SENTRY_KEY, status: 'migrated' }])
  })

  it('comes back to a sign-in the vault has not read yet', async () => {
    const fs = remoteInstall()
    let answer: string | typeof SIGN_IN_NOT_READ_YET = SIGN_IN_NOT_READ_YET
    const sink: McpOAuthMigrationSink = { readOld: async () => answer, write: () => true }

    const first = await migrate(fs, sink)
    answer = oldOAuthState()
    const second = await migrate(fs, sink)

    expect(first.oauth).toEqual([
      { server: 'sentry-prod', key: SENTRY_KEY, status: 'skipped', reason: 'not read yet' },
    ])
    expect(second.oauth.map((result) => result.status)).toEqual(['migrated'])
  })

  it('moves the same sign-in once for each build', async () => {
    const fs = remoteInstall()
    const build = (buildKey?: string) => ({
      ...(buildKey === undefined ? {} : { buildKey }),
      readOld: async () => oldOAuthState(),
      write: () => true,
    })

    const statuses = []
    for (const sink of [build('dev'), build('release'), build('release'), build()]) {
      statuses.push((await migrate(fs, sink)).oauth.map((result) => result.status))
    }

    expect(statuses).toEqual([['migrated'], ['migrated'], ['already-migrated'], ['migrated']])
  })

  it('reports a failed write with its error, and tries again later', async () => {
    const fs = remoteInstall()
    let fails = true
    const sink: McpOAuthMigrationSink = {
      readOld: async () => oldOAuthState(),
      write: () => {
        if (fails) throw new Error('disk full')
        return true
      },
    }

    const first = await migrate(fs, sink)
    fails = false
    const second = await migrate(fs, sink)

    expect(first.oauth).toEqual([
      { server: 'sentry-prod', key: SENTRY_KEY, status: 'failed', reason: 'disk full' },
    ])
    expect(second.oauth.map((result) => result.status)).toEqual(['migrated'])
  })
})
