export const SESSION_EXPORT_SELECTED_PATH_CACHE_PATH_LIMIT = 8
export const SESSION_EXPORT_SELECTED_PATH_CACHE_NODE_LIMIT = 250_000
const BINARY_SEARCH_DIVISOR = 2

export interface ExportSelectedPathSnapshotIdentity {
  readonly sessionId: string
  readonly selectedBranchId: string
  readonly selectedHeadNodeId: string
  readonly nodeMutationRevision: number
}

interface SelectedPathCacheOptions {
  readonly pathLimit?: number
  readonly nodeLimit?: number
}

function identityKey(identity: ExportSelectedPathSnapshotIdentity) {
  return JSON.stringify([
    identity.sessionId,
    identity.selectedBranchId,
    identity.selectedHeadNodeId,
    identity.nodeMutationRevision,
  ])
}

function firstCreatedOrderAfter(createdOrders: readonly number[], cursor: number) {
  let lower = 0
  let upper = createdOrders.length
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / BINARY_SEARCH_DIVISOR)
    if ((createdOrders[middle] ?? Number.POSITIVE_INFINITY) <= cursor) lower = middle + 1
    else upper = middle
  }
  return lower
}

export class SessionExportSelectedPathCache {
  readonly #paths = new Map<string, readonly number[]>()
  readonly #rejectedPaths = new Map<string, true>()
  readonly #pathLimit: number
  readonly #nodeLimit: number
  #nodeCount = 0

  constructor(options: SelectedPathCacheOptions = {}) {
    this.#pathLimit = options.pathLimit ?? SESSION_EXPORT_SELECTED_PATH_CACHE_PATH_LIMIT
    this.#nodeLimit = options.nodeLimit ?? SESSION_EXPORT_SELECTED_PATH_CACHE_NODE_LIMIT
    if (!Number.isSafeInteger(this.#pathLimit) || this.#pathLimit < 1) {
      throw new Error('Export selected-path cache path limit must be a positive safe integer.')
    }
    if (!Number.isSafeInteger(this.#nodeLimit) || this.#nodeLimit < 1) {
      throw new Error('Export selected-path cache node limit must be a positive safe integer.')
    }
  }

  has(identity: ExportSelectedPathSnapshotIdentity) {
    return this.#touch(identityKey(identity)) !== undefined
  }

  wasRejected(identity: ExportSelectedPathSnapshotIdentity) {
    const key = identityKey(identity)
    if (!this.#rejectedPaths.has(key)) return false
    this.#rejectedPaths.delete(key)
    this.#rejectedPaths.set(key, true)
    return true
  }

  remember(identity: ExportSelectedPathSnapshotIdentity, createdOrders: readonly number[]) {
    const key = identityKey(identity)
    if (createdOrders.length > this.#nodeLimit) {
      this.#rememberRejected(key)
      return false
    }
    this.#rejectedPaths.delete(key)
    const previous = this.#paths.get(key)
    if (previous) {
      this.#paths.delete(key)
      this.#nodeCount -= previous.length
    }
    while (
      this.#paths.size >= this.#pathLimit ||
      this.#nodeCount + createdOrders.length > this.#nodeLimit
    ) {
      const oldestKey = this.#paths.keys().next().value
      if (oldestKey === undefined) break
      const oldest = this.#paths.get(oldestKey)
      this.#paths.delete(oldestKey)
      this.#nodeCount -= oldest?.length ?? 0
    }
    const retained = [...createdOrders]
    this.#paths.set(key, retained)
    this.#nodeCount += retained.length
    return true
  }

  readPage(
    identity: ExportSelectedPathSnapshotIdentity,
    input: {
      readonly afterCreatedOrder: number
      readonly throughCreatedOrder: number
      readonly limit: number
    },
  ) {
    const createdOrders = this.#touch(identityKey(identity))
    if (!createdOrders) return undefined
    const start = firstCreatedOrderAfter(createdOrders, input.afterCreatedOrder)
    const page: number[] = []
    for (let index = start; index < createdOrders.length && page.length < input.limit; index += 1) {
      const createdOrder = createdOrders[index]
      if (createdOrder === undefined || createdOrder > input.throughCreatedOrder) break
      page.push(createdOrder)
    }
    return page
  }

  diagnostics() {
    return { paths: this.#paths.size, nodes: this.#nodeCount }
  }

  #touch(key: string) {
    const createdOrders = this.#paths.get(key)
    if (!createdOrders) return undefined
    this.#paths.delete(key)
    this.#paths.set(key, createdOrders)
    return createdOrders
  }

  #rememberRejected(key: string) {
    this.#rejectedPaths.delete(key)
    this.#rejectedPaths.set(key, true)
    while (this.#rejectedPaths.size > this.#pathLimit) {
      const oldestKey = this.#rejectedPaths.keys().next().value
      if (oldestKey === undefined) break
      this.#rejectedPaths.delete(oldestKey)
    }
  }
}
