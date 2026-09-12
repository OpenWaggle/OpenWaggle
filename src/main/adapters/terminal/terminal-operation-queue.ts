import path from 'node:path'
import type { TerminalKey, TerminalOwnerKey } from '@shared/types/terminal'

type TerminalOperationTail = Promise<void>
type TerminalBlockDisposition = 'cancel' | 'retry'

interface TerminalBlockCounts {
  cancel: number
  retry: number
}

/**
 * Serializes lifecycle mutations for one terminal and provides short-lived
 * scope fences for owner/path/application teardown. Fences reject operations
 * that arrive after teardown starts; operations already queued remain ordered
 * ahead of the teardown barrier.
 */
export interface TerminalOperationQueue {
  readonly tails: Map<TerminalKey, TerminalOperationTail>
  scopeTail: TerminalOperationTail
  /** Every cwd admitted on the current per-key tail, retained until it drains. */
  readonly operationCwds: Map<TerminalKey, Set<string>>
  readonly blockedKeys: Map<TerminalKey, number>
  readonly blockedOwners: Map<TerminalOwnerKey, TerminalBlockCounts>
  readonly blockedPaths: Map<string, number>
  blockedAll: number
}

export function makeTerminalOperationQueue(): TerminalOperationQueue {
  return {
    tails: new Map(),
    scopeTail: Promise.resolve(),
    operationCwds: new Map(),
    blockedKeys: new Map(),
    blockedOwners: new Map(),
    blockedPaths: new Map(),
    blockedAll: 0,
  }
}

export function enqueueTerminalScopeOperation<Result>(
  queue: TerminalOperationQueue,
  operation: () => Promise<Result>,
) {
  const result = queue.scopeTail.then(operation)
  queue.scopeTail = result.then(
    () => undefined,
    () => undefined,
  )
  return result
}

export function waitForTerminalScopeOperation(queue: TerminalOperationQueue) {
  return queue.scopeTail
}

export function enqueueTerminalOperation<Result>(
  queue: TerminalOperationQueue,
  key: TerminalKey,
  operation: () => Promise<Result>,
  cwd?: string,
): Promise<Result> {
  const predecessor = queue.tails.get(key) ?? Promise.resolve()
  const result = predecessor.then(operation)
  const tail = result.then(
    () => undefined,
    () => undefined,
  )
  queue.tails.set(key, tail)
  if (cwd !== undefined) {
    const cwds = queue.operationCwds.get(key) ?? new Set<string>()
    cwds.add(path.resolve(cwd))
    queue.operationCwds.set(key, cwds)
  }
  void tail.then(() => {
    if (queue.tails.get(key) !== tail) return
    queue.tails.delete(key)
    queue.operationCwds.delete(key)
  })
  return result
}

export async function waitForTerminalOperations(
  queue: TerminalOperationQueue,
  matches: (key: TerminalKey) => boolean,
) {
  // A scope fence is installed before this runs. The loop also covers a close
  // that was admitted concurrently and appended while the prior tail settled.
  while (true) {
    const pending = [...queue.tails].flatMap(([key, tail]) => (matches(key) ? [tail] : []))
    if (pending.length === 0) return
    await Promise.all(pending)
  }
}

function increment<Key>(counts: Map<Key, number>, key: Key) {
  counts.set(key, (counts.get(key) ?? 0) + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const next = (counts.get(key) ?? 1) - 1
    if (next === 0) counts.delete(key)
    else counts.set(key, next)
  }
}

export const blockTerminalKey = (queue: TerminalOperationQueue, key: TerminalKey) =>
  increment(queue.blockedKeys, key)

export function blockTerminalOwner(
  queue: TerminalOperationQueue,
  ownerKey: TerminalOwnerKey,
  disposition: TerminalBlockDisposition = 'cancel',
) {
  const counts = queue.blockedOwners.get(ownerKey) ?? { cancel: 0, retry: 0 }
  counts[disposition] += 1
  queue.blockedOwners.set(ownerKey, counts)
  let released = false
  return () => {
    if (released) return
    released = true
    counts[disposition] -= 1
    if (counts.cancel === 0 && counts.retry === 0) queue.blockedOwners.delete(ownerKey)
  }
}

export const blockTerminalPath = (queue: TerminalOperationQueue, directoryPath: string) =>
  increment(queue.blockedPaths, path.resolve(directoryPath))

export function blockAllTerminals(queue: TerminalOperationQueue) {
  queue.blockedAll += 1
  let released = false
  return () => {
    if (released) return
    released = true
    queue.blockedAll -= 1
  }
}

export function isTerminalPathWithin(candidatePath: string, directoryPath: string) {
  const relative = path.relative(directoryPath, path.resolve(candidatePath))
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  )
}

export function terminalOperationBlockDisposition(
  queue: TerminalOperationQueue,
  input: {
    readonly key: TerminalKey
    readonly ownerKey: TerminalOwnerKey
    readonly cwd?: string
  },
) {
  if (queue.blockedAll > 0 || queue.blockedKeys.has(input.key)) return 'cancel'
  const ownerBlock = queue.blockedOwners.get(input.ownerKey)
  if (ownerBlock !== undefined) {
    if (ownerBlock.cancel > 0) return 'cancel'
    if (ownerBlock.retry > 0) return 'retry'
  }
  if (input.cwd !== undefined) {
    for (const directoryPath of queue.blockedPaths.keys()) {
      if (isTerminalPathWithin(input.cwd, directoryPath)) return 'cancel'
    }
  }
  return 'none'
}

export const isTerminalOperationBlocked = (
  queue: TerminalOperationQueue,
  input: Parameters<typeof terminalOperationBlockDisposition>[1],
) => terminalOperationBlockDisposition(queue, input) !== 'none'
