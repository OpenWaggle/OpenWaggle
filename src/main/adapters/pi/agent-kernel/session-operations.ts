import { randomUUID } from 'node:crypto'
import type { AgentSession, ContextUsage, SessionManager } from '@earendil-works/pi-coding-agent'
import type { ContextUsageSnapshot, SessionUsageSummary } from '@shared/types/context-usage'
import {
  AgentKernelMissingEntryError,
  type AgentKernelSessionInput,
  type CompactAgentKernelSessionInput,
  type ForkAgentKernelSessionInput,
  type NavigateAgentKernelSessionInput,
} from '../../../ports/agent-kernel-service'
import {
  disposeOpenWagglePiSession,
  withOpenWagglePiSessionLifecycleContext,
} from '../pi-session-lifecycle'
import { projectWrittenFork, type WrittenFork, writeForkBeforeItStarts } from './fork-files'
import { hasProjectedEntries, missingPiSessionFileError } from './missing-session-file'
import { piEntryNodeIds } from './pi-entry-node-ids'
import { piExtensionCommands } from './pi-extension-commands'
import { idleCacheWarming } from './pi-idle-cache-warming'
import { piResponseUsageInput } from './pi-response-usage'
import { summarizePiSessionUsage } from './pi-session-usage'
import { withRunExtensionCommands } from './run-extension-commands'
import type { PiRuntimeExtensionIsolationInput } from './runtime-extension-isolation'
import { createSessionListener } from './session-listener'
import {
  createReadOnlySessionManagerForSession,
  resolveSessionWorkingPath,
} from './session-manager'
import { projectPiSessionSnapshot } from './session-projection'
import { createPiSessionRuntime, withPiSession, withReadOnlyPiSession } from './session-runtime'

function toContextUsageSnapshot(
  usage: ContextUsage | undefined,
  session: SessionUsageSummary,
): ContextUsageSnapshot | null {
  if (!usage) {
    return null
  }

  return {
    tokens: usage.tokens,
    contextWindow: usage.contextWindow,
    percent: usage.percent,
    ...(session.models.length > 0 ? { session } : {}),
  }
}

/**
 * Reads use the Session's warming session while it has one. Otherwise they read an in-memory
 * copy of the Pi file, so looking at a Session never writes its file (ADR 0051).
 */
async function readPiSession<T>(
  input: AgentKernelSessionInput & PiRuntimeExtensionIsolationInput,
  read: (session: AgentSession) => T,
) {
  const warming = idleCacheWarming.borrow(input.session.id)
  if (warming && warming.sessionFile === input.session.piSessionFile) return read(warming)
  return withReadOnlyPiSession(input, read)
}

export async function getPiContextUsage(
  input: AgentKernelSessionInput & PiRuntimeExtensionIsolationInput,
) {
  return readPiSession(input, (session) =>
    toContextUsageSnapshot(session.getContextUsage(), summarizePiSessionUsage(session)),
  )
}

/** The commands the Session's Pi extensions register, which the slash menu lists. */
export async function getPiExtensionCommands(
  input: AgentKernelSessionInput & PiRuntimeExtensionIsolationInput,
) {
  return withRunExtensionCommands(input.session.id, await readPiSession(input, piExtensionCommands))
}

/**
 * Projects the Session's Pi file as it is. It reads the warming session while there is one;
 * otherwise only a session manager over the file's entries, with no agent session: creating one
 * records a thinking level change when the branch has none, which the file does not hold.
 */
