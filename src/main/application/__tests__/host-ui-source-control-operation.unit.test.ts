import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionOutputRetryRepository } from '../../ports/session-output-retry-repository'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SessionRepository } from '../../ports/session-repository'
import { SessionResourceRepository } from '../../ports/session-resource-repository'

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  recordSessionGitOutputsOperation: vi.fn(),
}))

vi.mock('../session-git-outputs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../session-git-outputs')>()
  const { succeed } = await import('effect/Effect')
  return {
    ...actual,
    recordSessionGitOutputsOperation: (...args: unknown[]) =>
      succeed(mocks.recordSessionGitOutputsOperation(...args)),
  }
})

vi.mock('../../services/source-control/source-control-runtime', () => ({
  sourceControlSettingsAccess: () => ({ read: vi.fn(), patch: mocks.patch }),
}))

const { dispatchHostUiSourceControlOperation } = await import('../host-ui-source-control-operation')

let projectPath = ''

/** Session A is a local Session in `projectPath`, on node n of branch b. */
const SESSION_SERVICES = Layer.mergeAll(
  Layer.succeed(
    SessionProjectionRepository,
    fromPartial({
      getOptional: (sessionId: string) =>
        Effect.succeed(
          sessionId === 'session-a' ? { projectPath, environmentMode: 'local' } : null,
        ),
    }),
  ),
  Layer.succeed(
    SessionRepository,
    fromPartial({
      getWorkspace: () => Effect.succeed({ activeNodeId: 'n', activeBranchId: 'b' }),
    }),
  ),
  Layer.succeed(SessionOutputRetryRepository, fromPartial({})),
  Layer.succeed(SessionResourceRepository, fromPartial({})),
)

function run(
  effect: Effect.Effect<
    unknown,
    unknown,
    | SessionProjectionRepository
    | SessionRepository
    | SessionOutputRetryRepository
    | SessionResourceRepository
  >,
) {
  return Effect.runPromiseExit(effect.pipe(Effect.provide(SESSION_SERVICES)))
}

describe('source-control operations the Session Host runs for the window', () => {
  beforeEach(async () => {
    projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'openwaggle-source-control-'))
    mocks.patch.mockReset().mockResolvedValue(undefined)
    mocks.recordSessionGitOutputsOperation.mockReset()
  })

  afterEach(async () => {
    await fs.rm(projectPath, { recursive: true, force: true })
  })

  it('checks a Session working path where Sessions live', async () => {
    const verify = (sessionId: string, workingPath: string) =>
      run(
        dispatchHostUiSourceControlOperation(
          'git:session:verify-working-path',
          [sessionId, workingPath],
          23,
        ),
      )
    const otherFolder = path.join(projectPath, 'other')
    await fs.mkdir(otherFolder)

    await expect(verify('session-a', projectPath)).resolves.toMatchObject({
      _tag: 'Success',
      value: { owned: true, occurrence: { nodeId: 'n', branchId: 'b' } },
    })
    await expect(verify('session-a', otherFolder)).resolves.toMatchObject({
      _tag: 'Success',
      value: { owned: false },
    })
    await expect(verify('session-b', projectPath)).resolves.toMatchObject({
      _tag: 'Success',
      value: { owned: false },
    })
  })

  it('records Session Git Outputs in the Host and rejects a relative working path', async () => {
    mocks.recordSessionGitOutputsOperation.mockReturnValue({ commitOutput: { ok: true } })
    const payload = {
      occurrence: { nodeId: null, branchId: null, createdAt: 1 },
      commit: { commitHash: 'abc123', summary: 'Fix' },
    }

    await expect(
      run(
        dispatchHostUiSourceControlOperation(
          'git:session:record-outputs',
          ['session-a', payload],
          23,
        ),
      ),
    ).resolves.toMatchObject({ _tag: 'Success', value: { commitOutput: { ok: true } } })
    expect(mocks.recordSessionGitOutputsOperation).toHaveBeenCalledWith('session-a', payload)

    await expect(
      run(
        dispatchHostUiSourceControlOperation(
          'git:session:verify-working-path',
          ['session-a', 'relative/path'],
          23,
        ),
      ),
    ).resolves.toMatchObject({ _tag: 'Failure' })
  })

  it('refuses them on a Host that negotiated an older protocol revision', async () => {
    const result = await run(
      dispatchHostUiSourceControlOperation(
        'source-control:patch-settings',
        [{ sourceControlHostProviders: { 'git.acme.io': 'gitlab' } }],
        22,
      ),
    )

    expect(result).toMatchObject({ _tag: 'Failure' })
    expect(mocks.patch).not.toHaveBeenCalled()
  })

  it('applies a settings patch in the Host process', async () => {
    const patch = { sourceControlHostProviders: { 'git.acme.io': 'gitlab' } }

    await expect(
      run(dispatchHostUiSourceControlOperation('source-control:patch-settings', [patch], 23)),
    ).resolves.toMatchObject({ _tag: 'Success', value: { ok: true } })
    expect(mocks.patch).toHaveBeenCalledWith(patch)
  })

  it('reports a failed patch instead of throwing across the protocol', async () => {
    mocks.patch.mockRejectedValue(new Error('disk full'))

    await expect(
      run(
        dispatchHostUiSourceControlOperation(
          'source-control:patch-settings',
          [{ changeRequestOpenDestination: 'website' }],
          23,
        ),
      ),
    ).resolves.toMatchObject({ _tag: 'Success', value: { ok: false, error: 'disk full' } })
  })

  it('rejects a malformed patch', async () => {
    const result = await run(
      dispatchHostUiSourceControlOperation(
        'source-control:patch-settings',
        [{ sourceControlHostProviders: { 'git.acme.io': 'bitbucket' } }],
        23,
      ),
    )

    expect(result).toMatchObject({ _tag: 'Failure' })
    expect(mocks.patch).not.toHaveBeenCalled()
  })
})
