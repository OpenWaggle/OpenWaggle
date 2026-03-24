import * as FileSystem from '@effect/platform/FileSystem'
import * as NodeContext from '@effect/platform-node/NodeContext'
import * as Effect from 'effect/Effect'
import { describe, expect, it } from 'vitest'

describe('FileSystem via NodeContext', () => {
  it('is accessible through NodeContext.layer (already in AppLayer)', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        return typeof fs.readFile === 'function' && typeof fs.writeFile === 'function'
      }).pipe(Effect.provide(NodeContext.layer)),
    )

    expect(result).toBe(true)
  })
})
