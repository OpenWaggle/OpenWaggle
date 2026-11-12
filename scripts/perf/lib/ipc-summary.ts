import { Schema } from '@shared/schema'
import { objectFields, unknownField } from '../../support/object-fields'

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

/** The main-process IPC log (`IPC_LOG_READ`): invokes in order, and pushed totals by channel. */
const ipcLogSchema = Schema.Struct({ invokes: unknownField, sends: unknownField })
const invokeSchema = Schema.Struct({
  channel: Schema.String,
  bytes: Schema.Number,
  ms: Schema.Number,
})
const pushedTotalsSchema = Schema.Struct({ count: Schema.Number, bytes: Schema.Number })

function invokesOf(log: unknown): InvokeRecord[] {
  const invokes = objectFields(ipcLogSchema, log)?.invokes
  if (!Array.isArray(invokes)) return []
  return invokes.flatMap((entry: unknown) =>
    Schema.is(invokeSchema)(entry)
      ? [{ channel: entry.channel, bytes: entry.bytes, ms: entry.ms }]
      : [],
  )
}

function pushedOf(log: unknown) {
  const sends = objectFields(ipcLogSchema, log)?.sends
  if (typeof sends !== 'object' || sends === null) return []
  return Object.entries(sends).flatMap(([channel, totals]: [string, unknown]) =>
    Schema.is(pushedTotalsSchema)(totals)
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
    pushedChannels: Object.fromEntries(
      pushed.map((entry) => [entry.channel, { count: entry.count, bytes: entry.bytes }]),
    ),
  }
}
