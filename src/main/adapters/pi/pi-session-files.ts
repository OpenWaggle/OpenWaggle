import { stat } from 'node:fs/promises'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { Effect, Layer } from 'effect'
import {
  type PiSessionFileFingerprint,
  PiSessionFiles,
  type PiSessionFilesShape,
} from '../../ports/pi-session-discovery'
import { piEntryNodeIdsWithPrefix } from './agent-kernel/pi-entry-node-ids'
import { projectPiSessionSnapshot } from './agent-kernel/session-projection'
import { createPiSessionDiscoveryScanner } from './pi-session-discovery'

function toError(cause: unknown) {
  return cause instanceof Error ? cause : new Error(String(cause))
}

async function fingerprintOf(file: string): Promise<PiSessionFileFingerprint | null> {
  try {
    const stats = await stat(file)
    return { size: stats.size, mtimeMs: stats.mtimeMs }
  } catch {
    // Pi writes a session file only once it has something to keep.
    return null
  }
}

/**
 * Reads a Pi session file as Pi does, for a projection outside a Run. The fingerprint is taken
 * first: a write that lands while the file is read leaves it stale, so the next check reads again.
 */
async function readSnapshot(input: Parameters<PiSessionFilesShape['readSnapshot']>[0]) {
  const file = input.piSessionFile
  const fingerprint = await fingerprintOf(file)
  if (!fingerprint) throw new Error(`Pi session file is missing: ${file}`)
  const sessionManager = SessionManager.open(file, undefined, input.cwd)
  return {
    piSessionId: sessionManager.getSessionId(),
    piSessionFile: file,
    entryCount: sessionManager.getEntries().length,
    fingerprint,
    sessionSnapshot: projectPiSessionSnapshot(
      { sessionManager },
      piEntryNodeIdsWithPrefix(input.piEntryNodeIdPrefix),
    ),
  }
}

export function createPiSessionFiles(options: { readonly sessionsRoot?: string } = {}) {
  const scanner = createPiSessionDiscoveryScanner(options)
  return {
    discover: (input) => Effect.tryPromise({ try: () => scanner.scan(input), catch: toError }),
    fingerprint: (file) => Effect.promise(() => fingerprintOf(file)),
    readSnapshot: (input) => Effect.tryPromise({ try: () => readSnapshot(input), catch: toError }),
  } satisfies PiSessionFilesShape
}

export const PiSessionFilesLive = Layer.sync(PiSessionFiles, () => createPiSessionFiles())
