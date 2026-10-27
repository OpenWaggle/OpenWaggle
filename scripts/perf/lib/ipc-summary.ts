interface InvokeRecord {
  readonly channel: string
  readonly ms: number
  readonly bytes: number
}

interface ChannelTotals {
  count: number
  bytes: number
  ms: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function invokesOf(log: unknown): InvokeRecord[] {
  const invokes = isRecord(log) ? log.invokes : null
  if (!Array.isArray(invokes)) return []
  return invokes.flatMap((entry: unknown) =>
    isRecord(entry) && typeof entry.channel === 'string' && typeof entry.bytes === 'number' && typeof entry.ms === 'number'
      ? [{ channel: entry.channel, bytes: entry.bytes, ms: entry.ms }]
      : [],
  )
}

function pushedOf(log: unknown) {
  const sends = isRecord(log) ? log.sends : null
  if (!isRecord(sends)) return []
  return Object.entries(sends).flatMap(([channel, totals]) =>
    isRecord(totals) && typeof totals.count === 'number' && typeof totals.bytes === 'number'
      ? [{ channel, count: totals.count, bytes: totals.bytes }]
      : [],
  )
}

/** Totals of a main-process IPC log (`IPC_LOG_READ`): invokes by channel and pushed events. */
export function summarizeIpc(log: unknown) {
  const invokes = invokesOf(log)
  const channels = new Map<string, ChannelTotals>()
  for (const invoke of invokes) {
    const totals = channels.get(invoke.channel) ?? { count: 0, bytes: 0, ms: 0 }
    totals.count += 1
    totals.bytes += Math.max(0, invoke.bytes)
    totals.ms += invoke.ms
    channels.set(invoke.channel, totals)
  }
  const pushed = pushedOf(log)
  return {
    invokeCount: invokes.length,
    invokeBytes: invokes.reduce((total, invoke) => total + Math.max(0, invoke.bytes), 0),
    pushedCount: pushed.reduce((total, entry) => total + entry.count, 0),
    pushedBytes: pushed.reduce((total, entry) => total + entry.bytes, 0),
    channels: Object.fromEntries(
      [...channels.entries()]
        .sort((left, right) => right[1].bytes - left[1].bytes)
        .map(([channel, totals]) => [channel, { ...totals, ms: Math.round(totals.ms) }]),
    ),
    pushedChannels: Object.fromEntries(pushed.map((entry) => [entry.channel, { count: entry.count, bytes: entry.bytes }])),
  }
}
