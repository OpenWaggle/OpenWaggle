import { fromPartial } from '@total-typescript/shoehorn'
import { afterEach, describe, expect, it, vi } from 'vitest'

interface Server {
  readonly removed?: boolean
  /** The file cannot be read right now, such as mid-save in an editor. */
  readonly unreadable?: boolean
  /** Another entry of the file is invalid (a `comand` typo), which stays so. */
  readonly invalidSibling?: boolean
  /** This server's own entry is invalid now. */
  readonly rejected?: boolean
  readonly enabled: boolean
  /** Stands for the server's vault secret, as its stamp (name and when it was saved). */
  readonly secretStamp: string
}

const mocks = vi.hoisted(() => ({
  servers: new Map<string | null, Server>(),
}))

const DOCS = { command: 'docs-mcp' }

function server(projectPath: string | null) {
  return mocks.servers.get(projectPath) ?? { enabled: true, secretStamp: 'TOKEN@1' }
}

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false }, shell: {} }))
vi.mock('../../../mcp/config/mcp-runtime-config', () => ({
  loadMcpRuntimeConfig: async (input: { roots: { projectPath: string | null } }) => {
    const { enabled, secretStamp, unreadable, invalidSibling, rejected } = server(
      input.roots.projectPath,
    )
    const config = { ...DOCS, enabled }
    if (unreadable || rejected) {
      const errors = [
        unreadable ? 'mcp.json: Unexpected end of JSON input' : 'mcp.json: server "docs": comand',
      ]
      return {
        loaded: { servers: [], errors },
        merged: unreadable
          ? { servers: [], errors, incomplete: true }
          : { servers: [], errors, rejectedNames: ['docs'] },
        transports: new Map(),
        unavailable: new Map(),
        missingSecrets: new Map(),
        connectionConfigs: new Map(),
      }
    }
    return {
      loaded: { servers: [{ name: 'docs', config }], errors: [] },
      merged: invalidSibling
        ? {
            servers: [{ name: 'docs', config }],
            errors: ['mcp.json: server "typo": unknown key comand'],
            rejectedNames: ['typo'],
          }
        : { servers: [{ name: 'docs', config }], errors: [] },
      transports: new Map([['docs', 'stdio']]),
      unavailable: new Map(),
      missingSecrets: new Map(),
      connectionConfigs: new Map([['docs', { ...config, env: { TOKEN: secretStamp } }]]),
    }
  },
  loadMcpMergedConfig: (roots: { projectPath: string | null }) => {
    const { removed, enabled, unreadable, invalidSibling, rejected } = server(roots.projectPath)
    const docs = [{ name: 'docs', config: { ...DOCS, enabled } }]
    if (unreadable) {
      return { servers: [], errors: ['mcp.json: Unexpected end of JSON input'], incomplete: true }
    }
    if (rejected) {
      return { servers: [], errors: ['mcp.json: server "docs": comand'], rejectedNames: ['docs'] }
    }
    if (invalidSibling) {
      return { servers: docs, errors: ['mcp.json: server "typo": comand'], rejectedNames: ['typo'] }
    }
    return { servers: removed ? [] : docs, errors: [] }
  },
}))
vi.mock('../../pi-provider-catalog', () => ({ getPiAgentDir: () => '/home/user/.pi/agent' }))

const { getMcpServerStatuses } = await import('../pi-mcp-server-status')
const { forgetKnownMcpServerStates, recordMcpServerCheck } = await import(
  '../mcp-server-status-registry'
)
const { forgetStatesOfSwitchedMcpServers } = await import('../mcp-server-status-freshness')
const { mcpServerIdentity } = await import('../../../mcp/pool/mcp-connection-pool-api')

const roots = { homeDir: '/home/user', piAgentDir: '/home/user/.pi/agent' }
const pool = fromPartial<Parameters<typeof getMcpServerStatuses>[2]>({ connectionStates: () => [] })

async function docsStatus(projectPath: string | null) {
  const statuses = await getMcpServerStatuses({ projectPath }, roots, pool)
  return statuses.find((status) => status.name === 'docs')
}

function checkedConnected() {
  recordMcpServerCheck(mcpServerIdentity('docs', DOCS), {
    name: 'docs',
    state: 'connected',
    tools: [],
  })
}

afterEach(() => {
  mocks.servers.clear()
  forgetKnownMcpServerStates()
})

