import { SESSION_SEMANTIC_DISCOVERY_STORAGE_POLICY } from '../domain/session-semantic-discovery-storage-policy'

export interface SessionVectorRecord {
  readonly sessionId: string
  readonly groupId?: string
  readonly vector: Float32Array
}

export interface SessionVectorMatch {
  readonly sessionId: string
  readonly similarity: number
  readonly matchedRecordId?: string
}

interface IndexedSessionVector {
  readonly groupId: string
  readonly vector: Float32Array
  readonly magnitude: number
}

const BINARY_HEAP_BRANCHING_FACTOR = 2
const DEFAULT_COOPERATIVE_YIELD_INTERVAL = 2_048

function yieldToEventLoop() {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

function cooperativeYieldInterval(value: number | undefined) {
  const interval = value ?? DEFAULT_COOPERATIVE_YIELD_INTERVAL
  if (!Number.isSafeInteger(interval) || interval < 1) {
    throw new Error('Vector search yield interval must be a positive safe integer.')
  }
  return interval
}

function vectorMagnitude(vector: Float32Array) {
  let squaredMagnitude = 0
  for (const value of vector) squaredMagnitude += value * value
  return Math.sqrt(squaredMagnitude)
}

function cosineSimilarity(left: Float32Array, leftMagnitude: number, right: IndexedSessionVector) {
  if (left.length !== right.vector.length || left.length === 0) {
    return Number.NEGATIVE_INFINITY
  }
  let dot = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0
    const rightValue = right.vector[index] ?? 0
    dot += leftValue * rightValue
  }
  const denominator = leftMagnitude * right.magnitude
  return denominator === 0 ? Number.NEGATIVE_INFINITY : dot / denominator
}

function compareBestFirst(left: SessionVectorMatch, right: SessionVectorMatch) {
  return right.similarity - left.similarity || left.sessionId.localeCompare(right.sessionId)
}

function isWorse(left: SessionVectorMatch, right: SessionVectorMatch) {
  return compareBestFirst(left, right) > 0
}

function bubbleWorstUp(heap: SessionVectorMatch[], startIndex: number) {
  let index = startIndex
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / BINARY_HEAP_BRANCHING_FACTOR)
    const current = heap[index]
    const parent = heap[parentIndex]
    if (!current || !parent || !isWorse(current, parent)) return
    heap[index] = parent
    heap[parentIndex] = current
    index = parentIndex
  }
}

function sinkWorstDown(heap: SessionVectorMatch[]) {
  let index = 0
  while (true) {
    const leftIndex = index * BINARY_HEAP_BRANCHING_FACTOR + 1
    const rightIndex = leftIndex + 1
    const current = heap[index]
    const left = heap[leftIndex]
    const right = heap[rightIndex]
    if (!current || !left) return
    const worstChildIndex = right && isWorse(right, left) ? rightIndex : leftIndex
    const worstChild = heap[worstChildIndex]
    if (!worstChild || !isWorse(worstChild, current)) return
    heap[index] = worstChild
    heap[worstChildIndex] = current
    index = worstChildIndex
  }
}

function retainBest(heap: SessionVectorMatch[], match: SessionVectorMatch, limit: number) {
  if (heap.length < limit) {
    heap.push(match)
    bubbleWorstUp(heap, heap.length - 1)
    return
  }
  const worst = heap[0]
  if (!worst || compareBestFirst(match, worst) >= 0) return
  heap[0] = match
  sinkWorstDown(heap)
}

/** Exact, allocation-light cosine index for the bounded session-discovery corpus. */
export class SessionFlatVectorIndex {
  readonly #records = new Map<string, IndexedSessionVector>()

  constructor(
    private readonly maximumRecordCount: number = SESSION_SEMANTIC_DISCOVERY_STORAGE_POLICY.recordLimit,
  ) {
    if (!Number.isSafeInteger(maximumRecordCount) || maximumRecordCount < 1) {
      throw new Error('Vector index record limit must be a positive safe integer.')
    }
  }

  clone() {
    const clone = new SessionFlatVectorIndex(this.maximumRecordCount)
    for (const [sessionId, record] of this.#records) {
      clone.#records.set(sessionId, record)
    }
    return clone
  }

  replace(records: readonly SessionVectorRecord[]) {
    const sessionIds = new Set<string>()
    for (const record of records) {
      sessionIds.add(record.sessionId)
      if (sessionIds.size > this.maximumRecordCount) {
        throw new Error('Vector index record limit exceeded.')
      }
    }
    this.#records.clear()
    for (const record of records) this.upsert(record)
  }

