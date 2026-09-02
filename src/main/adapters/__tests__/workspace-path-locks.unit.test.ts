import { describe, expect, it } from 'vitest'
import { withWorkspacePathLocks } from '../workspace-path-locks'

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((next) => {
    resolve = next
  })
  return { promise, resolve }
}

describe('workspace path locks', () => {
  it('serializes a directory mutation behind an active child write', async () => {
    const paused = deferred()
    const order: string[] = []
    const write = withWorkspacePathLocks(['/project/src/file.ts'], async () => {
      order.push('write:start')
      await paused.promise
      order.push('write:end')
    })
    await Promise.resolve()
    const move = withWorkspacePathLocks(['/project/src', '/project/lib'], async () => {
      order.push('move')
    })
    await Promise.resolve()

    expect(order).toEqual(['write:start'])
    paused.resolve()
    await Promise.all([write, move])
    expect(order).toEqual(['write:start', 'write:end', 'move'])
  })

  it('allows unrelated file writes to proceed concurrently', async () => {
    const paused = deferred()
    const order: string[] = []
    const first = withWorkspacePathLocks(['/project/a.ts'], async () => {
      order.push('a:start')
      await paused.promise
      order.push('a:end')
    })
    await Promise.resolve()
    const second = withWorkspacePathLocks(['/project/b.ts'], async () => {
      order.push('b')
    })
    await second
    expect(order).toEqual(['a:start', 'b'])
    paused.resolve()
    await first
  })
})
