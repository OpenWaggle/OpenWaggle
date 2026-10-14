import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionFactory,
  ExtensionUIContext,
} from '@earendil-works/pi-coding-agent'
import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface ConfiguredServer {
  readonly name: string
  readonly config: Record<string, unknown>
}

const mocks = vi.hoisted(() => {
  const servers: ConfiguredServer[] = []
  const loads: unknown[] = []
  return {
    servers,
    loads,
    // A keychain or a login shell that never answers.
    signIns: vi.fn(() => new Promise<void>(() => {})),
    shell: vi.fn(() => new Promise<void>(() => {})),
  }
})

// Pi's MCP extension, reduced to its prompt-start wait for a server that is still connecting.
vi.mock('@earendil-works/pi-coding-agent', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@earendil-works/pi-coding-agent')>()),
  createMcpExtension: (): ExtensionFactory => (pi) => {
    pi.on('before_agent_start', (_event, ctx) => {
      ctx.ui.notify('MCP servers are still connecting.', 'info')
    })
  },
}))
vi.mock('../openwaggle-mcp-migration', () => ({
  migrateOpenWaggleMcpFilesOnce: async () => undefined,
  migrateOpenWaggleMcpSignInsOnce: mocks.signIns,
}))
vi.mock('../../../../mcp-shell-environment', () => ({
  mcpShellEnvironmentReady: mocks.shell,
  mcpValueEnvironment: () => ({}),
}))
vi.mock('../../pi-provider-catalog', () => ({ getPiAgentDir: () => '/home/user/.pi/agent' }))
vi.mock('../../../mcp/config/mcp-runtime-config', () => ({
  loadMcpRuntimeConfig: async (input: unknown) => {
    mocks.loads.push(input)
    return {
      loaded: { servers: mocks.servers, errors: [] },
      merged: { servers: [], errors: [] },
      transports: new Map(),
      unavailable: new Map(),
    }
  },
}))
vi.mock('../openwaggle-mcp-credentials', () => ({
  getOpenWaggleMcpCredentials: () => ({}),
  openWaggleMcpLogPath: () => '/tmp/mcp.log',
}))

const { createOpenWaggleMcpExtensions } = await import('../openwaggle-mcp-extensions')
const { deferredMcpVaultSecret } = await import('../../../mcp/encrypted-mcp-secret-vault-service')

const input = fromPartial<Parameters<typeof createOpenWaggleMcpExtensions>[0]>({
  sessionId: 's1',
  projectPath: '/p',
})
const SETTLED = 'settled'

function settledSoon(promise: Promise<unknown>) {
  return Promise.race([
    promise.then(() => SETTLED),
    new Promise((resolve) => setTimeout(() => resolve('waiting'), 20)),
  ])
}

beforeEach(() => {
  mocks.signIns.mockClear()
  mocks.shell.mockClear()
})

describe("a Run's MCP start", () => {
  it('waits for nothing when no server is turned on', async () => {
    mocks.servers = [{ name: 'off', config: { command: 'x', enabled: false } }]

    await expect(settledSoon(createOpenWaggleMcpExtensions(input))).resolves.toBe(SETTLED)
    expect(mocks.signIns).not.toHaveBeenCalled()
    expect(mocks.shell).not.toHaveBeenCalled()
  })

  it("waits for the login shell's environment, not old sign-ins, when a command server is on", async () => {
    mocks.servers = [{ name: 'docs', config: { command: 'docs-mcp' } }]

    await expect(settledSoon(createOpenWaggleMcpExtensions(input))).resolves.toBe('waiting')
    // Only a URL server signs in, so only one waits for the old sign-ins' keychain read.
    expect(mocks.signIns).not.toHaveBeenCalled()
    expect(mocks.shell).toHaveBeenCalled()
  })

  it('waits for old sign-ins when a URL server is on', async () => {
    mocks.servers = [
      { name: 'docs', config: { command: 'docs-mcp' } },
      { name: 'remote', config: { url: 'https://mcp.example.com' } },
    ]

    await expect(settledSoon(createOpenWaggleMcpExtensions(input))).resolves.toBe('waiting')
    expect(mocks.signIns).toHaveBeenCalledWith('/p')
    expect(mocks.shell).toHaveBeenCalled()
  })

  it('loads the configuration without reading the keychain: secrets are read on connect', async () => {
    mocks.servers = [{ name: 'off', config: { command: 'x', enabled: false } }]

    await createOpenWaggleMcpExtensions(input)

    expect(mocks.loads.at(-1)).toMatchObject({ resolveSecret: deferredMcpVaultSecret })
  })
})

describe("a Run's MCP extension", () => {
  it('does not notify that MCP servers are still connecting', async () => {
    mocks.servers = [{ name: 'off', config: { command: 'x', enabled: false } }]
    const extensions = await createOpenWaggleMcpExtensions(input)
    const mcp = extensions.find((extension) => typeof extension !== 'function')
    const handlers: Array<(event: unknown, ctx: ExtensionContext) => unknown> = []
    const notify = vi.fn<ExtensionUIContext['notify']>()

    if (typeof mcp === 'function' || !mcp) throw new Error('No MCP extension')
    await mcp.factory(
      fromPartial<ExtensionAPI>({
        on: (_event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
          handlers.push(handler)
          return () => undefined
        },
      }),
    )
    const ctx = fromPartial<ExtensionContext>({ ui: fromPartial<ExtensionUIContext>({ notify }) })
    for (const handler of handlers) await handler({}, ctx)

    expect(handlers).toHaveLength(1)
    expect(notify).not.toHaveBeenCalled()
  })
})
