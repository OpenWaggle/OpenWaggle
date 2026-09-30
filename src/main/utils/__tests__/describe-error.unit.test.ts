import * as Data from 'effect/Data'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { describeError } from '../describe-error'

class RepositoryError extends Data.TaggedError('SessionProjectionRepositoryError')<{
  readonly operation: string
  readonly cause?: unknown
}> {}

describe('describeError', () => {
  it('keeps a plain error message', () => {
    expect(describeError(new Error('disk full'))).toBe('Error: disk full')
  })

  it('names a tagged error with an empty message by its tag and operation', () => {
    expect(describeError(new RepositoryError({ operation: 'persistSessionSnapshot' }))).toBe(
      'SessionProjectionRepositoryError (persistSessionSnapshot)',
    )
  })

  it('follows the cause chain, including through an Effect FiberFailure', () => {
    const sqlite = Object.assign(new Error('CHECK constraint failed: token_count >= 0'), {
      name: 'SqliteError',
      code: 'SQLITE_CONSTRAINT_CHECK',
    })
    const sqlFailure = Object.assign(new Error('Failed to execute statement'), {
      name: 'SqlError',
      cause: sqlite,
    })
    let fiberFailure: unknown
    try {
      Effect.runSync(Effect.fail(sqlFailure))
    } catch (error) {
      fiberFailure = error
    }
    const wrapped = new RepositoryError({
      operation: 'persistSessionSnapshot',
      cause: fiberFailure,
    })

    expect(describeError(wrapped)).toBe(
      [
        'SessionProjectionRepositoryError (persistSessionSnapshot)',
        'SqlError: Failed to execute statement',
        'SqliteError: SQLITE_CONSTRAINT_CHECK: CHECK constraint failed: token_count >= 0',
      ].join(' <- '),
    )
  })

  it('describes non-error values', () => {
    expect(describeError('boom')).toBe('boom')
    expect(describeError(undefined)).toBe('undefined')
  })
})