describe("Settings' MCP server states after a change", () => {
  it('forget the last check of a server that was turned off and on again', async () => {
    checkedConnected()
    expect(await docsStatus('/p1')).toMatchObject({ source: 'last-check' })

    mocks.servers.set('/p1', { enabled: false, secretStamp: 'TOKEN@1' })
    expect(await docsStatus('/p1')).toMatchObject({ source: 'not-checked' })
    mocks.servers.delete('/p1')

    // Not "Connected, last checked 5 minutes ago": that check was before it was turned off.
    expect(await docsStatus('/p1')).toEqual({ name: 'docs', source: 'not-checked' })
  })

  it('forget it when the server was switched while Settings did not look', async () => {
    checkedConnected()
    expect(await docsStatus('/p2')).toMatchObject({ source: 'last-check' })

    // Turned off and on again from the CLI or Pi's /mcp: each saved change is seen.
    mocks.servers.set('/p2', { enabled: false, secretStamp: 'TOKEN@1' })
    forgetStatesOfSwitchedMcpServers()
    mocks.servers.delete('/p2')
    forgetStatesOfSwitchedMcpServers()

    expect(await docsStatus('/p2')).toEqual({ name: 'docs', source: 'not-checked' })
  })

  it('forget it when a secret the server reads was saved again', async () => {
    checkedConnected()
    expect(await docsStatus('/p3')).toMatchObject({ source: 'last-check' })

    mocks.servers.set('/p3', { enabled: true, secretStamp: 'TOKEN@2' })

    expect(await docsStatus('/p3')).toEqual({ name: 'docs', source: 'not-checked' })
  })

  it('keep it while nothing about the server changed', async () => {
    checkedConnected()
    await docsStatus('/p4')
    forgetStatesOfSwitchedMcpServers()

    expect(await docsStatus('/p4')).toMatchObject({
      source: 'last-check',
      inspection: { state: 'connected' },
    })
  })

  it('keep a check made after the change, such as Check connection right after an edit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await docsStatus('/p5')
    mocks.servers.set('/p5', { enabled: true, secretStamp: 'TOKEN@2' })
    vi.advanceTimersByTime(1)
    checkedConnected()

    expect(await docsStatus('/p5')).toMatchObject({ source: 'last-check' })
    vi.useRealTimers()
  })

  it('forget it when the server is removed, so one added again under that name starts fresh', async () => {
    checkedConnected()
    await docsStatus('/p6')

    mocks.servers.set('/p6', { removed: true, enabled: true, secretStamp: 'TOKEN@1' })
    forgetStatesOfSwitchedMcpServers()
    mocks.servers.delete('/p6')

    expect(await docsStatus('/p6')).toEqual({ name: 'docs', source: 'not-checked' })
  })

  it('keep it while a file cannot be read, which says nothing about its servers', async () => {
    checkedConnected()
    await docsStatus('/p7')

    mocks.servers.set('/p7', { unreadable: true, enabled: true, secretStamp: 'TOKEN@1' })
    await getMcpServerStatuses({ projectPath: '/p7' }, roots, pool)
    mocks.servers.delete('/p7')

    expect(await docsStatus('/p7')).toMatchObject({ source: 'last-check' })
  })

  it('forget it when it changed, though another entry of the file stays invalid', async () => {
    mocks.servers.set('/p8', { invalidSibling: true, enabled: true, secretStamp: 'TOKEN@1' })
    checkedConnected()
    await docsStatus('/p8')

    mocks.servers.set('/p8', { invalidSibling: true, enabled: true, secretStamp: 'TOKEN@2' })

    expect(await docsStatus('/p8')).toEqual({ name: 'docs', source: 'not-checked' })
  })

  it('keep it while its own entry is invalid: the server is not removed', async () => {
    checkedConnected()
    await docsStatus('/p9')

    mocks.servers.set('/p9', { rejected: true, enabled: true, secretStamp: 'TOKEN@1' })
    await getMcpServerStatuses({ projectPath: '/p9' }, roots, pool)
    mocks.servers.delete('/p9')

    expect(await docsStatus('/p9')).toMatchObject({ source: 'last-check' })
  })

  describe('after a saved change, seen only through the change listener', () => {
    it('keep it while a file cannot be read', async () => {
      checkedConnected()
      await docsStatus('/l7')

      mocks.servers.set('/l7', { unreadable: true, enabled: false, secretStamp: 'TOKEN@1' })
      forgetStatesOfSwitchedMcpServers()
      mocks.servers.delete('/l7')

      expect(await docsStatus('/l7')).toMatchObject({ source: 'last-check' })
    })

    it('forget it when it was switched, though another entry stays invalid', async () => {
      const sibling = { invalidSibling: true, secretStamp: 'TOKEN@1' }
      mocks.servers.set('/l8', { ...sibling, enabled: true })
      checkedConnected()
      await docsStatus('/l8')

      mocks.servers.set('/l8', { ...sibling, enabled: false })
      forgetStatesOfSwitchedMcpServers()
      mocks.servers.set('/l8', { ...sibling, enabled: true })
      forgetStatesOfSwitchedMcpServers()

      expect(await docsStatus('/l8')).toEqual({ name: 'docs', source: 'not-checked' })
    })

    it('keep it while its own entry is invalid', async () => {
      checkedConnected()
      await docsStatus('/l9')

      mocks.servers.set('/l9', { rejected: true, enabled: true, secretStamp: 'TOKEN@1' })
      forgetStatesOfSwitchedMcpServers()
      mocks.servers.delete('/l9')

      expect(await docsStatus('/l9')).toMatchObject({ source: 'last-check' })
    })
  })
})
