import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import { describe, expect, it } from 'vitest'
import { preserveOutcomeAfterAttachmentCleanup } from '../session-attachment-cleanup'

describe('Session attachment cleanup outcome preservation', () => {
  it('does not replace a committed command response with a cleanup failure', async () => {
    const exit = await Effect.runPromiseExit(
      preserveOutcomeAfterAttachmentCleanup({
        effect: Effect.succeed('accepted-command'),
        cleanup: Effect.fail(new Error('cleanup failed')),
        operation: 'command',
        sessionId: 'session-a',
      }),
    )

    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) expect(exit.value).toBe('accepted-command')
  })

  it('preserves the original command failure when cleanup also defects', async () => {
    const commandFailure = new Error('command failed')
    const exit = await Effect.runPromiseExit(
      preserveOutcomeAfterAttachmentCleanup({
        effect: Effect.fail(commandFailure),
        cleanup: Effect.die(new Error('cleanup defect')),
        operation: 'command',
        sessionId: 'session-a',
      }),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(exit.cause).toMatchObject({ _tag: 'Fail', error: commandFailure })
    }
  })
})
