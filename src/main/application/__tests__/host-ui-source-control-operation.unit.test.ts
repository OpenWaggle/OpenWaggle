import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionOutputRetryRepository } from '../../ports/session-output-retry-repository'
import { SessionProjectionRepository } from '../../ports/session-projection-repository'
import { SessionRepository } from '../../ports/session-repository'
import { SessionResourceRepository } from '../../ports/session-resource-repository'

const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  verifySessionGitWorkingPath: vi.fn(),
  recordSessionGitOutputsOperation: vi.fn(),
}))

vi.mock('../session-git-outputs', async () => {
  const { succeed } = await import('effect/Effect')
  return {
    verifySessionGitWorkingPath: (...args: unknown[]) =>
      succeed(mocks.verifySessionGitWorkingPath(...args)),
    recordSessionGitOutputsOperation: (...args: unknown[]) =>
      succeed(mocks.recordSessionGitOutputsOperation(...args)),
  }
})

vi.mock('../../services/source-control/source-control-runtime', () => ({
  sourceControlSettingsAccess: () => ({ read: vi.fn(), patch: mocks.patch }),
}))

const { dispatchHostUiSourceControlOperation } = await import('../host-ui-source-control-operation')

/** The settings patch needs none of these; they only satisfy the dispatcher's requirements. */
const UNUSED_SESSION_SERVICES = Layer.mergeAll(
  Layer.succeed(SessionProjectionRepository, fromPartial({})),
  Layer.succeed(SessionRepository, fromPartial({})),
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
  return Effect.runPromiseExit(effect.pipe(Effect.provide(UNUSED_SESSION_SERVICES)))
}

describe('source-control operations the Session Host runs for the window', () => {
  beforeEach(() => {
    mocks.patch.mockReset().mockResolvedValue(undefined)
    mocks.verifySessionGitWorkingPath.mockReset()
    mocks.recordSessionGitOutputsOperation.mockReset()
  })

  it('checks a Session working path where Sessions live', async () => {
    const verification = { owned: true, occurrence: { nodeId: 'n', branchId: 'b', createdAt: 1 } }
    mocks.verifySessionGitWorkingPath.mockReturnValue(verification)

    await expect(
      run(
        dispatchHostUiSourceControlOperation(
          'git:session:verify-working-path',
          ['session-a', '/repo/session-a'],
          23,
        ),
      ),
    ).resolves.toMatchObject({ _tag: 'Success', value: verification })
    expect(mocks.verifySessionGitWorkingPath).toHaveBeenCalledWith('session-a', '/repo/session-a')
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
