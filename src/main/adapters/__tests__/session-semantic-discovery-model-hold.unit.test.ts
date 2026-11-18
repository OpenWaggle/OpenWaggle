import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'
import { holdModelDownloads } from '../session-semantic-discovery-background'

describe('holdModelDownloads', () => {
  it("gives the model the Host's hold for its background downloads while the loop runs", async () => {
    const acquired: string[] = []
    let hold: (() => () => void) | null = null
    const model = {
      holdDownloadsWith: (next: () => () => void) => {
        hold = next
        return () => {
          hold = null
        }
      },
    }

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* holdModelDownloads(model, () => {
            acquired.push('semantic-preparation')
            return () => undefined
          })
          const current: (() => () => void) | null = hold
          current?.()
        }),
      ),
    )

    expect(acquired).toEqual(['semantic-preparation'])
    expect(hold).toBeNull()
  })
})
