import * as Effect from 'effect/Effect'
import { describe, expect, it, vi } from 'vitest'
import { withRunAttachmentCleanup } from '../session-control-run-executor'

describe('Session Control Run attachment cleanup', () => {
  it.each([
    ['successful', Effect.succeed('completed')],
    ['failed', Effect.fail(new Error('run failed'))],
  ])('releases consumed attachments after a %s terminal Run', async (_label, effect) => {
    const release = vi.fn(() => Effect.void)

    await Effect.runPromiseExit(
      withRunAttachmentCleanup({
        effect,
        attachments: { release },
        attachmentIds: ['attachment-consumed'],
        sessionId: 'session-target',
        ownerCallerId: 'gui:local-user',
      }),
    )

    expect(release).toHaveBeenCalledWith({
      attachmentIds: ['attachment-consumed'],
      sessionId: 'session-target',
      ownerCallerId: 'gui:local-user',
    })
  })

  it.each([
    ['failure', Effect.fail(new Error('release failed'))],
    ['defect', Effect.die(new Error('release defect'))],
  ])('preserves a completed Run result after attachment cleanup %s', async (_label, cleanup) => {
    const exit = await Effect.runPromiseExit(
      withRunAttachmentCleanup({
        effect: Effect.succeed('completed'),
        attachments: { release: () => cleanup },
        attachmentIds: ['attachment-consumed'],
        sessionId: 'session-target',
        ownerCallerId: 'gui:local-user',
      }),
    )

    expect(exit._tag).toBe('Success')
    if (exit._tag === 'Success') expect(exit.value).toBe('completed')
  })
})
