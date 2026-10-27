interface TraceEvent {
  readonly name: string
  readonly ph: string
  readonly pid: number
  readonly tid: number
  readonly ts: number
  readonly dur: number
  readonly threadName: string | null
}

const TOP_LEVEL_TASKS = new Set(['ThreadControllerImpl::RunTask', 'RunTask'])
const RENDERER_MAIN_THREAD = 'CrRendererMain'
const MICROSECONDS_PER_MILLISECOND = 1_000
const PERCENT = 100
const LONG_FRAME_MS = 33

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function traceEventOf(value: unknown): TraceEvent | null {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.ph !== 'string') return null
  const args = isRecord(value.args) ? value.args : {}
  return {
    name: value.name,
    ph: value.ph,
    pid: typeof value.pid === 'number' ? value.pid : -1,
    tid: typeof value.tid === 'number' ? value.tid : -1,
    ts: typeof value.ts === 'number' ? value.ts : 0,
    dur: typeof value.dur === 'number' ? value.dur : 0,
    threadName: typeof args.name === 'string' ? args.name : null,
  }
}

/**
 * The share of a window the renderer main thread spent running tasks, from a Chrome trace: the
 * busiest `CrRendererMain` thread's top-level tasks, without double-counting nested ones.
 */
export function rendererMainThreadBusy(rawEvents: readonly unknown[], windowStartUs: number, windowEndUs: number) {
  const events = rawEvents.flatMap((raw) => {
    const event = traceEventOf(raw)
    return event ? [event] : []
  })
  const mainThreads = new Set(
    events
      .filter((event) => event.ph === 'M' && event.name === 'thread_name' && event.threadName === RENDERER_MAIN_THREAD)
      .map((event) => `${String(event.pid)}:${String(event.tid)}`),
  )
  const counts = new Map<string, number>()
  for (const event of events) {
    const key = `${String(event.pid)}:${String(event.tid)}`
    if (mainThreads.has(key)) counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const busiest = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0]
  const tasks = events
    .filter((event) => `${String(event.pid)}:${String(event.tid)}` === busiest && event.ph === 'X' && TOP_LEVEL_TASKS.has(event.name))
    .filter((event) => event.ts >= windowStartUs && event.ts <= windowEndUs)
    .sort((left, right) => left.ts - right.ts)
  let coveredUntil = 0
  let busyUs = 0
  let longTasks = 0
  for (const task of tasks) {
    if (task.ts < coveredUntil) continue
    busyUs += task.dur
    coveredUntil = task.ts + task.dur
    if (task.dur / MICROSECONDS_PER_MILLISECOND > LONG_FRAME_MS) longTasks += 1
  }
  const windowUs = Math.max(1, windowEndUs - windowStartUs)
  return {
    busyPercent: Math.round((busyUs / windowUs) * PERCENT * PERCENT) / PERCENT,
    busyMs: Math.round(busyUs / MICROSECONDS_PER_MILLISECOND),
    windowMs: Math.round(windowUs / MICROSECONDS_PER_MILLISECOND),
    taskCount: tasks.length,
    tasksOver33Ms: longTasks,
  }
}

export function traceBounds(rawEvents: readonly unknown[]) {
  const timestamps = rawEvents.flatMap((raw) => {
    const event = traceEventOf(raw)
    return event && event.ts > 0 ? [event.ts] : []
  })
  return {
    startUs: timestamps.reduce((low, ts) => Math.min(low, ts), Number.POSITIVE_INFINITY),
    endUs: timestamps.reduce((high, ts) => Math.max(high, ts), 0),
  }
}
