import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as FiberId from 'effect/FiberId'
import { describe, expect, it } from 'vitest'
import { deletionRefusalOf } from '../pi-session-deletion-refusal'

const FORK_REFUSAL = 'Session deletion was refused because fork f1 still depends on it.'
const STATE_REFUSAL =
  'Session deletion was refused because related durable state still depends on it.'

function sqliteError(code: string, message: string) {
  return Object.assign(new Error(message), { code })
}

describe("A deletion check's refusal", () => {
  it('is the message of the refusal the check threw', async () => {
    const refusal = await Effect.runPromise(deletionRefusalOf(Exit.die(new Error(FORK_REFUSAL))))

    expect(refusal).toBe(FORK_REFUSAL)
  })

  it('is a foreign key the trial delete broke', async () => {
    const constraint = sqliteError('SQLITE_CONSTRAINT_FOREIGNKEY', 'FOREIGN KEY constraint failed')
    const exit = Exit.die(new Error(STATE_REFUSAL, { cause: { cause: constraint } }))

    expect(await Effect.runPromise(deletionRefusalOf(exit))).toBe(STATE_REFUSAL)
  })

  it('is nothing when the Session can be deleted', async () => {
    expect(await Effect.runPromise(deletionRefusalOf(Exit.void))).toBeUndefined()
  })

  it.each<[string, Exit.Exit<unknown, unknown>]>([
    ['an interruption', Exit.interrupt(FiberId.none)],
    ['a failed query', Exit.fail(sqliteError('SQLITE_BUSY', 'database is locked'))],
    [
      'a trial delete that failed for another reason',
      Exit.die(
        new Error(STATE_REFUSAL, {
          cause: { cause: sqliteError('SQLITE_BUSY', 'database is locked') },
        }),
      ),
    ],
  ])('is no refusal for %s, which goes on as a failure to retry', async (_name, exit) => {
    const checked = await Effect.runPromiseExit(deletionRefusalOf(exit))

    expect(Exit.isFailure(checked)).toBe(true)
  })
})
