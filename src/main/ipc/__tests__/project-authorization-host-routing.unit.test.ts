import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AgentAuthorizationScopeKey } from '@shared/types/agent-authorization-grants'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invokeHost: vi.fn(),
  handle: vi.fn<(channel: string, listener: (...args: unknown[]) => unknown) => void>(),
}))

vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }))
vi.mock('../../application/local-session-command-dispatcher', () => ({
  invokeConfiguredHostUiRaw: mocks.invokeHost,
}))
vi.mock('../../runtime', () => ({
  runAppEffect: (effect: Effect.Effect<unknown, unknown, never>) => Effect.runPromise(effect),
  runAppEffectExit: (effect: Effect.Effect<unknown, unknown, never>) =>
    Effect.runPromiseExit(effect),
}))

import { loadProjectConfig } from '../../config/project-config'
import { registerProjectHandlers } from '../project-handler'

const key: AgentAuthorizationScopeKey = {
  requester: 'mcp',
  requesterId: 'server-a',
  capability: 'mcp.tool-call',
  resource: 'write',
}

function invoke(channel: string, ...args: unknown[]) {
  const handler = mocks.handle.mock.calls.find(([registered]) => registered === channel)?.[1]
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
  return handler({ sender: {} }, ...args)
}

describe('project authorization mutations in an attached GUI', () => {
  let projectPath = ''

  beforeEach(async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-grant-routing-'))
    mocks.handle.mockReset()
    mocks.invokeHost.mockReset().mockResolvedValue({ handled: true, result: undefined })
    registerProjectHandlers()
  })

  afterEach(async () => {
    await fs.rm(projectPath, { recursive: true, force: true })
  })

  it.each(['authorization-grants:grant', 'authorization-grants:revoke'])(
    'routes %s to the existing Host without writing project settings in the GUI',
    async (channel) => {
      await invoke(channel, projectPath, key)

      expect(mocks.invokeHost).toHaveBeenCalledWith(channel, [projectPath, key])
      expect(await fs.readdir(projectPath)).toEqual([])
    },
  )

  it.each(['authorization-grants:grant', 'authorization-grants:revoke'])(
    'does not fall back to a GUI write when the owner rejects %s',
    async (channel) => {
      mocks.invokeHost.mockRejectedValue(new Error('Session Host does not support this operation.'))

      await expect(invoke(channel, projectPath, key)).rejects.toThrow('does not support')
      expect(await fs.readdir(projectPath)).toEqual([])
    },
  )

  it('retains the same validated local operations when the GUI owns its runtime', async () => {
    mocks.invokeHost.mockResolvedValue({ handled: false })
    await invoke('authorization-grants:grant', projectPath, key)
    expect((await loadProjectConfig(projectPath)).authorizationGrants).toEqual([
      { ...key, grantedAt: expect.any(Number) },
    ])
    await invoke('authorization-grants:revoke', projectPath, key)
    expect((await loadProjectConfig(projectPath)).authorizationGrants ?? []).toEqual([])
  })
})