  upsert(record: SessionVectorRecord) {
    if (!this.#records.has(record.sessionId) && this.#records.size >= this.maximumRecordCount) {
      throw new Error('Vector index record limit exceeded.')
    }
    this.#records.set(record.sessionId, {
      groupId: record.groupId ?? record.sessionId,
      vector: record.vector,
      magnitude: vectorMagnitude(record.vector),
    })
  }

  remove(sessionId: string) {
    this.#records.delete(sessionId)
  }

  retainOnly(sessionIds: ReadonlySet<string>) {
    for (const sessionId of this.#records.keys()) {
      if (!sessionIds.has(sessionId)) this.#records.delete(sessionId)
    }
  }

  search(
    query: Float32Array,
    limit: number,
    allowedIds?: ReadonlySet<string>,
    excludedIds?: ReadonlySet<string>,
  ) {
    if (limit <= 0) return []
    const queryMagnitude = vectorMagnitude(query)
    const matches: SessionVectorMatch[] = []
    for (const [sessionId, vector] of this.#records) {
      if (allowedIds && !allowedIds.has(sessionId)) continue
      if (excludedIds?.has(sessionId)) continue
      const similarity = cosineSimilarity(query, queryMagnitude, vector)
      if (Number.isFinite(similarity)) retainBest(matches, { sessionId, similarity }, limit)
    }
    return matches.toSorted(compareBestFirst)
  }

  async searchCooperatively(input: {
    readonly query: Float32Array
    readonly limit: number
    readonly allowedSessionIds?: ReadonlySet<string>
    readonly excludedSessionIds?: ReadonlySet<string>
    readonly yieldEveryRecords?: number
    readonly signal?: AbortSignal
  }) {
    input.signal?.throwIfAborted()
    if (input.limit <= 0) return []
    const queryMagnitude = vectorMagnitude(input.query)
    const matches: SessionVectorMatch[] = []
    const yieldEveryRecords = cooperativeYieldInterval(input.yieldEveryRecords)
    let processed = 0
    for (const [sessionId, vector] of this.#records) {
      processed += 1
      if (processed % yieldEveryRecords === 0) {
        input.signal?.throwIfAborted()
        await yieldToEventLoop()
        input.signal?.throwIfAborted()
      }
      if (input.allowedSessionIds && !input.allowedSessionIds.has(sessionId)) continue
      if (input.excludedSessionIds?.has(sessionId)) continue
      const similarity = cosineSimilarity(input.query, queryMagnitude, vector)
      if (Number.isFinite(similarity)) {
        retainBest(matches, { sessionId, similarity }, input.limit)
      }
    }
    return matches.toSorted(compareBestFirst)
  }

  searchGrouped(query: Float32Array, limit: number, allowedGroupIds: ReadonlySet<string>) {
    if (limit <= 0) return []
    const queryMagnitude = vectorMagnitude(query)
    const bestByGroup = new Map<
      string,
      { readonly similarity: number; readonly recordId: string }
    >()
    for (const [recordId, vector] of this.#records) {
      if (!allowedGroupIds.has(vector.groupId)) continue
      const similarity = cosineSimilarity(query, queryMagnitude, vector)
      if (!Number.isFinite(similarity)) continue
      const previous = bestByGroup.get(vector.groupId)
      if (
        previous === undefined ||
        similarity > previous.similarity ||
        (similarity === previous.similarity && recordId.localeCompare(previous.recordId) < 0)
      ) {
        bestByGroup.set(vector.groupId, { similarity, recordId })
      }
    }
    const matches: SessionVectorMatch[] = []
    for (const [sessionId, best] of bestByGroup) {
      retainBest(
        matches,
        { sessionId, similarity: best.similarity, matchedRecordId: best.recordId },
        limit,
      )
    }
    return matches.toSorted(compareBestFirst)
  }

  async searchGroupedCooperatively(input: {
    readonly query: Float32Array
    readonly limit: number
    readonly allowedGroupIds: ReadonlySet<string>
    readonly yieldEveryRecords?: number
    readonly signal?: AbortSignal
  }) {
    input.signal?.throwIfAborted()
    if (input.limit <= 0) return []
    const queryMagnitude = vectorMagnitude(input.query)
    const bestByGroup = new Map<
      string,
      { readonly similarity: number; readonly recordId: string }
    >()
    const yieldEveryRecords = cooperativeYieldInterval(input.yieldEveryRecords)
    let processed = 0
    for (const [recordId, vector] of this.#records) {
      processed += 1
      if (processed % yieldEveryRecords === 0) {
        input.signal?.throwIfAborted()
        await yieldToEventLoop()
        input.signal?.throwIfAborted()
      }
      if (!input.allowedGroupIds.has(vector.groupId)) continue
      const similarity = cosineSimilarity(input.query, queryMagnitude, vector)
      if (!Number.isFinite(similarity)) continue
      const previous = bestByGroup.get(vector.groupId)
      if (
        previous === undefined ||
        similarity > previous.similarity ||
        (similarity === previous.similarity && recordId.localeCompare(previous.recordId) < 0)
      ) {
        bestByGroup.set(vector.groupId, { similarity, recordId })
      }
    }
    const matches: SessionVectorMatch[] = []
    for (const [sessionId, best] of bestByGroup) {
      retainBest(
        matches,
        { sessionId, similarity: best.similarity, matchedRecordId: best.recordId },
        input.limit,
      )
    }
    return matches.toSorted(compareBestFirst)
  }

  get size() {
    return this.#records.size
  }
}

export function encodeFloat32Vector(vector: Float32Array) {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)
}

export function decodeFloat32Vector(value: Uint8Array, dimensions: number) {
  if (value.byteLength !== dimensions * Float32Array.BYTES_PER_ELEMENT) {
    throw new Error('Stored semantic vector has an invalid byte length.')
  }
  if (value.byteOffset % Float32Array.BYTES_PER_ELEMENT === 0) {
    return new Float32Array(value.buffer, value.byteOffset, dimensions)
  }
  const aligned = Uint8Array.from(value)
  return new Float32Array(aligned.buffer)
}
