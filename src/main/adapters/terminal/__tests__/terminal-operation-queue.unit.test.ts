import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  blockTerminalOwner,
  enqueueTerminalOperation,
  enqueueTerminalScopeOperation,
  isTerminalPathWithin,
  makeTerminalOperationQueue,
  terminalOperationBlockDisposition,
  waitForTerminalOperations,
  waitForTerminalScopeOperation,
} from '../terminal-operation-queue'

function deferred() {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('terminal operation queue', () => {
  it('serializes one terminal even when an earlier lifecycle mutation fails', async () => {
    const queue = makeTerminalOperationQueue()
    const order: string[] = []
    const first = enqueueTerminalOperation(queue, 'session::main', async () => {
      order.push('first')
      throw new Error('expected failure')
    })
    const second = enqueueTerminalOperation(queue, 'session::main', async () => {
      order.push('second')
      return 2
    })

    await expect(first).rejects.toThrow('expected failure')
    await expect(second).resolves.toBe(2)
    expect(order).toEqual(['first', 'second'])
  })

  it('retains every admitted cwd until the complete per-key tail drains', async () => {
    const queue = makeTerminalOperationQueue()
    const insideRoot = path.join(process.cwd(), 'terminal-scope')
    const inside = path.join(insideRoot, 'child')
    const outside = path.join(process.cwd(), 'elsewhere')
    const firstGate = deferred()
    const secondGate = deferred()
    const first = enqueueTerminalOperation(queue, 'session::main', () => firstGate.promise, inside)
    const second = enqueueTerminalOperation(
      queue,
      'session::main',
      () => secondGate.promise,
      outside,
    )

    const admitted = queue.operationCwds.get('session::main')
    if (admitted === undefined) throw new Error('Expected admitted cwd set')
    expect(admitted).toEqual(new Set([path.resolve(inside), path.resolve(outside)]))
    expect([...admitted].some((cwd) => isTerminalPathWithin(cwd, insideRoot))).toBe(true)

    firstGate.resolve()
    await first
    expect(queue.operationCwds.get('session::main')).toEqual(admitted)
    secondGate.resolve()
    await second
    await waitForTerminalOperations(queue, () => true)
    expect(queue.operationCwds.has('session::main')).toBe(false)
  })

  it('marks migration owner fences as retryable until their scope settles', async () => {
    const queue = makeTerminalOperationQueue()
    const scopeGate = deferred()
    const release = blockTerminalOwner(queue, 'draft:/repo', 'retry')
    const scope = enqueueTerminalScopeOperation(queue, () => scopeGate.promise)

    expect(
      terminalOperationBlockDisposition(queue, {
        key: 'draft:/repo::main',
        ownerKey: 'draft:/repo',
      }),
    ).toBe('retry')

    const settled = waitForTerminalScopeOperation(queue)
    scopeGate.resolve()
    await Promise.all([scope, settled])
    release()
    expect(
      terminalOperationBlockDisposition(queue, {
        key: 'draft:/repo::main',
        ownerKey: 'draft:/repo',
      }),
    ).toBe('none')
  })
})
