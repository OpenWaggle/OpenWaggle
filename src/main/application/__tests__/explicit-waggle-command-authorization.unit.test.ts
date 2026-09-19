import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { authorizeExplicitWaggleCaller } from '../explicit-waggle-command-service'

describe('explicit Waggle command authorization', () => {
  it('accepts only the authenticated local GUI identity', async () => {
    await expect(
      Effect.runPromise(authorizeExplicitWaggleCaller({ callerId: 'gui:local-user' })),
    ).resolves.toBeUndefined()
    await expect(
      Effect.runPromise(authorizeExplicitWaggleCaller({ callerId: 'cli:external' })),
    ).rejects.toThrow('authenticated local GUI caller')
  })
})
