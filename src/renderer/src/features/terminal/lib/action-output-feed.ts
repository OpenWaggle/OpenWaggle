import {
  type ActionOutputSnapshot,
  type ActionRun,
  isActiveActionRun,
} from '@shared/types/action-runs'
import {
  ACTION_OUTPUT_GAP_NOTICE,
  ACTION_OUTPUT_RESTART_DIVIDER,
  ACTION_OUTPUT_TRIMMED_NOTICE,
  actionOutputOutcomeLine,
  sanitizeActionOutputChunk,
} from './action-output-view-model'

export const ACTION_OUTPUT_POLL_MS = 750
export const ACTION_OUTPUT_RETRY_MS = 2_000
// ED3 can straddle two output pages; hold its partial prefix until the next page.
const ERASE_SCROLLBACK = '\x1b[3J'

interface FeedSegment {
  readonly runId: string
  offset: number
  started: boolean
  tail: string
}

export interface ActionOutputFeedOptions {
  /** Reads one page of a run's live or retained output. Never starts or stops a run. */
  readonly fetchPage: (runId: string, afterOffset: number) => Promise<ActionOutputSnapshot>
  readonly write: (text: string) => void
  /** The latest snapshot of the current (last followed) run. */
  readonly onRun: (run: ActionRun) => void
  readonly onError: (message: string | null) => void
  readonly schedule?: (callback: () => void, delayMs: number) => () => void
}

function defaultSchedule(callback: () => void, delayMs: number) {
  const timer = setTimeout(callback, delayMs)
  return () => clearTimeout(timer)
}

function splitPartialEscape(text: string): readonly [string, string] {
  for (let length = ERASE_SCROLLBACK.length - 1; length > 0; length -= 1) {
    if (text.endsWith(ERASE_SCROLLBACK.slice(0, length)))
      return [text.slice(0, -length), text.slice(-length)]
  }
  return [text, '']
}

/**
 * Streams the followed runs of one Action output terminal view into a write sink, oldest first.
 * Finished runs end with their outcome; a following run starts below a "restarted" divider.
 * Output already written is never cleared, so a finished run keeps its final output.
 */
export function createActionOutputFeed(options: ActionOutputFeedOptions) {
  const schedule = options.schedule ?? defaultSchedule
  const segments: FeedSegment[] = []
  let cursor = 0
  let pumping = false
  let cancelTimer: (() => void) | null = null
  let disposed = false

  const wake = (delayMs: number) => {
    cancelTimer?.()
    cancelTimer = schedule(() => {
      cancelTimer = null
      void pump()
    }, delayMs)
  }

  const writeOutput = (segment: FeedSegment, text: string) => {
    const [complete, tail] = splitPartialEscape(segment.tail + text)
    segment.tail = tail
    const sanitized = sanitizeActionOutputChunk(complete)
    if (sanitized.length > 0) options.write(sanitized)
  }

  /** Applies one page; returns whether the feed should keep reading without waiting. */
  const applyPage = (segment: FeedSegment, page: ActionOutputSnapshot) => {
    if (page.startOffset > segment.offset)
      options.write(segment.offset === 0 ? ACTION_OUTPUT_TRIMMED_NOTICE : ACTION_OUTPUT_GAP_NOTICE)
    writeOutput(segment, page.output)
    segment.offset = Math.max(segment.offset, page.endOffset)
    if (cursor === segments.length - 1) options.onRun(page.run)
    if (page.hasMore) return true
    if (isActiveActionRun(page.run)) {
      wake(ACTION_OUTPUT_POLL_MS)
      return false
    }
    if (segment.tail.length > 0) options.write(segment.tail)
    segment.tail = ''
    options.write(actionOutputOutcomeLine(page.run))
    cursor += 1
    return true
  }

  const readSegment = async (segment: FeedSegment) => {
    if (!segment.started) {
      if (cursor > 0) options.write(ACTION_OUTPUT_RESTART_DIVIDER)
      segment.started = true
    }
    let page: ActionOutputSnapshot
    try {
      page = await options.fetchPage(segment.runId, segment.offset)
    } catch (error) {
      if (disposed) return false
      options.onError(error instanceof Error ? error.message : 'Connection interrupted.')
      wake(ACTION_OUTPUT_RETRY_MS)
      return false
    }
    if (disposed) return false
    options.onError(null)
    return applyPage(segment, page)
  }

  const pump = async (): Promise<void> => {
    if (pumping || disposed) return
    pumping = true
    try {
      let segment = segments[cursor]
      while (!disposed && segment !== undefined && (await readSegment(segment)))
        segment = segments[cursor]
    } finally {
      pumping = false
    }
  }

  return {
    /** Adds newly followed runs; already rendered runs and their output stay in place. */
    setRuns(runIds: readonly string[]) {
      let added = false
      for (const runId of runIds) {
        if (segments.some((segment) => segment.runId === runId)) continue
        segments.push({ runId, offset: 0, started: false, tail: '' })
        added = true
      }
      // A newly followed run is read immediately rather than after the current poll delay.
      if (added && !pumping) {
        cancelTimer?.()
        cancelTimer = null
        void pump()
      }
    },
    dispose() {
      disposed = true
      cancelTimer?.()
      cancelTimer = null
    },
  }
}

export type ActionOutputFeed = ReturnType<typeof createActionOutputFeed>
