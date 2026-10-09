import type { WorkerPoolOptions } from '@pierre/diffs/react'

/**
 * Highlighted ASTs kept by the shared Pierre worker. Sized for the diff panel, the
 * largest consumer; smaller surfaces simply use fewer entries.
 */
const PIERRE_AST_CACHE_ENTRIES = 64

function createPierreWorker() {
  return new Worker(new URL('@pierre/diffs/worker/worker.js', import.meta.url), { type: 'module' })
}

/**
 * Pool options for every Pierre surface (diff panel, focused editor, inline diffs).
 *
 * Pierre's `WorkerPoolContextProvider` does not create a pool per provider: it shares one
 * reference-counted module singleton, and the first provider to mount fixes its options.
 * Every surface must pass these same options, or mount order decides the cache size the
 * others get. Each surface still pushes its own theme with `setRenderOptions`.
 */
export const PIERRE_WORKER_POOL_OPTIONS: WorkerPoolOptions = {
  workerFactory: createPierreWorker,
  poolSize: 1,
  totalASTLRUCacheSize: PIERRE_AST_CACHE_ENTRIES,
}
