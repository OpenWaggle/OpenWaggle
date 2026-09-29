import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { SessionLifecyclePreparationError } from '../../errors'
import { describeLocalSessionServerError } from '../local-session-server-frame'

async function fiberFailure(error: unknown) {
  try {
    await Effect.runPromise(Effect.fail(error))
  } catch (failure) {
    return failure
  }
  throw new Error('Expected the Effect to fail.')
}

describe('Local Session server error descriptions', () => {
  it('keeps ordinary error messages', async () => {
    expect(describeLocalSessionServerError(new Error('Session not found.'))).toBe(
      'Session not found.',
    )
    expect(describeLocalSessionServerError(await fiberFailure(new Error('boom')))).toBe('boom')
  })

  it('names a tagged error that has no message instead of "An error has occurred"', async () => {
    const failure = await fiberFailure(
      new SessionLifecyclePreparationError({
        operation: 'resolve-source-project',
        cause: { sessionId: 's-1' },
      }),
    )

    expect(describeLocalSessionServerError(failure)).toBe(
      'SessionLifecyclePreparationError (resolve-source-project): sessionId=s-1',
    )
  })

  it('shows only identifying fields of a structured cause', async () => {
    const failure = await fiberFailure(
      new SessionLifecyclePreparationError({
        operation: 'load-settings',
        cause: { projectPath: '/repo', apiKey: 'sk-secret', settings: { token: 'secret' } },
      }),
    )

    const described = describeLocalSessionServerError(failure)
    expect(described).toBe('SessionLifecyclePreparationError (load-settings): projectPath=/repo')
    expect(described).not.toContain('secret')
  })

  it('follows a bounded chain of causes', async () => {
    const failure = await fiberFailure(
      new SessionLifecyclePreparationError({
        operation: 'outer',
        cause: new Error('disk full'),
      }),
    )

    expect(describeLocalSessionServerError(failure)).toBe(
      'SessionLifecyclePreparationError (outer): disk full',
    )
    expect(describeLocalSessionServerError('plain')).toBe('plain')
    expect(describeLocalSessionServerError(await fiberFailure(' '))).toBe(
      'The Session Host could not complete the request.',
    )
    expect(describeLocalSessionServerError(new Error(''))).toBe(
      'The Session Host could not complete the request.',
    )
  })

  it('never prints an undescribed failure or defect object', async () => {
    const plain = await fiberFailure({ secret: 'hunter2' })
    let defect: unknown
    try {
      await Effect.runPromise(Effect.die({ secret: 'hunter2' }))
    } catch (failure) {
      defect = failure
    }

    expect(describeLocalSessionServerError(plain)).toBe(
      'The Session Host could not complete the request.',
    )
    expect(describeLocalSessionServerError(defect)).toBe(
      'The Session Host could not complete the request.',
    )
  })
})
