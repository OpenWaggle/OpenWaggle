import { fromPartial } from '@total-typescript/shoehorn'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  let finishSignIns = () => {}
  const signIns = new Promise<void>((resolve) => {
    finishSignIns = resolve
  })
  return {
    signIns,
    finishSignIns: () => finishSignIns(),
    statuses: vi.fn(async () => [{ name: 'docs', source: 'not-checked', signedIn: true }]),
  }
})

vi.mock('../openwaggle-mcp-migration', () => ({
  migrateOpenWaggleMcpFilesOnce: async () => undefined,
  migrateOpenWaggleMcpSignInsOnce: () => mocks.signIns,
}))
vi.mock('../pi-mcp-server-status', () => ({ getMcpServerStatuses: mocks.statuses }))
vi.mock('../../pi-provider-catalog', () => ({ getPiAgentDir: () => '/home/user/.pi/agent' }))

const { createPiMcpServerRuntimeService } = await import('../pi-mcp-server-runtime-service')

describe("Settings' MCP server states", () => {
  it('read the sign-in store only once the old sign-ins were migrated', async () => {
    const runtime = createPiMcpServerRuntimeService(fromPartial({}))
    let read = false
    const statuses = Effect.runPromise(runtime.getServerStatuses({ projectPath: null })).then(
      (result) => {
        read = true
        return result
      },
    )

    await new Promise((resolve) => setTimeout(resolve, 0))
    // A migrated sign-in must not show as signed out on the first launch.
    expect(read).toBe(false)
    expect(mocks.statuses).not.toHaveBeenCalled()
    mocks.finishSignIns()

    await expect(statuses).resolves.toEqual([
      { name: 'docs', source: 'not-checked', signedIn: true },
    ])
  })
})
