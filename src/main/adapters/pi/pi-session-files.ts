import { stat } from 'node:fs/promises'
import { type SessionEntry, SessionManager } from '@earendil-works/pi-coding-agent'
import { Effect, Layer } from 'effect'
import {
  type PiSessionFileFingerprint,
  type PiSessionFileRead,
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
 * The file holds the projected entries and, after them, at most usage entries: the cost records a
 * warming session appends for each prompt cache refresh. They change no transcript node a Session
 * shows, so projecting them would only move the Session in the sidebar.
 */
function holdsOnlyProjectedEntries(
  entries: readonly SessionEntry[],
  projectedPiEntryCount: number | undefined,
) {
  if (projectedPiEntryCount === undefined || entries.length < projectedPiEntryCount) return false
  return entries.slice(projectedPiEntryCount).every((entry) => entry.type === 'usage')
}

/**
 * Reads a Pi session file as Pi does, for a projection outside a Run. The fingerprint is taken
 * first: a write that lands while the file is read leaves it stale, so the next check reads again.
 */
async function readSnapshot(
  input: Parameters<PiSessionFilesShape['readSnapshot']>[0],
): Promise<PiSessionFileRead> {
  const file = input.piSessionFile
  const fingerprint = await fingerprintOf(file)
  if (!fingerprint) throw new Error(`Pi session file is missing: ${file}`)
  const sessionManager = SessionManager.open(file, undefined, input.cwd)
  const entries = sessionManager.getEntries()
  if (holdsOnlyProjectedEntries(entries, input.projectedPiEntryCount)) {
    return { kind: 'unchanged', fingerprint }
  }
  return {
    kind: 'changed',
    piSessionId: sessionManager.getSessionId(),
    piSessionFile: file,
    entryCount: entries.length,
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
