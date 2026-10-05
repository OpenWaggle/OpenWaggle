import type { MessagePart } from '@shared/types/agent'
import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import type { SessionDetail } from '@shared/types/session'
import type { AgentTransportEvent } from '@shared/types/stream'
import {
  entryKey,
  MODEL,
  persistedMessages,
  SESSION_ID,
  type TruthEntry,
  textDigest,
} from './transcript-order.persisted'
import { emptyBuffer, projectEvent } from './transcript-order.stream-buffer'

/*
 * The Host side of the transcript-order harness: the Pi log of one Session (the truth), the
 * transport events the Host publishes for it (Host clock timestamps), the Session detail it answers
 * (a Run is persisted when it ends, before it settles; every node with its log order, tool results
 * as messages of their own) and the reconnect stream buffer, cleared only when the Run settles.
 */

/** Host clock: one fake epoch shared with the renderer's, which runs `lag` behind it. */
const EPOCH = Date.UTC(2026, 9, 4, 18, 41)

function textPart(text: string): MessagePart {
  return { type: 'text', text }
}

/** An answer's text as the model streams it: word by word. */
function deltasOf(text: string) {
  return text.split(/(?= )/)
}

interface AnswerOptions {
  readonly tools?: number
  readonly open?: boolean
  /** Called before each text delta: the harness can stall the stream mid-answer. */
  readonly beforeDelta?: (index: number, count: number) => void
}

export type HostModel = ReturnType<typeof createHostModel>

