import { fromPartial } from '@total-typescript/shoehorn'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface ConfiguredServer {
  readonly name: string
  readonly config: Record<string, unknown>
}

const mocks = vi.hoisted(() => {
  const servers: ConfiguredServer[] = []
  return {
    servers,
    // A keychain or a login shell that never answers.
    signIns: vi.fn(() => new Promise<void>(() => {})),
    shell: vi.fn(() => new Promise<void>(() => {})),
  }
})

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
  loadMcpRuntimeConfig: async () => ({
    loaded: { servers: mocks.servers, errors: [] },
    merged: { servers: [], errors: [] },
    transports: new Map(),
    unavailable: new Map(),
  }),
}))
vi.mock('../openwaggle-mcp-credentials', () => ({
  getOpenWaggleMcpCredentials: () => ({}),
  openWaggleMcpLogPath: () => '/tmp/mcp.log',
}))

const { createOpenWaggleMcpExtensions } = await import('../openwaggle-mcp-extensions')

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

  it("waits for old sign-ins and the login shell's environment when a server is on", async () => {
    mocks.servers = [{ name: 'docs', config: { command: 'docs-mcp' } }]

    await expect(settledSoon(createOpenWaggleMcpExtensions(input))).resolves.toBe('waiting')
    expect(mocks.signIns).toHaveBeenCalledWith('/p')
    expect(mocks.shell).toHaveBeenCalled()
  })
})
