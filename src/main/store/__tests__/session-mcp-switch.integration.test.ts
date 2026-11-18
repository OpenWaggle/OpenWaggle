import lifecycleFs from 'node:fs/promises'
import lifecycleOs from 'node:os'
import lifecyclePath from 'node:path'
import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { McpSessionConnectionPool } from '../../adapters/mcp/pool/mcp-session-connection-pool'
import { runSessionRemovalHooks } from '../../application/session-removal-hooks'
import { installMcpSessionRemoval } from '../../mcp-session-removal'
import { createSession } from '../session-details'
import { deleteSession } from '../session-details/session-mutations'
import {
  disableSessionMcp,
  isSessionMcpEnabled,
  setSessionMcpEnabled,
  UnknownMcpSessionError,
} from '../session-mcp-switch'

const { state, getPathMock } = vi.hoisted(() => ({
  state: { userDataDir: '' },
  getPathMock: vi.fn(() => ''),
}))

getPathMock.mockImplementation(() => state.userDataDir)

vi.mock('electron', () => ({
  app: { getPath: getPathMock },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  },
}))

async function restartHost() {
  const { resetAppRuntimeForTests } = await import('../../runtime')
  await resetAppRuntimeForTests()
}

beforeEach(async () => {
  state.userDataDir = await lifecycleFs.mkdtemp(
    lifecyclePath.join(lifecycleOs.tmpdir(), 'ow-session-mcp-switch-'),
  )
  await restartHost()
})

afterEach(async () => {
  const tmpDir = state.userDataDir
  await restartHost()
  await lifecycleFs.rm(tmpDir, { recursive: true, force: true })
})

async function makeSession(piSessionId: string) {
  const session = await createSession({ projectPath: '/repo/openwaggle', piSessionId })
  return SessionId(String(session.id))
}

/** Session-level MCP off is durable Session state in the Host database (ADR 0051). */
describe('the per-Session MCP switch', () => {
  it('is on for a Session nobody switched', async () => {
    const id = await makeSession('pi-1')

    expect(await isSessionMcpEnabled(id)).toBe(true)
  })

  it('stays off after the Host restarts, and only for that Session', async () => {
    const off = await makeSession('pi-1')
    const on = await makeSession('pi-2')
    await setSessionMcpEnabled(off, false)

    await restartHost()

    expect(await isSessionMcpEnabled(off)).toBe(false)
    expect(await isSessionMcpEnabled(on)).toBe(true)
  })

  it('turns back on, also after a restart', async () => {
    const id = await makeSession('pi-1')
    await setSessionMcpEnabled(id, false)
    await setSessionMcpEnabled(id, false)

    await setSessionMcpEnabled(id, true)
    await restartHost()

    expect(await isSessionMcpEnabled(id)).toBe(true)
  })

  it('stays off when the Session is archived, and goes with it when it is deleted', async () => {
    const archived = await makeSession('pi-1')
    const deleted = await makeSession('pi-2')
    await setSessionMcpEnabled(archived, false)
    await setSessionMcpEnabled(deleted, false)
    installMcpSessionRemoval(new McpSessionConnectionPool())

    // Archiving runs the Session removal hooks (closing its MCP connections); unarchiving later
    // must find MCP still off.
    await Effect.runPromise(runSessionRemovalHooks(archived))
    await deleteSession(deleted)

    expect(await isSessionMcpEnabled(archived)).toBe(false)
    expect(await isSessionMcpEnabled(deleted)).toBe(true)
  })

  it('is copied to a fork or clone of a Session switched off, and only then', async () => {
    const off = await makeSession('pi-1')
    const on = await makeSession('pi-2')
    await setSessionMcpEnabled(off, false)

    const forkOfOff = await createSession({
      projectPath: '/repo/openwaggle',
      piSessionId: 'pi-fork-1',
      copyMcpSwitchFrom: off,
    })
    const forkOfOn = await createSession({
      projectPath: '/repo/openwaggle',
      piSessionId: 'pi-fork-2',
      copyMcpSwitchFrom: on,
    })

    expect(await isSessionMcpEnabled(forkOfOff.id)).toBe(false)
    expect(await isSessionMcpEnabled(forkOfOn.id)).toBe(true)
  })

  it('refuses a switch for a Session the Host does not have', async () => {
    await expect(disableSessionMcp('gone')).rejects.toBeInstanceOf(UnknownMcpSessionError)

    expect(await isSessionMcpEnabled('gone')).toBe(true)
  })
})