/** The Host of one Session; `publish` delivers each event it publishes to the renderer. */
export function createHostModel(publish: (event: AgentTransportEvent) => void) {
  const truth: TruthEntry[] = []
  const persistedRunIds = new Set<string>()
  let nextOrder = 3
  let clock = EPOCH
  let revision = 1
  let buffer: BackgroundRunSnapshot | null = null
  let activeRunId: string | null = null

  function tick() {
    clock += 1
    return clock
  }

  function emit(event: AgentTransportEvent) {
    if (buffer) buffer = projectEvent(buffer, event)
    publish(event)
  }

  function requireRun() {
    if (!activeRunId) throw new Error('No Run is active')
    return activeRunId
  }

  function append(entry: Omit<TruthEntry, 'order' | 'runId' | 'timestamp'>, size = 1) {
    const appended: TruthEntry = {
      ...entry,
      order: nextOrder,
      runId: requireRun(),
      timestamp: tick(),
    }
    nextOrder += size
    truth.push(appended)
    return appended
  }

  function runTools(entry: TruthEntry) {
    for (const toolCallId of entry.toolCallIds) {
      const parentMessageId = entry.liveId
      const args = { command: toolCallId }
      emit({
        type: 'tool_execution_start',
        toolCallId,
        toolName: 'bash',
        args,
        parentMessageId,
        timestamp: tick(),
      })
      emit({
        type: 'tool_execution_end',
        toolCallId,
        toolName: 'bash',
        result: 'ok',
        isError: false,
        timestamp: tick(),
      })
    }
  }

  function appendSummary(runId: string) {
    const index = String(truth.length)
    const order = nextOrder
    nextOrder += 1
    truth.push({
      role: 'assistant',
      text: `Compaction summary\n\nsummary ${index}`,
      liveId: `live-summary-${index}`,
      piId: `pi-summary-${index}`,
      order,
      runId,
      timestamp: tick(),
      toolCallIds: [],
      compactionSummary: true,
    })
  }

  function compactionEnd(reason: 'threshold' | 'manual') {
    const result = { tokensBefore: 100 }
    emit({
      type: 'compaction_end',
      reason,
      result,
      aborted: false,
      willRetry: false,
      timestamp: tick(),
    })
  }

  return {
    truthKeys: () => truth.map(entryKey),
    /** The truth entry a transport message id streams. */
    entryForLiveId: (messageId: string) => truth.find((entry) => entry.liveId === messageId),
    isPersisted: (entry: TruthEntry) => persistedRunIds.has(entry.runId),
    entries: () => [...truth],
    hasUserMessage: (text: string) =>
      truth.some((entry) => entry.role === 'user' && entry.text === text),
    userOrder: (text: string) =>
      truth.find((entry) => entry.role === 'user' && entry.text === text)?.order,
    nextOrder: () => nextOrder,
    now: () => clock,
    activeRunId: () => activeRunId,
    buffer: () => (buffer ? structuredClone(buffer) : null),
    /** The detail's `updatedAt` moves only when the Session changes (a Run persisted, `touch`). */
    detail(): SessionDetail {
      return {
        id: SESSION_ID,
        title: 'Order',
        projectPath: '/tmp/project',
        createdAt: 1,
        updatedAt: revision,
        messages: truth
          .filter((entry) => persistedRunIds.has(entry.runId))
          .flatMap(persistedMessages),
      }
    },
    /** The Session changes without a new message: its title, its queue. */
    touch() {
      revision += 1
    },
    startRun(runId: string) {
      activeRunId = runId
      buffer = emptyBuffer(runId, clock)
      emit({ type: 'agent_start', runId, model: String(MODEL), timestamp: tick() })
    },
    /** The attempt fails and Pi retries it: the same Run starts again, keeping its buffer. */
    retry() {
      const runId = requireRun()
      emit({ type: 'agent_end', runId, reason: 'error', willRetry: true, timestamp: tick() })
      emit({
        type: 'auto_retry_start',
        attempt: 1,
        maxAttempts: 3,
        delayMs: 1,
        errorMessage: 'overloaded',
        timestamp: tick(),
      })
      emit({ type: 'auto_retry_end', success: true, attempt: 1, timestamp: tick() })
      emit({ type: 'agent_start', runId, model: String(MODEL), timestamp: tick() })
    },
    /** Pi incorporates a user message (a prompt, a steer, a promoted Follow-up). */
    incorporateUser(text: string) {
      // The `openwaggle-user-input` projection precedes the user node.
      nextOrder += 1
      const index = String(truth.length)
      const entry = append({
        role: 'user',
        text,
        liveId: `live-user-${index}`,
        piId: `pi-user-${index}`,
        toolCallIds: [],
      })
      const userMessage = {
        parts: [textPart(text)],
        sessionNodeCreatedOrder: entry.order,
        durableTextSha256: textDigest(text),
      }
      emit({
        type: 'message_start',
        messageId: entry.liveId,
        role: 'user',
        userMessage,
        timestamp: entry.timestamp,
      })
      emit({ type: 'message_end', messageId: entry.liveId, role: 'user', timestamp: tick() })
    },
    /** One assistant turn: its text word by word, then the tools it ran; `open` keeps it streaming. */
    answer(text: string, options: AnswerOptions = {}) {
      const index = String(truth.length)
      const toolCallIds = Array.from(
        { length: options.tools ?? 0 },
        (_, tool) => `tool-${index}-${String(tool)}`,
      )
      const entry = append(
        {
          role: 'assistant',
          text,
          liveId: `live-assistant-${index}`,
          piId: `pi-assistant-${index}`,
          toolCallIds,
        },
        1 + toolCallIds.length,
      )
      const messageId = entry.liveId
      emit({ type: 'turn_start', turnIndex: truth.length, timestamp: entry.timestamp })
      emit({ type: 'message_start', messageId, role: 'assistant', timestamp: entry.timestamp })
      const deltas = deltasOf(text)
      for (const [deltaIndex, delta] of deltas.entries()) {
        options.beforeDelta?.(deltaIndex, deltas.length)
        const assistantMessageEvent = { type: 'text_delta' as const, contentIndex: 0, delta }
        emit({
          type: 'message_update',
          messageId,
          role: 'assistant',
          assistantMessageEvent,
          timestamp: tick(),
        })
      }
      if (options.open) return
      emit({ type: 'message_end', messageId, role: 'assistant', timestamp: tick() })
      runTools(entry)
      emit({ type: 'turn_end', turnIndex: truth.length, timestamp: tick() })
    },
    /** An automatic compaction between turns: Pi appends its summary entry to the log. */
    compact() {
      emit({ type: 'compaction_start', reason: 'threshold', timestamp: tick() })
      appendSummary(requireRun())
      compactionEnd('threshold')
    },
    /** A manual compaction of an idle Session starts; the returned call ends it, persisted. */
    compactManually() {
      const runId = `manual-compaction-${String(truth.length)}`
      emit({ type: 'compaction_start', reason: 'manual', timestamp: tick() })
      return () => {
        appendSummary(runId)
        persistedRunIds.add(runId)
        revision += 1
        compactionEnd('manual')
      }
    },
    /** The Run ends (Stop: `aborted`) and is persisted; its buffer stays until it settles. */
    finishRun(reason: 'stop' | 'aborted' = 'stop') {
      const runId = requireRun()
      emit({ type: 'agent_end', runId, reason, timestamp: tick() })
      persistedRunIds.add(runId)
      revision += 1
      activeRunId = null
      return runId
    },
    /** The finished Run settles: its buffer is cleared. */
    settleRun() {
      if (!activeRunId) buffer = null
    },
    /** The Host restarts: its Run is lost, and the Pi file written so far is projected. */
    restart() {
      if (activeRunId) persistedRunIds.add(activeRunId)
      revision += 1
      activeRunId = null
      buffer = null
    },
  }
}
