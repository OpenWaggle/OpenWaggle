import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import {
  decodeHostUiExtensionListContributionsInput,
  normalizeHostUiExtensionApplyPackageRemoveInput,
} from '../host-ui-extension-input'

const PROPOSAL_HASH = 'a'.repeat(64)

function failureMessage<A>(effect: Effect.Effect<A, Error>) {
  return Effect.runPromise(Effect.flip(effect)).then((error) => error.message)
}

describe('host UI extension inputs', () => {
  it('names the undeclared key a contribution list request carries', async () => {
    const message = await failureMessage(
      decodeHostUiExtensionListContributionsInput({ projectPaths: [], extra: true }),
    )

    expect(message).toContain(
      'Extension contribution list input must be an object with optional projectPaths and sessionId',
    )
    expect(message).toContain('extra: ')
  })

  it('names the contribution list field of the wrong type', async () => {
    const message = await failureMessage(
      decodeHostUiExtensionListContributionsInput({ projectPaths: [7] }),
    )

    expect(message).toContain('projectPaths.0: ')
  })

  it('leaves optional fields sent as undefined absent from the decoded request', async () => {
    const decoded = await Effect.runPromise(
      normalizeHostUiExtensionApplyPackageRemoveInput({
        extensionId: 'example-extension',
        scope: { kind: 'global' },
        viewProjectPaths: undefined,
        actor: { kind: 'user', userId: undefined },
        userApproval: {
          approved: true,
          approvedProposalHash: PROPOSAL_HASH,
          approvedBy: 'user',
          approvedAt: 1,
        },
        globalConfirmation: undefined,
      }),
    )

    expect(decoded.actor).toStrictEqual({ kind: 'user' })
    expect('globalConfirmation' in decoded).toBe(false)
    expect(decoded.viewProjectPaths).toStrictEqual([])
  })
})
