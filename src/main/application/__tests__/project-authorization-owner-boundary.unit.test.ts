import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AgentAuthorizationScopeKey } from '@shared/types/agent-authorization-grants'
import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import { fromAny } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadProjectConfig } from '../../config/project-config'
import { dispatchHostUiRequest } from '../host-ui-request-dispatcher'

const channels = ['authorization-grants:grant', 'authorization-grants:revoke'] as const
const key: AgentAuthorizationScopeKey = {
  requester: 'MCP server',
  requesterId: 'server-a',
  capability: 'mcp.tool-call',
  resource: 'write',
}

function invoke(
  channel: (typeof channels)[number],
  args: readonly unknown[],
  caller: LocalSessionCallerIdentity = { callerId: 'gui:local-user' },
) {
  const operation = dispatchHostUiRequest({
    caller,
    request: {
      contractVersion: 1,
      requestId: 'grant-boundary',
      channel,
      args: args.map((value) =>
        value === undefined ? { kind: 'undefined' as const } : { kind: 'value' as const, value },
      ),
    },
  })
  // Unrelated Host ports are intentionally absent: these filesystem-only operations need none.
  return Effect.runPromise(
    fromAny<Effect.Effect<unknown, unknown, never>, typeof operation>(operation),
  )
}

describe('Host-owned project authorization boundary', () => {
  let projectPath = ''

  beforeEach(async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-grant-boundary-'))
  })

  afterEach(async () => {
    await fs.rm(projectPath, { recursive: true, force: true })
  })

  it('normalizes scope identity and revokes only the exact resource in the selected project', async () => {
    const secondProject = path.join(projectPath, 'second-project')
    await fs.mkdir(secondProject)
    const rawKey = {
      ...key,
      requester: ' MCP server ',
      requesterId: ' server-a ',
      resource: ' write ',
    }
    const result = await invoke('authorization-grants:grant', [` ${projectPath} `, rawKey])
    expect(result).toMatchObject({
      response: { requestId: 'grant-boundary', result: { kind: 'undefined' } },
    })
    await invoke('authorization-grants:grant', [projectPath, { ...key, resource: 'read' }])
    await invoke('authorization-grants:grant', [secondProject, key])
    await invoke('authorization-grants:revoke', [projectPath, rawKey])

    expect((await loadProjectConfig(projectPath)).authorizationGrants).toEqual([
      { ...key, resource: 'read', grantedAt: expect.any(Number) },
    ])
    expect((await loadProjectConfig(secondProject)).authorizationGrants).toEqual([
      { ...key, grantedAt: expect.any(Number) },
    ])
  })

  it('preserves the existing blank-resource normalization', async () => {
    const { resource: _resource, ...resourceLessKey } = key
    await invoke('authorization-grants:grant', [projectPath, { ...key, resource: '  ' }])
    expect((await loadProjectConfig(projectPath)).authorizationGrants).toEqual([
      { ...resourceLessKey, grantedAt: expect.any(Number) },
    ])
    await invoke('authorization-grants:revoke', [projectPath, { ...key, resource: '' }])
    expect((await loadProjectConfig(projectPath)).authorizationGrants ?? []).toEqual([])
  })

  describe.each(channels)('%s', (channel) => {
    it.each([
      { callerId: 'cli:external' },
      { callerId: 'local-user:machine' },
      {
        callerId: 'profile:external',
        profileAuthority: {
          profileId: 'external',
          profileName: 'external',
          capabilities: [],
          scope: { all: true },
          authorizationCeiling: 'yolo',
        },
      },
    ] satisfies LocalSessionCallerIdentity[])(
      'rejects non-GUI caller $callerId before any write',
      async (caller) => {
        await expect(invoke(channel, [projectPath, key], caller)).rejects.toThrow(
          'only available to the local OpenWaggle GUI',
        )
        expect(await fs.readdir(projectPath)).toEqual([])
      },
    )

    it.each([
      [{ ...key, requester: '  ' }, 'requires a requester.'],
      [{ ...key, requesterId: ' ' }, 'requires a requester id.'],
      [{ ...key, capability: 'unrecognized' }, 'Invalid authorization scope key'],
      [{ ...key, resource: 123 }, 'Invalid authorization scope key'],
      [null, 'Invalid authorization scope key'],
    ] as const)(
      'rejects invalid scope %j without writing settings',
      async (invalidKey, message) => {
        await expect(invoke(channel, [projectPath, invalidKey])).rejects.toThrow(message)
        expect(await fs.readdir(projectPath)).toEqual([])
      },
    )

    it.each([null, '', 123, 'relative/project'])(
      'rejects invalid project path %j',
      async (invalidPath) => {
        await expect(invoke(channel, [invalidPath, key])).rejects.toThrow('Project path')
        expect(await fs.readdir(projectPath)).toEqual([])
      },
    )

    it.each([0, 1, 3])('rejects wrong argument count %s', async (count) => {
      const args = [projectPath, key, 'extra'].slice(0, count)
      await expect(invoke(channel, args)).rejects.toThrow('Expected 2 Host UI arguments')
      expect(await fs.readdir(projectPath)).toEqual([])
    })
  })
})
