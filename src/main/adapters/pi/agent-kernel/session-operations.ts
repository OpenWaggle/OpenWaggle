import { randomUUID } from 'node:crypto'
import type { ContextUsage } from '@mariozechner/pi-coding-agent'
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

export async function getPiContextUsage(input: AgentKernelSessionInput) {
  return withPiSession(input, (session) => toContextUsageSnapshot(session.getContextUsage()))
}

export async function getPiSessionSnapshot(input: AgentKernelSessionInput) {
  return withPiSession(input, (session) => ({
    piSessionId: session.sessionId,
    piSessionFile: session.sessionFile,
    sessionSnapshot: projectPiSessionSnapshot(session),
  }))
}
export async function compactPiSession(input: CompactAgentKernelSessionInput) {
  return withPiSession(input, async (session) => {
    const unsubscribe = input.onEvent
      ? session.subscribe(
          createSessionListener(
            {
              model: input.model,
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

export async function navigatePiSessionTree(input: NavigateAgentKernelSessionInput) {
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

export async function forkPiSession(input: ForkAgentKernelSessionInput) {
  const runtime = await createPiSessionRuntime(input)
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

    return {
      cancelled: false,
      piSessionId: runtime.session.sessionId,
      piSessionFile: runtime.session.sessionFile,
      sessionSnapshot: projectPiSessionSnapshot(runtime.session),
      ...(result.selectedText ? { editorText: result.selectedText } : {}),
    }
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
}
