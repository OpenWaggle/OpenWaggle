import { SessionId } from '@shared/types/brand'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import type { UpsertSessionResourceInput } from '../../ports/session-resource-repository'
import { SessionResourceRepository } from '../../ports/session-resource-repository'
import { recordSessionChangeRequest } from '../session-resource-recording'

describe('recordSessionChangeRequest', () => {
  it('records a created change request as an output of the opened session', async () => {
    let recorded: UpsertSessionResourceInput | null = null
    const layer = Layer.succeed(
      SessionResourceRepository,
      SessionResourceRepository.of({
        upsert: (input) => {
          recorded = input
          return Effect.succeed({
            ...input,
            occurrences: [input.occurrence],
            isSource: false,
            isOutput: true,
          })
        },
        list: () => Effect.succeed([]),
        findByCanonicalKey: () => Effect.succeed(null),
        getContentLocation: () => Effect.succeed(null),
      }),
    )

    await Effect.runPromise(
      recordSessionChangeRequest(SessionId('session-1'), {
        title: 'Add Session Summary',
        url: 'https://github.com/openwaggle/openwaggle/pull/42',
      }).pipe(Effect.provide(layer)),
    )

    expect(recorded).toMatchObject({
      sessionId: SessionId('session-1'),
      canonicalKey: 'url:https://github.com/openwaggle/openwaggle/pull/42',
      kind: 'change-request',
      title: 'Add Session Summary',
      locator: 'https://github.com/openwaggle/openwaggle/pull/42',
      occurrence: { actor: 'user', activity: 'created' },
    })
  })
})
