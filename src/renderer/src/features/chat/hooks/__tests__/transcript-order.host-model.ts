import type { MessagePart } from '@shared/types/agent'
import type { BackgroundRunSnapshot } from '@shared/types/background-run'
import type { SessionDetail } from '@shared/types/session'
import type { AgentTransportEvent } from '@shared/types/stream'
import {
  type AnswerShape,
  answerContent,
  answerEvents,
  streamAnswer,
} from './transcript-order.answers'
import type { RunEndTail } from './transcript-order.harness-support'
import { HISTORY_RUN_ID, historyEntries, summaryEntry } from './transcript-order.history'
import {
  entryKey,
  MODEL,
  persistedMessages,
  SESSION_ID,
  type TruthEntry,
  textDigest,
  toolEventsOf,
} from './transcript-order.persisted'
import {
  projectEvent,
  type Retention,
  startedBuffer,
  withRetention,
} from './transcript-order.stream-buffer'

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

export interface AnswerOptions {
  readonly tools?: number
  /** Reasoning before each of its text segments: the `reasoning` shape. */
  readonly reasoning?: boolean
  readonly shape?: AnswerShape
  readonly open?: boolean
  /** Called before each text delta: the harness can stall the stream mid-answer. */
  readonly beforeDelta?: (index: number, count: number) => void
  /** Its last events stream only when the returned call does (after a resync). */
  readonly holdLast?: number
}

export type HostModel = ReturnType<typeof createHostModel>

/** The Host of one Session; `publish` delivers each event it publishes to the renderer. */
export function createHostModel(publish: (event: AgentTransportEvent) => void) {
  const truth: TruthEntry[] = []
  const persistedRunIds = new Set<string>()
  let nextOrder = 3
  let clock = EPOCH
  let retention: Retention = 'all'
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
    for (const event of toolEventsOf(entry, tick)) emit(event)
  }

  function appendSummary(runId: string) {
    truth.push(summaryEntry(truth.length, { order: nextOrder, runId, timestamp: tick() }))
    nextOrder += 1
  }

  /** An attempt fails and Pi waits to retry it. */
  function retryStarts(runId: string) {
    emit({ type: 'agent_end', runId, reason: 'error', willRetry: true, timestamp: tick() })
    const retryStart = { attempt: 1, maxAttempts: 3, delayMs: 1, errorMessage: 'overloaded' }
    emit({ type: 'auto_retry_start', ...retryStart, timestamp: tick() })
  }
  /** An automatic compaction: Pi appends its summary entry to the log. */
  function compaction(runId: string, reason: 'threshold' | 'overflow') {
    emit({ type: 'compaction_start', reason, timestamp: tick() })
    appendSummary(runId)
    compactionEnd(reason)
  }
  function compactionEnd(reason: 'threshold' | 'manual' | 'overflow') {
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
    isPersisted: (entry: TruthEntry) => persistedRunIds.has(entry.runId),
    entries: () => [...truth],
    /** The log orders of the user messages with `text`, in log order. */
    userOrders: (text: string) =>
      truth.flatMap((entry) => (entry.role === 'user' && entry.text === text ? [entry.order] : [])),
    nextOrder: () => nextOrder,
    now: () => clock,
    /**
     * The renderer acted at `time` on the one wall clock (a send): what the Host does in response
     * is stamped after it, though events it publishes in a burst are stamped before they arrive.
     */
    rendererActedAt(time: number) {
      clock = Math.max(clock, time)
    },
    activeRunId: () => activeRunId,
    buffer: () => (buffer ? withRetention(structuredClone(buffer), retention) : null),
    /**
     * The Run's buffer stops retaining user messages and finished answers: they are over its size
     * cap.
     */
    dropRetainedUsers() {
      retention = 'none'
    },
    /** The Run's buffer keeps no finished answers: its history budget left them out. */
    dropHistory() {
      if (retention === 'all') retention = 'noHistory'
    },
    retainsUsers: () => retention !== 'none',
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
      buffer = startedBuffer(buffer, runId, clock)
      retention = 'all'
      emit({ type: 'agent_start', runId, model: String(MODEL), timestamp: tick() })
    },
    /** The attempt fails and Pi retries it: the same Run starts again, keeping its buffer. */
    retry() {
      const runId = requireRun()
      retryStarts(runId)
      emit({ type: 'auto_retry_end', success: true, attempt: 1, timestamp: tick() })
      emit({ type: 'agent_start', runId, model: String(MODEL), timestamp: tick() })
    },
    /**
     * Pi continues the Run's prompt after its end (an overflow compaction's recovery, a steer queued
     * as the loop finished): `agent_end` with no retry, `agent_start` under the same id, no settling.
     */
    continueRun(compact: boolean) {
      const runId = requireRun()
      emit({ type: 'agent_end', runId, reason: 'stop', timestamp: tick() })
      if (compact) compaction(runId, 'overflow')
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
      const content = answerContent(text, index, options)
      const entry = append(
        {
          role: 'assistant',
          liveId: `live-assistant-${index}`,
          piId: `pi-assistant-${index}`,
          ...content,
        },
        1 + content.toolCallIds.length,
      )
      const messageId = entry.liveId
      emit({ type: 'turn_start', turnIndex: truth.length, timestamp: entry.timestamp })
      emit({ type: 'message_start', messageId, role: 'assistant', timestamp: entry.timestamp })
      return streamAnswer(answerEvents(content.segments), {
        ...options,
        update: (assistantMessageEvent) =>
          emit({
            type: 'message_update',
            messageId,
            role: 'assistant',
            assistantMessageEvent,
            timestamp: tick(),
          }),
        end: () => {
          emit({ type: 'message_end', messageId, role: 'assistant', timestamp: tick() })
          runTools(entry)
          emit({ type: 'turn_end', turnIndex: truth.length, timestamp: tick() })
        },
      })
    },
    /** History from before the test, saved and compacted: texts later Runs repeat, then a marker. */
    seedHistory() {
      activeRunId = HISTORY_RUN_ID
      for (const entry of historyEntries()) append(entry)
      appendSummary(HISTORY_RUN_ID)
      activeRunId = null
      persistedRunIds.add(HISTORY_RUN_ID)
      revision += 1
    },
    /** An automatic compaction between turns: Pi appends its summary entry to the log. */
    compact() {
      compaction(requireRun(), 'threshold')
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
    finishRun(reason: 'stop' | 'aborted' = 'stop', after?: RunEndTail, settled = false) {
      const runId = requireRun()
      if (after === 'stoppedRetry') {
        retryStarts(runId)
        emit({ type: 'auto_retry_end', success: false, attempt: 1, timestamp: tick() })
      } else emit({ type: 'agent_end', runId, reason, timestamp: tick() })
      if (after === 'compaction') compaction(runId, 'threshold')
      persistedRunIds.add(runId)
      revision += 1
      activeRunId = null
      // The Host settles it at once: its buffer is cleared before `run-completed` is relayed.
      if (settled) buffer = null
      return runId
    },
    /** A Run that fails before Pi starts: the Host publishes its end only, then settles it. */
    failBeforeStart(runId: string) {
      const error = { message: 'invalid model', code: 'invalid-model' }
      emit({ type: 'agent_end', runId, reason: 'error', error, timestamp: tick() })
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