export async function getPiSessionSnapshot(
  input: AgentKernelSessionInput & PiRuntimeExtensionIsolationInput,
) {
  const nodeIds = piEntryNodeIds(input.session)
  const warming = idleCacheWarming.borrow(input.session.id)
  if (warming && warming.sessionFile === input.session.piSessionFile) {
    return {
      piSessionId: warming.sessionId,
      piSessionFile: warming.sessionFile,
      sessionSnapshot: projectPiSessionSnapshot(warming, nodeIds),
    }
  }
  const sessionManager = await createReadOnlySessionManagerForSession(
    input.session,
    resolveSessionWorkingPath(input.session),
  )
  // Without its file, the snapshot would be empty and replace the transcript the Session shows.
  if (!sessionManager.getSessionFile() && hasProjectedEntries(input.session)) {
    throw missingPiSessionFileError(input.session)
  }
  return {
    piSessionId: sessionManager.getSessionId(),
    // An in-memory manager has no file of its own; it read the Session's.
    piSessionFile: sessionManager.getSessionFile() ?? input.session.piSessionFile ?? undefined,
    sessionSnapshot: projectPiSessionSnapshot({ sessionManager }, nodeIds),
  }
}
export async function compactPiSession(
  input: CompactAgentKernelSessionInput & PiRuntimeExtensionIsolationInput,
) {
  return withPiSession(input, async (session) => {
    const unsubscribe = input.onEvent
      ? session.subscribe(
          createSessionListener(
            {
              model: input.model,
              sessionEntries: null,
              nodeIds: piEntryNodeIds(input.session),
              ...piResponseUsageInput(session),
              onEvent: input.onEvent,
            },
            randomUUID(),
          ),
        )
      : undefined

    const abortListener = () => {
      session.abortCompaction()
    }
    input.signal?.addEventListener('abort', abortListener, { once: true })
    if (input.signal?.aborted) {
      session.abortCompaction()
    }

    try {
      const result = await session.compact(input.customInstructions)
      return {
        summary: result.summary,
        firstKeptEntryId: piEntryNodeIds(input.session).toNodeId(result.firstKeptEntryId),
        tokensBefore: result.tokensBefore,
        piSessionId: session.sessionId,
        piSessionFile: session.sessionFile,
        sessionSnapshot: projectPiSessionSnapshot(session, piEntryNodeIds(input.session)),
      }
    } finally {
      input.signal?.removeEventListener('abort', abortListener)
      unsubscribe?.()
    }
  })
}

export async function navigatePiSessionTree(
  input: NavigateAgentKernelSessionInput & PiRuntimeExtensionIsolationInput,
) {
  const nodeIds = piEntryNodeIds(input.session)
  return withPiSession(input, async (session) => {
    const targetEntryId = nodeIds.toEntryId(input.targetNodeId)
    try {
      const result = await session.navigateTree(targetEntryId, {
        summarize: input.summarize ?? false,
        customInstructions: input.customInstructions,
      })
      return {
        piSessionId: session.sessionId,
        piSessionFile: session.sessionFile,
        sessionSnapshot: projectPiSessionSnapshot(session, nodeIds),
        editorText: result.editorText,
        cancelled: result.cancelled,
      }
    } catch (error) {
      if (error instanceof Error && error.message === `Entry ${targetEntryId} not found`) {
        throw new AgentKernelMissingEntryError(input.targetNodeId)
      }
      throw error
    }
  })
}

export async function forkPiSession(
  input: ForkAgentKernelSessionInput & PiRuntimeExtensionIsolationInput,
) {
  const sourceNodeIds = piEntryNodeIds(input.session)
  const targetEntryId = sourceNodeIds.toEntryId(input.targetNodeId)
  // The source is forked from a copy that does not persist: opening it as a Pi session would
  // record a thinking level in it and migrate an older format in place (ADR 0051). A warming
  // session ends first, so the copy holds everything it wrote.
  await idleCacheWarming.release(input.session.id)
  const copy = await createReadOnlySessionManagerForSession(
    input.session,
    resolveSessionWorkingPath(input.session),
  )
  // The file the copy loaded, found by Pi session id when the recorded path is missing or stale.
  // Without one there is nothing to fork from: the file was deleted or its folder is missing.
  const sourceFile = copy.getSessionFile()
  if (!sourceFile) throw missingPiSessionFileError(input.session)
  let written: WrittenFork | undefined
  const runtime = await createPiSessionRuntime(input, {
    sessionManager: copy,
    beforeForkStarts: async (sessionManager: SessionManager) => {
      const fork = await writeForkBeforeItStarts(
        sessionManager,
        sourceFile,
        input.beforeWritingFork,
      )
      written = fork
      return fork.sessionManager
    },
  })
  let editorText: string | undefined
  try {
    const result = await withOpenWagglePiSessionLifecycleContext(runtime.session, () =>
      runtime.fork(targetEntryId, { position: input.position }),
    )
    if (result.cancelled) {
      return {
        cancelled: true,
        piSessionId: runtime.session.sessionId,
        piSessionFile: sourceFile,
        sessionSnapshot: projectPiSessionSnapshot(runtime.session, sourceNodeIds),
      }
    }
    editorText = result.selectedText
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === 'Invalid entry ID for forking' ||
        error.message === `Entry ${targetEntryId} not found`)
    ) {
      throw new AgentKernelMissingEntryError(input.targetNodeId)
    }
    throw error
  } finally {
    await disposeOpenWagglePiSession(runtime.session)
  }

  if (!written) throw new Error('Pi did not create the forked session.')
  return {
    cancelled: false,
    ...projectWrittenFork(
      written.sessionFile,
      written.sourceEntryIdByNodeId,
      runtime.cwd,
      sourceNodeIds,
    ),
    ...(editorText ? { editorText } : {}),
  }
}
