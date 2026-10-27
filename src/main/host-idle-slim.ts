import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'
import { defaultSessionEmbeddingModel } from './adapters/multilingual-e5-session-embedding-model'
import { hostBackgroundGate } from './application/host-background-gate'
import { createLogger } from './logger'
import { hostMcpConnectionPool } from './mcp-runtime-layers'

const logger = createLogger('host-idle-slim')
const BYTES_PER_MB = 1024 * 1024

function isGarbageCollector(value: unknown): value is () => void {
  return typeof value === 'function'
}

/** A full V8 collection, so the heap the Host no longer uses is returned. */
export function collectHostGarbage() {
  try {
    setFlagsFromString('--expose-gc')
    const gc: unknown = runInNewContext('gc')
    if (isGarbageCollector(gc)) gc()
  } catch {
    // Without `gc`, V8 trims on its own schedule.
  }
}

/**
 * Decision 4: a Session Host with no client attached keeps its idle grace (300 s by default) but
 * slims down at once: idle Sessions' MCP servers close (Sessions with a running Run keep theirs),
 * the embedding model process ends, background discovery and indexing pause (the gate is closed),
 * and V8 collects. A client that attaches again finds everything starting on demand.
 */
export function installHostIdleSlim() {
  hostBackgroundGate.enable()
  return hostBackgroundGate.onSlim(async () => {
    await hostMcpConnectionPool.closeIdleSessions()
    defaultSessionEmbeddingModel.dispose()
    collectHostGarbage()
    logger.info('Session Host slimmed down without clients', {
      rssMb: Math.round(process.memoryUsage().rss / BYTES_PER_MB),
    })
  })
}
