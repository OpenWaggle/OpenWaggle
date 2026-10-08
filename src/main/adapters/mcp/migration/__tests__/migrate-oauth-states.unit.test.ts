import { describe, expect, it } from 'vitest'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import type { McpOAuthMigrationSink } from '../oauth-state-migration'
import {
  HOME,
  LEGACY_STATE,
  legacyState,
  memoryFs,
  NOW,
  OPENWAGGLE_GLOBAL,
  oldIdentityKey,
} from './migration-fixtures'

const ISSUER = 'https://auth.example.com'
const CLIENT = {
  client_id: 'client-1',
  redirect_uris: ['http://127.0.0.1:53111/oauth/callback'],
  issuer: ISSUER,
}
const TOKENS = {
  access_token: 'access-1',
  token_type: 'Bearer',
  refresh_token: 'refresh-1',
  expires_in: 3600,
  issuer: ISSUER,
}

function oldOAuthState(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    tokensByIssuer: { [ISSUER]: TOKENS },
    clientsByIssuer: { [ISSUER]: CLIENT },
    lastTokenIssuer: ISSUER,
    codeVerifier: 'verifier',
    ...overrides,
  })
}

function oauthSink(secrets: Record<string, string>) {
  const written = new Map<string, unknown>()
  const sink: McpOAuthMigrationSink = {
    readOld: (name) => Promise.resolve(secrets[name]),
    write: (key, state) => {
      written.set(key, state)
    },
  }
  return { sink, written }
}

function remoteInstall() {
  return memoryFs({
    [OPENWAGGLE_GLOBAL]: {
      mcpServers: {
        'sentry-prod': { url: 'https://mcp.sentry.dev/mcp', auth: { type: 'oauth' } },
      },
    },
    [LEGACY_STATE]: legacyState({
      servers: {
        [oldIdentityKey(OPENWAGGLE_GLOBAL, 'sentry-prod')]: {
          instanceId: 'sentry-id',
          enabled: true,
        },
      },
    }),
  })
}

describe('migrating old MCP OAuth sign-ins', () => {
  it("stores a single-issuer sign-in as Pi's state under Pi's key", async () => {
    const fs = remoteInstall()
    const { sink, written } = oauthSink({ 'oauth.sentry-id': oldOAuthState() })

    const report = await migrateOpenWaggleMcpFiles({
      homeDir: HOME,
      projectPaths: [],
      now: () => NOW,
      fs,
      oauth: sink,
    })

    const key = 'mcp__sentry_prod|https://mcp.sentry.dev/mcp'
    expect(written.get(key)).toEqual({
      serverUrl: 'https://mcp.sentry.dev/mcp',
      clientInformation: {
        client_id: 'client-1',
        redirect_uris: ['http://127.0.0.1:53111/oauth/callback'],
      },
      tokens: {
        access_token: 'access-1',
        token_type: 'Bearer',
        refresh_token: 'refresh-1',
        expires_in: 3600,
      },
    })
    expect(report.oauth).toEqual([{ server: 'sentry-prod', key, status: 'migrated' }])
  })

  it('migrates a sign-in once', async () => {
    const fs = remoteInstall()
    const first = oauthSink({ 'oauth.sentry-id': oldOAuthState() })
    await migrateOpenWaggleMcpFiles({
      homeDir: HOME,
      projectPaths: [],
      now: () => NOW,
      fs,
      oauth: first.sink,
    })
    const second = oauthSink({ 'oauth.sentry-id': oldOAuthState() })

    const report = await migrateOpenWaggleMcpFiles({
      homeDir: HOME,
      projectPaths: [],
      now: () => NOW,
      fs,
      oauth: second.sink,
    })

    expect(second.written.size).toBe(0)
    expect(report.oauth.map((result) => result.status)).toEqual(['already-migrated'])
  })

  it('skips a sign-in bound to several authorization servers', async () => {
    const fs = remoteInstall()
    const other = 'https://other-auth.example.com'
    const { sink, written } = oauthSink({
      'oauth.sentry-id': oldOAuthState({
        tokensByIssuer: { [ISSUER]: TOKENS, [other]: { ...TOKENS, issuer: other } },
        clientsByIssuer: { [ISSUER]: CLIENT, [other]: { ...CLIENT, issuer: other } },
      }),
    })

    const report = await migrateOpenWaggleMcpFiles({
      homeDir: HOME,
      projectPaths: [],
      now: () => NOW,
      fs,
      oauth: sink,
    })

    expect(written.size).toBe(0)
    expect(report.oauth).toEqual([
      expect.objectContaining({
        status: 'skipped',
        reason: 'the sign-in spans several authorization servers',
      }),
    ])
  })

  it('records a server that was never signed in, so later runs do not read the vault again', async () => {
    const fs = remoteInstall()
    const reads: string[] = []
    const sink: McpOAuthMigrationSink = {
      readOld: async (name) => {
        reads.push(name)
        return undefined
      },
      write: () => {},
    }
    const migrate = () =>
      migrateOpenWaggleMcpFiles({
        homeDir: HOME,
        projectPaths: [],
        now: () => NOW,
        fs,
        oauth: sink,
      })

    const first = await migrate()
    const second = await migrate()

    expect(first.oauth).toEqual([
      expect.objectContaining({ status: 'skipped', reason: 'not signed in' }),
    ])
    expect(second.oauth).toEqual([expect.objectContaining({ status: 'already-migrated' })])
    expect(reads).toEqual(['oauth.sentry-id'])
  })
})
