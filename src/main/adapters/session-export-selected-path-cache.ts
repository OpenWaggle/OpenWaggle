export const SESSION_EXPORT_SELECTED_PATH_CACHE_PATH_LIMIT = 64

export interface ExportSelectedPathSnapshotIdentity {
  readonly sessionId: string
  readonly selectedBranchId: string
  readonly selectedHeadNodeId: string
  readonly nodeMutationRevision: number
}

interface SelectedPathCacheOptions {
  readonly pathLimit?: number
}

function identityKey(identity: ExportSelectedPathSnapshotIdentity) {
  return JSON.stringify([
    identity.sessionId,
    identity.selectedBranchId,
    identity.selectedHeadNodeId,
    identity.nodeMutationRevision,
  ])
}

export class SessionExportSelectedPathCache {
  readonly #paths = new Map<string, true>()
  readonly #pathLimit: number

  constructor(options: SelectedPathCacheOptions = {}) {
    this.#pathLimit = options.pathLimit ?? SESSION_EXPORT_SELECTED_PATH_CACHE_PATH_LIMIT
    if (!Number.isSafeInteger(this.#pathLimit) || this.#pathLimit < 1) {
      throw new Error('Export selected-path cache path limit must be a positive safe integer.')
    }
  }

  has(identity: ExportSelectedPathSnapshotIdentity) {
    return this.#touch(identityKey(identity)) !== undefined
  }

  remember(identity: ExportSelectedPathSnapshotIdentity) {
    const key = identityKey(identity)
    this.#paths.delete(key)
    while (this.#paths.size >= this.#pathLimit) {
      const oldestKey = this.#paths.keys().next().value
      if (oldestKey === undefined) break
      this.#paths.delete(oldestKey)
    }
    this.#paths.set(key, true)
  }

  diagnostics() {
    return { paths: this.#paths.size }
  }

  #touch(key: string) {
    if (!this.#paths.has(key)) return undefined
    this.#paths.delete(key)
    this.#paths.set(key, true)
    return true
  }
}
