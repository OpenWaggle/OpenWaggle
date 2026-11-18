import net, { type Socket } from 'node:net'
import { decodeUnknownOrThrow, Schema } from '@shared/schema'
import type { SessionHostEventCursor } from '@shared/types/session-host-event'
import { LocalSessionFrameDecoder } from '../local-session-framing'

export class TestFrameReader {
  private readonly decoder = new LocalSessionFrameDecoder()
  private readonly values: unknown[] = []
  private readonly waiters: ((value: unknown) => void)[] = []

  constructor(socket: Socket) {
    socket.on('data', (chunk) => {
      for (const value of this.decoder.push(chunk)) {
        const waiter = this.waiters.shift()
        if (waiter) waiter(value)
        else this.values.push(value)
      }
    })
  }

  next() {
    const value = this.values.shift()
    if (value !== undefined) {
      const promise: Promise<unknown> = Promise.resolve(value)
      return promise
    }
    return new Promise<unknown>((resolve) => this.waiters.push(resolve))
  }
}

export function connectLocalSessionTestClient(endpoint: string) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = net.createConnection(endpoint)
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}

const testCursorSchema: Schema.Schema<SessionHostEventCursor> = Schema.Struct({
  hostInstanceId: Schema.String,
  sequence: Schema.Number,
})

/** The members of a Local Session server frame the tests read; values decode where they are used. */
const testServerFrameSchema = Schema.Struct({
  kind: Schema.String,
  requestId: Schema.optionalWith(Schema.Unknown, { exact: true }),
  subscriptionId: Schema.optionalWith(Schema.Unknown, { exact: true }),
  code: Schema.optionalWith(Schema.Unknown, { exact: true }),
  message: Schema.optionalWith(Schema.Unknown, { exact: true }),
  reason: Schema.optionalWith(Schema.Unknown, { exact: true }),
  cursor: Schema.optionalWith(Schema.Unknown, { exact: true }),
  payload: Schema.optionalWith(Schema.Unknown, { exact: true }),
  event: Schema.optionalWith(Schema.Unknown, { exact: true }),
})

export function decodeTestServerFrame(value: unknown) {
  return decodeUnknownOrThrow(testServerFrameSchema, value)
}

/** Whether a value is a server frame of that kind (and, when given, that error code). */
export function isTestServerFrame(value: unknown, kind: string, code?: string) {
  if (!Schema.is(testServerFrameSchema)(value)) return false
  return value.kind === kind && (code === undefined || value.code === code)
}

export function sessionHostCursorFromTestFrame(frame: unknown) {
  return decodeUnknownOrThrow(Schema.Struct({ cursor: testCursorSchema }), frame).cursor
}
