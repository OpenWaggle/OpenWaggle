import { randomUUID } from 'node:crypto'
import { type ContextUsage, SessionManager } from '@earendil-works/pi-coding-agent'
import type { ContextUsageSnapshot } from '@shared/types/context-usage'
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
import { writeRekeyedForkedSession } from './fork-entry-identity'
import type { PiRuntimeExtensionIsolationInput } from './runtime-extension-isolation'
import { createSessionListener } from './session-listener'
import { projectPiSessionSnapshot } from './session-projection'
import { createPiSessionRuntime, withPiSession } from './session-runtime'

function toContextUsageSnapshot(usage: ContextUsage | undefined): ContextUsageSnapshot | null {
  if (!usage) {
    return null
  }

  return {
    tokens: usage.tokens,
    contextWindow: usage.contextWindow,
    percent: usage.percent,
  }
}

export async function getPiContextUsage(
  input: AgentKernelSessionInput & PiRuntimeExtensionIsolationInput,
) {
  return withPiSession(input, (session) => toContextUsageSnapshot(session.getContextUsage()))
}

export async function getPiSessionSnapshot(
  input: AgentKernelSessionInput & PiRuntimeExtensionIsolationInput,
) {
  return withPiSession(input, (session) => ({
    piSessionId: session.sessionId,
    piSessionFile: session.sessionFile,
    sessionSnapshot: projectPiSessionSnapshot(session),
  }))
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
              getContextWindow: (provider, modelId) => {
                const activeModel = session.model
                return activeModel?.provider === provider && activeModel.id === modelId
                  ? activeModel.contextWindow
                  : undefined
              },
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
        firstKeptEntryId: result.firstKeptEntryId,
        tokensBefore: result.tokensBefore,
        piSessionId: session.sessionId,
        piSessionFile: session.sessionFile,
        sessionSnapshot: projectPiSessionSnapshot(session),
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
  return withPiSession(input, async (session) => {
    try {
      const result = await session.navigateTree(input.targetNodeId, {
        summarize: input.summarize ?? false,
        customInstructions: input.customInstructions,
      })
      return {
        piSessionId: session.sessionId,
        piSessionFile: session.sessionFile,
        sessionSnapshot: projectPiSessionSnapshot(session),
        editorText: result.editorText,
        cancelled: result.cancelled,
      }
    } catch (error) {
      if (error instanceof Error && error.message === `Entry ${input.targetNodeId} not found`) {
        throw new AgentKernelMissingEntryError(input.targetNodeId)
      }
      throw error
    }
  })
}

/**
 * Pi's fork keeps the copied entry ids, so the fork is written again with ids of its own before it
 * is projected, after the runtime that created it is disposed.
 */
async function projectForkedSession(fork: ForkedPiSession, cwd: string) {
  const sourceNodeIdByNodeId = await writeRekeyedForkedSession(fork.sessionFile, fork.lines)
  const sessionManager = SessionManager.open(fork.sessionFile, undefined, cwd)
  return {
    piSessionId: sessionManager.getSessionId(),
    piSessionFile: fork.sessionFile,
    sessionSnapshot: projectPiSessionSnapshot({ sessionManager }),
    sourceNodeIdByNodeId,
  }
}

interface ForkedPiSession {
  readonly sessionFile: string
  readonly lines: readonly unknown[]
  readonly editorText?: string
}

function forkedPiSession(
  session: { readonly sessionFile: string | undefined; readonly sessionManager: SessionManager },
  selectedText: string | undefined,
): ForkedPiSession {
  const header = session.sessionManager.getHeader()
  if (!session.sessionFile || !header) throw new Error('Pi did not create the forked session.')
  return {
    sessionFile: session.sessionFile,
    lines: [header, ...session.sessionManager.getEntries()],
    ...(selectedText ? { editorText: selectedText } : {}),
  }
}

export async function forkPiSession(
  input: ForkAgentKernelSessionInput & PiRuntimeExtensionIsolationInput,
) {
  const runtime = await createPiSessionRuntime(input)
  let forked: ForkedPiSession | undefined
  try {
    const result = await withOpenWagglePiSessionLifecycleContext(runtime.session, () =>
      runtime.fork(input.targetNodeId, { position: input.position }),
    )
    if (result.cancelled) {
      return {
        cancelled: true,
        piSessionId: runtime.session.sessionId,
        piSessionFile: runtime.session.sessionFile,
        sessionSnapshot: projectPiSessionSnapshot(runtime.session),
      }
    }
    forked = forkedPiSession(runtime.session, result.selectedText)
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === 'Invalid entry ID for forking' ||
        error.message === `Entry ${input.targetNodeId} not found`)
    ) {
      throw new AgentKernelMissingEntryError(input.targetNodeId)
    }
    throw error
  } finally {
    await disposeOpenWagglePiSession(runtime.session)
  }

  return {
    cancelled: false,
    ...(await projectForkedSession(forked, runtime.cwd)),
    ...(forked.editorText ? { editorText: forked.editorText } : {}),
  }
}
