/** Old OAuth sign-ins and the install that holds them, for the OAuth migration tests. */
import type { McpOAuthMigrationSink } from '../oauth-state-migration'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import {
  HOME,
  LEGACY_STATE,
  legacyState,
  memoryFs,
  NOW,
  OPENWAGGLE_GLOBAL,
  oldIdentityKey,
} from './migration-fixtures'

export const ISSUER = 'https://auth.example.com'
export const CLIENT = {
  client_id: 'client-1',
  redirect_uris: ['http://127.0.0.1:53111/oauth/callback'],
  issuer: ISSUER,
}
export const TOKENS = {
  access_token: 'access-1',
  token_type: 'Bearer',
  refresh_token: 'refresh-1',
  expires_in: 3600,
  issuer: ISSUER,
}

export function oldOAuthState(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    tokensByIssuer: { [ISSUER]: TOKENS },
    clientsByIssuer: { [ISSUER]: CLIENT },
    lastTokenIssuer: ISSUER,
    codeVerifier: 'verifier',
    ...overrides,
  })
}

export function oauthSink(secrets: Record<string, string>) {
  const written = new Map<string, unknown>()
  const sink: McpOAuthMigrationSink = {
    readOld: (name) => Promise.resolve(secrets[name]),
    write: (key, state) => {
      written.set(key, state)
    },
  }
  return { sink, written }
}

export const SENTRY = { url: 'https://mcp.sentry.dev/mcp', auth: { type: 'oauth' } }
export const SENTRY_KEY = 'mcp__sentry_prod|https://mcp.sentry.dev/mcp'

export function remoteInstall(
  servers: Record<string, unknown> = {},
  states: Record<string, unknown> = {},
  files: Record<string, unknown> = {},
) {
  return memoryFs({
    [OPENWAGGLE_GLOBAL]: { mcpServers: { 'sentry-prod': SENTRY, ...servers } },
    [LEGACY_STATE]: legacyState({
      servers: {
        [oldIdentityKey(OPENWAGGLE_GLOBAL, 'sentry-prod')]: {
          instanceId: 'sentry-id',
          enabled: true,
        },
        ...states,
      },
    }),
    ...files,
  })
}

export function migrate(
  fs: ReturnType<typeof memoryFs>,
  sink: McpOAuthMigrationSink,
  projectPaths: string[] = [],
) {
  return migrateOpenWaggleMcpFiles({ homeDir: HOME, projectPaths, now: () => NOW, fs, oauth: sink })
}
