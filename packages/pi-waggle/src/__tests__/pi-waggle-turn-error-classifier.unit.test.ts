import type { AssistantMessage } from '@earendil-works/pi-ai'
import * as PiAi from '@earendil-works/pi-ai'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it, vi } from 'vitest'
import { createPiWaggleTurnErrorClassifier } from '../default-turn-error.js'

const unauthorized = fromPartial<AssistantMessage>({
  role: 'assistant',
  stopReason: 'error',
  errorMessage: '401 Unauthorized',
})

describe("the default extension's turn error classifier", () => {
  it("judges a turn's error by pi-ai's rules", async () => {
    const classify = await createPiWaggleTurnErrorClassifier(async () => PiAi)()

    expect(classify?.(unauthorized)).toBe(false)
  })

  it('is absent where pi-ai cannot load, such as a CommonJS consumer, and tries again next turn', async () => {
    const load = vi
      .fn<() => Promise<typeof PiAi>>()
      .mockRejectedValueOnce(new Error('ERR_PACKAGE_PATH_NOT_EXPORTED'))
      .mockResolvedValue(PiAi)
    const classifier = createPiWaggleTurnErrorClassifier(load)

    await expect(classifier()).resolves.toBeUndefined()
    expect((await classifier())?.(unauthorized)).toBe(false)
    expect(load).toHaveBeenCalledTimes(2)
  })
})
