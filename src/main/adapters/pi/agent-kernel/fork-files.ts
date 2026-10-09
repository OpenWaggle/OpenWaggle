import path from 'node:path'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import * as Effect from 'effect/Effect'
import type { ForkAgentKernelSessionInput } from '../../../ports/agent-kernel-service'
import { writeRekeyedForkedSession } from './fork-entry-identity'
import type { PiEntryNodeIds } from './pi-entry-node-ids'
import { projectPiSessionSnapshot } from './session-projection'

/**
 * Projects the fork OpenWaggle wrote. Pi's fork keeps the copied entry ids, so the file was
 * written with ids of its own; `sourceEntryIdByNodeId` maps each back to the entry it copies.
 */
export function projectWrittenFork(
  sessionFile: string,
  sourceEntryIdByNodeId: ReadonlyMap<string, string>,
  cwd: string,
  sourceNodeIds: PiEntryNodeIds,
) {
  const sourceNodeIdByNodeId = new Map(
    [...sourceEntryIdByNodeId].map(
      ([nodeId, sourceEntryId]) => [nodeId, sourceNodeIds.toNodeId(sourceEntryId)] as const,
    ),
  )
  // The fork is a new file OpenWaggle wrote, so its own nodes use its entry ids unchanged.
  const sessionManager = SessionManager.open(sessionFile, undefined, cwd)
  return {
    piSessionId: sessionManager.getSessionId(),
    piSessionFile: sessionFile,
    sessionSnapshot: projectPiSessionSnapshot({ sessionManager }),
    sourceNodeIdByNodeId,
  }
}

export interface WrittenFork {
  readonly sessionFile: string
  readonly sourceEntryIdByNodeId: ReadonlyMap<string, string>
}

/**
 * The fork Pi branched in a copy of `sourceFile`, as the file OpenWaggle writes: next to the
 * source, named and headed as Pi names and heads a fork it writes itself. The path comes from the
 * fork's header; the copy still names the source, which must never be written.
 */
function forkFileFor(sessionManager: SessionManager, sourceFile: string) {
  const header = sessionManager.getHeader()
  if (!header) throw new Error('Pi did not create the forked session.')
  return {
    sessionFile: path.join(
      path.dirname(sourceFile),
      `${header.timestamp.replace(/[:.]/g, '-')}_${header.id}.jsonl`,
    ),
    lines: [{ ...header, parentSession: sourceFile }, ...sessionManager.getEntries()],
  }
}

/**
 * Writes the fork before its session starts, then points the copy at it: the fork's extensions
 * see its own file and id, and `previousSessionFile` names the source. The file is recorded first
 * (`beforeWritingFork`), so a stop between the two never leaves an unknown file.
 */
export async function writeForkBeforeItStarts(
  sessionManager: SessionManager,
  sourceFile: string,
  beforeWritingFork: ForkAgentKernelSessionInput['beforeWritingFork'],
): Promise<WrittenFork> {
  const fork = forkFileFor(sessionManager, sourceFile)
  if (beforeWritingFork) await Effect.runPromise(beforeWritingFork(fork.sessionFile))
  const sourceEntryIdByNodeId = await writeRekeyedForkedSession(fork.sessionFile, fork.lines)
  // The copy does not persist, so Pi only reads the file it is pointed at.
  sessionManager.setSessionFile(fork.sessionFile)
  return { sessionFile: fork.sessionFile, sourceEntryIdByNodeId }
}

/** A fork Pi wrote itself, from a Session whose copy had no file to load: given ids of its own. */
export async function rekeyPiWrittenFork(
  session: { readonly sessionFile: string | undefined; readonly sessionManager: SessionManager },
  beforeWritingFork: ForkAgentKernelSessionInput['beforeWritingFork'],
): Promise<WrittenFork> {
  const sessionFile = session.sessionFile
  const header = session.sessionManager.getHeader()
  if (!sessionFile || !header) throw new Error('Pi did not create the forked session.')
  if (beforeWritingFork) await Effect.runPromise(beforeWritingFork(sessionFile))
  const lines = [header, ...session.sessionManager.getEntries()]
  return { sessionFile, sourceEntryIdByNodeId: await writeRekeyedForkedSession(sessionFile, lines) }
}
