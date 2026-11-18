import type { LocalSessionCallerIdentity } from '@shared/types/local-session-profile'
import type { LocalSessionCommandPayload } from '@shared/types/local-session-protocol'
import { SESSION_CONTROL_CONTRACT_VERSION } from '@shared/types/session-control'
import { fromPartial } from '@total-typescript/shoehorn'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { describe, expect, it } from 'vitest'
import { FollowUpEditHoldRepository } from '../../ports/follow-up-edit-hold-repository'
import { SessionControlAttachmentService } from '../../ports/session-control-attachment-service'
import { bindSessionControlAttachments } from '../session-control-command-attachments'

const SAVE: Extract<LocalSessionCommandPayload, { contract: 'session-control-v2' }> = {
  contract: 'session-control-v2',
  request: {
    contractVersion: SESSION_CONTROL_CONTRACT_VERSION,
    requestId: 'request-1',
    idempotencyKey: 'key-1',
    command: {
      operation: 'queue-edit-save',
      sessionId: 'session-1',
      followUpId: 'follow-up-1',
      holdId: 'hold-1',
      expectedQueueRevision: 3,
      input: { text: 'Edited', attachmentIds: ['attachment-1'] },
    },
  },
}

function retainedFor(caller: LocalSessionCallerIdentity) {
  const retained: string[][] = []
  const layer = Layer.mergeAll(
    Layer.succeed(SessionControlAttachmentService, fromPartial({ bind: () => Effect.void })),
    Layer.succeed(
      FollowUpEditHoldRepository,
      fromPartial({
        retainAttachments: (input: { readonly attachmentIds: readonly string[] }) =>
          Effect.sync(() => {
            retained.push([...input.attachmentIds])
          }),
      }),
    ),
  )
  return Effect.runPromise(
    bindSessionControlAttachments(caller, SAVE).pipe(Effect.provide(layer), Effect.as(retained)),
  )
}

describe('binding a Follow-up edit save’s attachments', () => {
  it('retains them past a rejected save only for the desktop user', async () => {
    expect(await retainedFor({ callerId: 'gui:local-user' })).toEqual([['attachment-1']])
    expect(await retainedFor({ callerId: 'session-agent:queen:run-1' })).toEqual([])
    expect(
      await retainedFor({
        callerId: 'gui:local-user',
        profileAuthority: fromPartial({ authorizationCeiling: 'ask-for-approval' }),
      }),
    ).toEqual([])
  })
})
