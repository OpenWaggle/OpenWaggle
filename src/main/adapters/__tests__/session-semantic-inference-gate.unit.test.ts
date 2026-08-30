import { describe, expect, it, vi } from 'vitest'
import { SessionSemanticInferenceGate } from '../session-semantic-inference-gate'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('SessionSemanticInferenceGate', () => {
  it('keeps cancelled non-cancellable inference inside the concurrency bound', async () => {
    const gate = new SessionSemanticInferenceGate(1, 2)
    const first = deferred<string>()
    const second = deferred<string>()
    const controller = new AbortController()
    const firstTask = vi.fn(() => first.promise)
    const secondTask = vi.fn(() => second.promise)

    const abandoned = gate.run(firstTask, controller.signal)
    const queued = gate.run(secondTask)
    controller.abort(new Error('client disconnected'))

    await expect(abandoned).rejects.toThrow('client disconnected')
    expect(firstTask).toHaveBeenCalledOnce()
    expect(secondTask).not.toHaveBeenCalled()

    first.resolve('ignored')
    await vi.waitFor(() => expect(secondTask).toHaveBeenCalledOnce())
    second.resolve('kept')
    await expect(queued).resolves.toBe('kept')
  })

  it('removes cancelled queued inference without consuming a slot', async () => {
    const gate = new SessionSemanticInferenceGate(1, 2)
    const first = deferred<string>()
    const controller = new AbortController()
    const queuedTask = vi.fn(async () => 'unused')

    const running = gate.run(() => first.promise)
    const queued = gate.run(queuedTask, controller.signal)
    controller.abort()

    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    first.resolve('done')
    await expect(running).resolves.toBe('done')
    expect(queuedTask).not.toHaveBeenCalled()
  })

  it('rejects work beyond the bounded queue', async () => {
    const gate = new SessionSemanticInferenceGate(1, 1)
    const first = deferred<void>()
    const second = deferred<void>()
    const running = gate.run(() => first.promise)
    const queued = gate.run(() => second.promise)

    await expect(gate.run(async () => undefined)).rejects.toThrow(
      'Semantic inference capacity is temporarily exhausted',
    )
    first.resolve()
    await running
    second.resolve()
    await queued
  })
})
