import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { legacyServerIdentityKey } from '../legacy-pi-import'
import { migrateOpenWaggleMcpFiles } from '../migrate-openwaggle-mcp-files'
import { NOW } from './migration-fixtures'

const roots: string[] = []
const ISSUER = 'https://auth.example.com'
const OLD_SIGN_IN = JSON.stringify({
  version: 1,
  tokensByIssuer: { [ISSUER]: { access_token: 'a', token_type: 'Bearer', issuer: ISSUER } },
  clientsByIssuer: {
    [ISSUER]: { client_id: 'c', redirect_uris: ['http://127.0.0.1:1/cb'], issuer: ISSUER },
  },
  lastTokenIssuer: ISSUER,
})

async function writeJson(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('the old sign-ins migration', () => {
  it("moves the sign-ins it can read while another project's folder links nowhere", async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'openwaggle-mcp-oauth-dangling-'))
    roots.push(root)
    const homeDir = path.join(root, 'home')
    const globalFile = path.join(homeDir, '.openwaggle', 'mcp.json')
    const other = path.join(root, 'other')
    await mkdir(other, { recursive: true })
    // That project's .openwaggle is in a dotfiles checkout that is not mounted.
    await symlink(path.join(root, 'unmounted', 'openwaggle'), path.join(other, '.openwaggle'))
    await writeJson(globalFile, {
      mcpServers: { sentry: { url: 'https://mcp.sentry.dev/mcp', auth: { type: 'oauth' } } },
    })
    await writeJson(path.join(homeDir, '.openwaggle', 'mcp', 'state.json'), {
      version: 1,
      globalState: 'on',
      projectStates: {},
      sessionStates: {},
      projectServerStates: {},
      servers: {
        [legacyServerIdentityKey(globalFile, 'sentry')]: { enabled: true, instanceId: 'sentry-id' },
      },
    })
    const written: string[] = []

    const report = await migrateOpenWaggleMcpFiles({
      homeDir,
      projectPaths: [other],
      now: () => NOW,
      oauth: {
        buildKey: 'build',
        readOld: async (name) => (name === 'oauth.sentry-id' ? OLD_SIGN_IN : undefined),
        write: (key) => {
          written.push(key)
        },
      },
    })

    expect(report.oauth).toEqual([
      expect.objectContaining({ server: 'sentry', status: 'migrated' }),
    ])
    expect(written).toHaveLength(1)
    // The unreadable project file fails, so it and its sign-ins are tried again later.
    expect(report.files.find((file) => file.path.startsWith(other))?.status).toBe('failed')
  })
})
