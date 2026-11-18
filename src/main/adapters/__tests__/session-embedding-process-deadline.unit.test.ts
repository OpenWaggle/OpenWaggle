import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { fromPartial } from '@total-typescript/shoehorn'
import { describe, expect, it } from 'vitest'
import { SessionEmbeddingProcess } from '../session-embedding-process'

/** A model process that takes every batch and never answers (stuck in ORT or a model load). */
function stuckChild() {
  const events = new EventEmitter()
  const kills: (NodeJS.Signals | number | undefined)[] = []
  const child = fromPartial<ChildProcess>({
    on: (event: string, listener: (...args: unknown[]) => void) => {
      events.on(event, listener)
      return child
    },
    send: (_message: unknown, callback?: (error: Error | null) => void) => {
      callback?.(null)
      return true
    },
    kill: (signal?: NodeJS.Signals | number) => {
      kills.push(signal)
      queueMicrotask(() => events.emit('exit', null, signal))
      return true
    },
    connected: true,
    exitCode: null,
    signalCode: null,
  })
  return { child, kills }
}

describe('embedding requests have a deadline (review R5 P3-9)', () => {
  it('kills a child that does not answer, fails its batches, and can be disposed', async () => {
    const stuck = stuckChild()
    const spawned: ChildProcess[] = []
    const embedding = new SessionEmbeddingProcess(
      () => ({ modelId: 'model', revision: 'main', dtype: 'q8' }),
      {
        spawnChild: () => {
          spawned.push(stuck.child)
          return stuck.child
        },
        requestTimeoutMs: 30,
        transformersPath: '/unused',
      },
    )

    const first = embedding.embed(['a'])
    const second = embedding.embed(['b'])

    await expect(first).rejects.toThrow('did not answer')
    await expect(second).rejects.toThrow('did not answer')
    expect(stuck.kills).toEqual(['SIGKILL'])
    expect(embedding.isRunning).toBe(false)
    expect(embedding.dispose()).toBe(true)
    expect(spawned).toHaveLength(1)
  })
})
