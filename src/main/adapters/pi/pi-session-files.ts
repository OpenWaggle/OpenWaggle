import { readFile, stat } from 'node:fs/promises'
import {
  parseSessionEntries,
  type SessionEntry,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
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
import { isPiVirtualModel } from './pi-virtual-models'

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
 * shows, so projecting them would only move the Session in the sidebar. The projected entries are
 * matched by id, not only counted: `pi --resume` upgrading an older file rewrites the same number
 * of entries under new ids.
 */
function holdsOnlyProjectedEntries(
  entries: readonly SessionEntry[],
  input: Parameters<PiSessionFilesShape['readSnapshot']>[0],
) {
  const count = input.projectedPiEntryCount
  if (count === undefined || !input.projectedNodeIds || entries.length < count) return false
  const nodeIds = piEntryNodeIdsWithPrefix(input.piEntryNodeIdPrefix)
  const projected = input.projectedNodeIds
  return (
    entries.slice(0, count).every((entry) => projected.has(nodeIds.toNodeId(entry.id))) &&
    entries.slice(count).every((entry) => entry.type === 'usage')
  )
}

function modelReference(entry: { readonly provider: string; readonly modelId: string }) {
  return `${entry.provider}/${entry.modelId}`
}

function lastModelChangeBefore(branch: readonly SessionEntry[], index: number) {
  for (let candidate = index - 1; candidate >= 0; candidate--) {
    const entry = branch[candidate]
    if (entry?.type === 'model_change') return modelReference(entry)
  }
  return undefined
}

/**
 * The model selection the branch records, as Pi's `getBranchSelection` reads it for
 * `pi --resume`: a model change holds until the next response, whose physical model then wins,
 * unless the change named a virtual model, which only the catalog can tell.
 */
function branchModelSelection(branch: readonly SessionEntry[]) {
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index]
    if (entry?.type === 'model_change') return { lastModel: modelReference(entry) }
    if (entry?.type !== 'message' || entry.message.role !== 'assistant') continue
    if (isPiVirtualModel(entry.message)) continue
    const response = modelReference({
      provider: entry.message.provider,
      modelId: entry.message.model,
    })
    const change = lastModelChangeBefore(branch, index)
    return { lastModel: response, ...(change ? { lastModelChange: change } : {}) }
  }
  return {}
}

/** The branch's last thinking level change, which `pi --resume` continues with. */
function branchThinkingLevel(branch: readonly SessionEntry[]) {
  const change = branch.findLast((entry) => entry.type === 'thinking_level_change')
  return change?.type === 'thinking_level_change' ? { lastThinkingLevel: change.thinkingLevel } : {}
}

/**
 * Reads a Pi session file for viewing, without changing it. `SessionManager.open` upgrades a file
 * in an older Pi format by rewriting it; the file is parsed and loaded into an in-memory manager
 * instead, so only a Run, which continues the session as `pi --resume` would, writes to it.
 * The fingerprint is taken first: a write that lands while the file is read leaves it stale, so
 * the next check reads again. Reading is asynchronous; only the parse runs on the event loop.
 */
async function readSnapshot(
  input: Parameters<PiSessionFilesShape['readSnapshot']>[0],
): Promise<PiSessionFileRead> {
  const file = input.piSessionFile
  const fingerprint = await fingerprintOf(file)
  if (!fingerprint) throw new Error(`Pi session file is missing: ${file}`)
  const fileEntries = parseSessionEntries(await readFile(file, 'utf8'))
  if (!fileEntries.some((entry) => entry.type === 'session')) {
    throw new Error(`Pi session file has no session header: ${file}`)
  }
  const sessionManager = SessionManager.inMemory(input.cwd, undefined, fileEntries)
  const entries = sessionManager.getEntries()
  if (holdsOnlyProjectedEntries(entries, input)) {
    return { kind: 'unchanged', fingerprint }
  }
  const branch = sessionManager.getBranch()
  const name = sessionManager.getSessionName()?.trim()
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
    ...branchModelSelection(branch),
    ...branchThinkingLevel(branch),
    ...(name ? { name } : {}),
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
