import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LocalSessionCliClientInput } from '../local-session-cli-client'
import {
  type LocalSessionHostRuntime,
  startLocalSessionHost,
} from '../session-host/local-session-host-runtime'
import {
  prepareLocalSessionHostPaths,
  resolveLocalSessionHostPaths,
} from '../session-host/local-session-paths'
import { generateProfileCredential } from '../session-host/profile-credential'

const mocks = vi.hoisted<{ clientInput: LocalSessionCliClientInput | undefined }>(() => ({
  clientInput: undefined,
}))

vi.mock('../local-session-cli-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../local-session-cli-client')>()),
  createLocalSessionCliClientInput: vi.fn(async () => {
    if (!mocks.clientInput) throw new Error('Missing Sessions CLI integration client input.')
    return mocks.clientInput
  }),
}))

import { runSessionsCli } from '../sessions-cli'

describe('Sessions CLI Host rejection', () => {
  let temporaryRoot = ''
  let fallbackEndpointDirectory: string | null = null
  let runtime: LocalSessionHostRuntime | null = null

  beforeEach(async () => {
    temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-cli-rejection-'))
    fallbackEndpointDirectory = null
    runtime = null
    mocks.clientInput = undefined
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await runtime?.stop()
    if (fallbackEndpointDirectory) {
      await fs.rm(fallbackEndpointDirectory, { recursive: true, force: true })
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true })
  })

  it('preserves a named-profile authorization code across the socket and CLI boundary', async () => {
    const paths = resolveLocalSessionHostPaths({
      userDataRoot: temporaryRoot,
      temporaryRoot: '/tmp',
      platform: 'darwin',
    })
    await prepareLocalSessionHostPaths(paths)
    fallbackEndpointDirectory =
      paths.endpointDirectory === paths.stateRoot ? null : paths.endpointDirectory
    const profileCredential = generateProfileCredential()
    runtime = await startLocalSessionHost({
      endpoint: paths.endpoint,
      databasePath: paths.databasePath,
      idleGracePeriodMs: 60_000,
      authenticate: async (hello) => {
        expect(hello).toMatchObject({ profile: 'reviewer', credential: profileCredential })
        return {
          callerId: 'profile:reviewer',
          profileAuthority: {
            profileId: 'reviewer-id',
            profileName: 'reviewer',
            capabilities: [],
            scope: { all: true },
            authorizationCeiling: 'ask-for-approval',
          },
        }
      },
      dispatch: async () => {
        throw Object.assign(new Error('An error has occurred'), { code: 'capability_denied' })
      },
    })
    mocks.clientInput = {
      paths,
      clientKind: 'cli',
      clientVersion: 'test',
      profile: 'reviewer',
      profileCredential,
      workingDirectory: temporaryRoot,
    }

    const exitCode = await runSessionsCli(['list', '--profile', 'reviewer', '--json'])
    expect(JSON.parse(String(vi.mocked(process.stderr.write).mock.calls[0]?.[0]))).toEqual({
      schemaVersion: 1,
      type: 'error',
      error: { kind: 'authorization', message: 'An error has occurred' },
    })
    expect(exitCode).toBe(4)
    expect(process.stdout.write).not.toHaveBeenCalled()
  })
})
